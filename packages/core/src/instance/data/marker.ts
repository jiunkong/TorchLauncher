import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { stat as lstatOrUndefined } from '../../minecraft/filesystem';
import { acquireServerDataLock, ServerDataLockedError } from '../../minecraft/lock';
import { ServerDataError, toServerDataError } from './errors';
import {
  DELETION_MARKER_FILE,
  isServerId,
  LOCK_DIRECTORY,
  ROOT_MARKER_FILE,
  resolveServerDataRoot,
  SERVERS_DIRECTORY,
  verifyServerRoot,
  verifyUserDataBase,
} from './paths';

/** Markers are tiny; anything larger is rejected without parsing. */
export const MAX_MARKER_BYTES = 4096;
const ROOT_MARKER_FORMAT = 'torchlauncher-server-data-root';
const DELETION_MARKER_FORMAT = 'torchlauncher-server-data-deletion';

export interface ServerDataRootMarker {
  format: typeof ROOT_MARKER_FORMAT;
  version: 1;
  serverId: string;
  /** Random per-root instance ID: a deleted and recreated root never matches an old preview. */
  rootId: string;
  createdAt: string;
}

export interface ServerDataDeletionMarker {
  format: typeof DELETION_MARKER_FORMAT;
  version: 1;
  serverId: string;
  rootId: string;
  startedAt: string;
}

export type MarkerInspection<T> =
  | { state: 'valid'; marker: T }
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'mismatch' };

type BoundedRead = { state: 'missing' } | { state: 'invalid' } | { state: 'ok'; text: string };

/** Read a small regular file without following a final link and with a hard size limit. */
async function readSmallRegularFile(path: string, maxBytes: number): Promise<BoundedRead> {
  const info = await lstatOrUndefined(path);
  if (!info) return { state: 'missing' };
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return { state: 'invalid' };
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'missing' };
    if (code === 'ELOOP') return { state: 'invalid' };
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes || opened.ino !== info.ino)
      return { state: 'invalid' };
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { state: 'invalid' };
    return { state: 'ok', text: buffer.subarray(0, bytesRead).toString('utf8') };
  } finally {
    await handle.close();
  }
}

function parseObject(text: string, keys: readonly string[]): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    return undefined;
  return record;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function parseRootMarker(text: string): ServerDataRootMarker | undefined {
  const record = parseObject(text, ['format', 'version', 'serverId', 'rootId', 'createdAt']);
  if (
    !record ||
    record.format !== ROOT_MARKER_FORMAT ||
    record.version !== 1 ||
    !isServerId(record.serverId) ||
    !isServerId(record.rootId) ||
    !isTimestamp(record.createdAt)
  )
    return undefined;
  return record as unknown as ServerDataRootMarker;
}

function parseDeletionMarker(text: string): ServerDataDeletionMarker | undefined {
  const record = parseObject(text, ['format', 'version', 'serverId', 'rootId', 'startedAt']);
  if (
    !record ||
    record.format !== DELETION_MARKER_FORMAT ||
    record.version !== 1 ||
    !isServerId(record.serverId) ||
    !isServerId(record.rootId) ||
    !isTimestamp(record.startedAt)
  )
    return undefined;
  return record as unknown as ServerDataDeletionMarker;
}

/** Inspect a root's ownership marker. Read-only. */
export async function readServerDataMarker(
  root: string,
  expectedServerId: string,
): Promise<MarkerInspection<ServerDataRootMarker>> {
  const read = await readSmallRegularFile(join(root, ROOT_MARKER_FILE), MAX_MARKER_BYTES);
  if (read.state !== 'ok') return read;
  const marker = parseRootMarker(read.text);
  if (!marker) return { state: 'invalid' };
  if (marker.serverId !== expectedServerId) return { state: 'mismatch' };
  return { state: 'valid', marker };
}

/** Inspect an in-progress deletion marker. `mismatch` means a different server or root instance. */
export async function readDeletionMarker(
  root: string,
  expected: ServerDataRootMarker,
): Promise<MarkerInspection<ServerDataDeletionMarker>> {
  const read = await readSmallRegularFile(join(root, DELETION_MARKER_FILE), MAX_MARKER_BYTES);
  if (read.state !== 'ok') return read;
  const marker = parseDeletionMarker(read.text);
  if (!marker) return { state: 'invalid' };
  if (marker.serverId !== expected.serverId || marker.rootId !== expected.rootId)
    return { state: 'mismatch' };
  return { state: 'valid', marker };
}

