import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { secureDirectory, stat } from './filesystem';
import { isValidPid, type ProcessProbe, systemProcessProbe } from './identity';

export const SERVER_LOCK_DIRECTORY = '.torchlauncher-server-lock';
const OWNER_FILE = 'owner.json';
/** Same bound USER-03 `inspectServerDataLock` applies to owner.json. */
export const MAX_OWNER_BYTES = 4096;

export class ServerDataLockedError extends Error {
  readonly code = 'locked' as const;
  /** Callers may present `inspectServerEnvironment(root)` to diagnose a possibly stale lock. */
  readonly recovery = 'inspect-server-environment' as const;
  readonly root: string | undefined;
  constructor(root?: string) {
    super('Server data is in use or requires manual stale-lock recovery');
    this.name = 'ServerDataLockedError';
    this.root = root;
  }
}
export type LockPurpose = 'install' | 'game' | 'maintenance';
/** Recorded child (game Java) process. `starting` is written before spawn. */
export type LockChild =
  | { state: 'starting' }
  | { state: 'running'; pid: number; start: string | null };
export interface LockOwnerV1 {
  version: 1;
  id: string;
  pid: number;
  purpose: LockPurpose;
}
export interface LockOwnerV2 {
  version: 2;
  id: string;
  pid: number;
  purpose: LockPurpose;
  /** Opaque OS process start identifier; null when unavailable. */
  start: string | null;
  host: { machine: string | null };
  child: LockChild | null;
}
export interface ServerDataLease {
  root: string;
  release(): Promise<void>;
  /** Atomically record the managed child process in owner.json (absent on foreign fakes). */
  recordChild?(child: LockChild | null): Promise<void>;
}
export interface LockOptions {
  /** Process identity boundary; production uses procfs (Linux) or System32 tools (Windows). */
  probe?: ProcessProbe;
}

export type LockOwnerRead =
  | { state: 'free' }
  | { state: 'unsafe' }
  | { state: 'no-owner' }
  | { state: 'invalid'; text: string }
  | { state: 'v1'; text: string; owner: LockOwnerV1 }
  | { state: 'v2'; text: string; owner: LockOwnerV2 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isPurpose(value: unknown): value is LockPurpose {
  return value === 'install' || value === 'game' || value === 'maintenance';
}
function isStart(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^[a-z0-9:._-]{1,200}$/i.test(value));
}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
function parseChild(value: unknown): LockChild | null | undefined {
  if (value === null) return null;
  if (exactKeys(value, ['state']))
    return value.state === 'starting' ? { state: 'starting' } : undefined;
  if (
    exactKeys(value, ['state', 'pid', 'start']) &&
    value.state === 'running' &&
    isValidPid(value.pid) &&
    isStart(value.start)
  )
    return { state: 'running', pid: value.pid, start: value.start };
  return undefined;
}
/** Strict owner parser. Unknown shapes are `invalid` and never authorize automatic recovery. */
export function parseLockOwner(text: string): LockOwnerRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { state: 'invalid', text };
  }
  if (
    exactKeys(value, ['version', 'id', 'pid', 'purpose']) &&
    value.version === 1 &&
    typeof value.id === 'string' &&
    UUID.test(value.id) &&
    isValidPid(value.pid) &&
    isPurpose(value.purpose)
  )
    return { state: 'v1', text, owner: value as unknown as LockOwnerV1 };
  if (
    exactKeys(value, ['version', 'id', 'pid', 'purpose', 'start', 'host', 'child']) &&
    value.version === 2 &&
    typeof value.id === 'string' &&
    UUID.test(value.id) &&
    isValidPid(value.pid) &&
    isPurpose(value.purpose) &&
    isStart(value.start) &&
    exactKeys(value.host, ['machine']) &&
    (value.host.machine === null ||
      (typeof value.host.machine === 'string' && /^[0-9a-f]{64}$/.test(value.host.machine)))
  ) {
    const child = parseChild(value.child);
    if (child !== undefined)
      return {
        state: 'v2',
        text,
        owner: {
          version: 2,
          id: value.id,
          pid: value.pid,
          purpose: value.purpose,
          start: value.start,
          host: { machine: value.host.machine as string | null },
          child,
        },
      };
  }
  return { state: 'invalid', text };
}

/** Side-effect-free read of the lock directory and owner.json (no final-link following). */
export async function readLockOwner(rootPath: string): Promise<LockOwnerRead> {
  const lock = join(resolve(rootPath), SERVER_LOCK_DIRECTORY);
  const info = await stat(lock);
  if (!info) return { state: 'free' };
  if (!info.isDirectory() || info.isSymbolicLink()) return { state: 'unsafe' };
  const path = join(lock, OWNER_FILE);
  const file = await stat(path);
  if (!file) return { state: 'no-owner' };
  if (!file.isFile() || file.isSymbolicLink() || file.size > MAX_OWNER_BYTES)
    return { state: 'invalid', text: '' };
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'no-owner' };
    return { state: 'invalid', text: '' };
  }
  try {
    const buffer = Buffer.alloc(MAX_OWNER_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OWNER_BYTES) return { state: 'invalid', text: '' };
    return parseLockOwner(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
}

async function currentOwner(purpose: LockPurpose, probe: ProcessProbe): Promise<LockOwnerV2> {
  let start: string | null = null;
  let machine: string | null = null;
  try {
    const state = await probe.process(process.pid);
    if (state.state === 'running') start = state.start;
    machine = (await probe.host()).machine;
  } catch {
    // Unknown identity only makes a later stale classification `uncertain`.
  }
  return {
    version: 2,
    id: randomUUID(),
    pid: process.pid,
    purpose,
    start,
    host: { machine },
    child: null,
  };
}

function createLease(root: string, lock: string, initial: LockOwnerV2): ServerDataLease {
  let owner = initial;
  let text = JSON.stringify(owner);
  let released = false;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const verify = async () => {
    const info = await stat(lock);
    if (
      !info?.isDirectory() ||
      info.isSymbolicLink() ||
      (await readFile(join(lock, OWNER_FILE), 'utf8')) !== text
    )
      throw new Error('Server-data lock ownership changed; manual recovery required');
  };
  return {
    root,
    release: () =>
      serial(async () => {
        if (released) return;
        await verify();
        await rm(lock, { recursive: true });
        released = true;
      }),
    recordChild: (child) =>
      serial(async () => {
        if (released) throw new Error('Server-data lock was already released');
        await verify();
        const next = { ...owner, child };
        const nextText = JSON.stringify(next);
        const temporary = join(lock, `${OWNER_FILE}.${randomUUID()}.tmp`);
        await writeFile(temporary, nextText, { flag: 'wx', mode: 0o600 });
        try {
          // Atomic replacement: readers see either the previous or the new owner record.
          await renameWithRetry(temporary, join(lock, OWNER_FILE));
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          throw error;
        }
        owner = next;
        text = nextText;
      }),
  };
}

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
export interface RenameRetryOptions {
  platform?: NodeJS.Platform;
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
}
/**
 * Windows reports EPERM/EACCES/EBUSY when another process (a status reader, antivirus, the
 * search indexer) briefly holds the file without FILE_SHARE_DELETE. Retry a few times there;
 * other platforms and other errors (including ENOENT) propagate immediately.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const move = options.rename ?? rename;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const attempts = platform === 'win32' ? (options.attempts ?? 8) : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await move(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || code === undefined || !TRANSIENT_RENAME_CODES.has(code))
        throw error;
      await sleep(25 * attempt);
    }
  }
}

/** Cooperative filesystem lock: all installation, launch and future deletion callers must use it. */
export async function acquireServerDataLock(
  rootPath: string,
  purpose: LockPurpose,
  options: LockOptions = {},
): Promise<ServerDataLease> {
  const root = resolve(rootPath);
  await secureDirectory(root);
  const lock = join(root, SERVER_LOCK_DIRECTORY);
  // Resolve identity before creating the lock so the ownerless window stays short.
  const owner = await currentOwner(purpose, options.probe ?? systemProcessProbe());
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ServerDataLockedError(root);
    throw error;
  }
  try {
    await writeFile(join(lock, OWNER_FILE), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  return createLease(root, lock, owner);
}

/**
 * Take over an existing lock whose owner record still equals `expectedText` (null: no owner file).
 * The directory is never removed, so no other host can acquire the lock during the takeover.
 * Callers must have proven the owner stale (or obtained explicit user confirmation).
 */
export async function reclaimServerDataLock(
  rootPath: string,
  expectedText: string | null,
  options: LockOptions = {},
): Promise<ServerDataLease> {
  const root = resolve(rootPath);
  const lock = join(root, SERVER_LOCK_DIRECTORY);
  const info = await stat(lock);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new ServerDataLockedError(root);
  const owner = await currentOwner('maintenance', options.probe ?? systemProcessProbe());
  const ownerPath = join(lock, OWNER_FILE);
  let aside: string | undefined;
  if (expectedText !== null) {
    aside = join(lock, `${OWNER_FILE}.reclaimed-${randomUUID()}`);
    try {
      // Only one concurrent reclaimer can move this exact file away.
      await renameWithRetry(ownerPath, aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ServerDataLockedError(root);
      throw error;
    }
    if ((await readFile(aside, 'utf8')) !== expectedText) {
      // Someone else changed the owner since inspection; put it back without overwriting.
      await link(aside, ownerPath).catch(() => undefined);
      await unlink(aside).catch(() => undefined);
      throw new ServerDataLockedError(root);
    }
  }
  try {
    await writeFile(ownerPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ServerDataLockedError(root);
    throw error;
  }
  if (aside) await unlink(aside).catch(() => undefined);
  return createLease(root, lock, owner);
}