/** Create a marker file exclusively; never overwrites. */
async function writeExclusive(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function writeDeletionMarker(root: string, marker: ServerDataRootMarker) {
  const value: ServerDataDeletionMarker = {
    format: DELETION_MARKER_FORMAT,
    version: 1,
    serverId: marker.serverId,
    rootId: marker.rootId,
    startedAt: new Date().toISOString(),
  };
  await writeExclusive(join(root, DELETION_MARKER_FILE), `${JSON.stringify(value)}\n`);
}

export type LockInspection =
  | { state: 'unlocked' }
  | { state: 'locked'; purpose?: 'install' | 'game' | 'maintenance'; pid?: number }
  /** Something unexpected occupies the lock path; treated as locked. */
  | { state: 'invalid' };

/**
 * Report the cooperative lock without acquiring it (no side effects). A held lock may be stale
 * after a crash; the existing lock contract leaves stale-lock recovery to the user.
 */
export async function inspectServerDataLock(root: string): Promise<LockInspection> {
  const lock = join(root, LOCK_DIRECTORY);
  const info = await lstatOrUndefined(lock);
  if (!info) return { state: 'unlocked' };
  if (!info.isDirectory() || info.isSymbolicLink()) return { state: 'invalid' };
  const read = await readSmallRegularFile(join(lock, 'owner.json'), MAX_MARKER_BYTES);
  if (read.state !== 'ok') return { state: 'locked' };
  try {
    const owner = JSON.parse(read.text) as { purpose?: unknown; pid?: unknown };
    const result: { state: 'locked'; purpose?: 'install' | 'game' | 'maintenance'; pid?: number } =
      { state: 'locked' };
    if (owner.purpose === 'install' || owner.purpose === 'game' || owner.purpose === 'maintenance')
      result.purpose = owner.purpose;
    if (Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0)
      result.pid = owner.pid as number;
    return result;
  } catch {
    return { state: 'locked' };
  }
}

export interface EnsureServerDataRootOptions {
  /**
   * Write a marker into an existing, non-empty, unmarked root. Off by default: unmarked folders
   * (for example development smoke data) stay unowned and therefore undeletable.
   */
  adoptExisting?: boolean;
}

export interface EnsuredServerDataRoot {
  root: string;
  marker: ServerDataRootMarker;
  created: boolean;
}

async function ensurePlainDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const info = await lstatOrUndefined(path);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new ServerDataError('unsafe-path', 'Expected a plain directory');
}

function rejectMarker(state: 'invalid' | 'mismatch'): never {
  throw state === 'invalid'
    ? new ServerDataError('marker-invalid', 'Server data root marker is invalid')
    : new ServerDataError('marker-mismatch', 'Server data root belongs to another server');
}

/**
 * Create (or confirm) `<base>/servers/<id>` with its ownership marker. The base must already
 * exist. Writing a marker happens under the maintenance lock.
 */
export async function ensureServerDataRoot(
  userDataBase: string,
  serverId: string,
  options: EnsureServerDataRootOptions = {},
): Promise<EnsuredServerDataRoot> {
  resolveServerDataRoot(userDataBase, serverId);
  await verifyUserDataBase(userDataBase);
  const root = join(userDataBase, SERVERS_DIRECTORY, serverId);
  let created = false;
  try {
    await ensurePlainDirectory(join(userDataBase, SERVERS_DIRECTORY));
    created = (await lstatOrUndefined(root)) === undefined;
    await ensurePlainDirectory(root);
  } catch (error) {
    throw toServerDataError(error, 'Unable to create the server data root');
  }
  const verified = await verifyServerRoot(userDataBase, serverId);

  const existing = await readServerDataMarker(verified.root, serverId);
  if (existing.state === 'invalid' || existing.state === 'mismatch') rejectMarker(existing.state);
  if (existing.state === 'valid') {
    const deletion = await readDeletionMarker(verified.root, existing.marker);
    if (deletion.state !== 'missing')
      throw new ServerDataError(
        'deletion-incomplete',
        'Server data deletion is in progress; finish deleting before reuse',
      );
    return { root: verified.root, marker: existing.marker, created: false };
  }

  let lease: Awaited<ReturnType<typeof acquireServerDataLock>>;
  try {
    lease = await acquireServerDataLock(verified.root, 'maintenance');
  } catch (error) {
    if (error instanceof ServerDataLockedError)
      throw new ServerDataError('locked', 'Server data is in use', { cause: error });
    throw toServerDataError(error, 'Unable to lock the server data root');
  }
  try {
    const raced = await readServerDataMarker(verified.root, serverId);
    if (raced.state === 'invalid' || raced.state === 'mismatch') rejectMarker(raced.state);
    if (raced.state === 'valid') return { root: verified.root, marker: raced.marker, created };
    const names = (await readdir(verified.root)).filter((name) => name !== LOCK_DIRECTORY);
    if (names.length > 0 && !options.adoptExisting)
      throw new ServerDataError(
        'unmarked-root',
        'Existing server data folder has no TorchLauncher marker and was not adopted',
      );
    const marker: ServerDataRootMarker = {
      format: ROOT_MARKER_FORMAT,
      version: 1,
      serverId,
      rootId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await writeExclusive(join(verified.root, ROOT_MARKER_FILE), `${JSON.stringify(marker)}\n`);
    return { root: verified.root, marker, created };
  } catch (error) {
    throw toServerDataError(error, 'Unable to write the server data marker');
  } finally {
    await lease.release();
  }
}
