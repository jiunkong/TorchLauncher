import type { Stats } from 'node:fs';
import { constants } from 'node:fs';
import { open, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { secureDirectory, stat } from '../filesystem';
import {
  INSTALL_JOURNAL_FILE,
  INSTALL_LOCK_DIRECTORY,
  type InstallOperation,
} from '../install-transaction';

/** Persisted once before the first recovery mutation so an interrupted recovery keeps direction. */
const DECISION_FILE = 'recovery.json';
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_OPERATIONS = 250_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUNTIME_STAGE = 'runtime';

export type InstallTransactionState = 'none' | 'rollback-needed' | 'complete-needed' | 'invalid';
export type InstallInvalidReason =
  | 'lock-unsafe'
  | 'unexpected-entry'
  | 'journal-invalid'
  | 'journal-root-mismatch'
  | 'unsafe-path'
  | 'inconsistent-state';
export interface InstallTransactionInspection {
  state: InstallTransactionState;
  /** `staging`: interrupted before publication (no journal); `publishing`: journal present. */
  phase?: 'staging' | 'publishing';
  operations?: number;
  reason?: InstallInvalidReason;
}
export type InstallRecoveryAction =
  | { kind: 'install-staging-discarded' }
  | { kind: 'install-rolled-back'; operations: number }
  | { kind: 'install-completed'; operations: number };

class Invalid extends Error {
  readonly reason: InstallInvalidReason;
  constructor(reason: InstallInvalidReason) {
    super(`Install transaction cannot be recovered automatically (${reason})`);
    this.reason = reason;
  }
}
type Kind = 'file' | 'directory';
interface Entry {
  info: Stats | undefined;
}
interface Paths {
  root: string;
  lock: string;
  staging: string;
  backups: string;
  journal: string;
  decision: string;
}
interface Loaded {
  paths: Paths;
  operations: InstallOperation[] | undefined;
  decision: 'rollback' | 'complete' | undefined;
}

function pathsFor(root: string): Paths {
  const lock = join(root, INSTALL_LOCK_DIRECTORY);
  return {
    root,
    lock,
    staging: join(lock, 'staging'),
    backups: join(lock, 'backups'),
    journal: join(lock, INSTALL_JOURNAL_FILE),
    decision: join(lock, DECISION_FILE),
  };
}
function plainDirectory(info: Stats | undefined): boolean {
  return Boolean(info?.isDirectory() && !info.isSymbolicLink());
}
function matches(info: Stats | undefined, kind: Kind): boolean {
  if (!info || info.isSymbolicLink()) return false;
  return kind === 'directory' ? info.isDirectory() : info.isFile();
}
async function readBounded(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > limit)
    throw new Invalid('journal-invalid');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit || opened.ino !== info.ino)
      throw new Invalid('journal-invalid');
    const buffer = Buffer.alloc(opened.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
function exactKeys(value: unknown, required: string[], optional: string[] = []) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
/** Targets must be strictly inside the root and outside every reserved launcher path. */
function checkTarget(root: string, target: string): void {
  const rel = relative(root, target);
  if (
    !rel ||
    isAbsolute(rel) ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    resolve(root, rel) !== target
  )
    throw new Invalid('unsafe-path');
  const first = rel.split(sep)[0] ?? '';
  if (first.toLowerCase().startsWith('.torchlauncher')) throw new Invalid('unsafe-path');
}
/** Validate the journal written by `writeInstallJournal`; it is never a generic delete list. */
export function parseInstallJournal(text: string, paths: Paths): InstallOperation[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Invalid('journal-invalid');
  }
  if (!exactKeys(value, ['version', 'root', 'operations'])) throw new Invalid('journal-invalid');
  const journal = value as Record<string, unknown>;
  if (
    journal.version !== 1 ||
    typeof journal.root !== 'string' ||
    !Array.isArray(journal.operations)
  )
    throw new Invalid('journal-invalid');
  if (journal.root !== paths.root) throw new Invalid('journal-root-mismatch');
  if (journal.operations.length > MAX_OPERATIONS) throw new Invalid('journal-invalid');
  const targets = new Set<string>();
  const staged = new Set<string>();
  const backups = new Set<string>();
  const operations: InstallOperation[] = [];
  for (const raw of journal.operations) {
    if (!exactKeys(raw, ['target', 'staged'], ['backup'])) throw new Invalid('journal-invalid');
    const op = raw as Record<string, unknown>;
    if (
      typeof op.target !== 'string' ||
      typeof op.staged !== 'string' ||
      (op.backup !== undefined && typeof op.backup !== 'string')
    )
      throw new Invalid('journal-invalid');
    checkTarget(paths.root, op.target);
    const stageName = basename(op.staged);
    if (
      dirname(op.staged) !== paths.staging ||
      !(UUID.test(stageName) || stageName === RUNTIME_STAGE)
    )
      throw new Invalid('unsafe-path');
    if (
      op.backup !== undefined &&
      (dirname(op.backup) !== paths.backups || !UUID.test(basename(op.backup)))
    )
      throw new Invalid('unsafe-path');
    const key = op.target.toLowerCase();
    if (
      targets.has(key) ||
      staged.has(op.staged) ||
      (op.backup !== undefined && backups.has(op.backup))
    )
      throw new Invalid('journal-invalid');
    targets.add(key);
    staged.add(op.staged);
    if (op.backup !== undefined) backups.add(op.backup);
    operations.push({
      target: op.target,
      staged: op.staged,
      ...(op.backup !== undefined ? { backup: op.backup } : {}),
    });
  }
  return operations;
}
function kindOf(operation: InstallOperation): Kind {
  return basename(operation.staged) === RUNTIME_STAGE ? 'directory' : 'file';
}
/** lstat a target without following any symlinked ancestor between root and target. */
async function targetEntry(root: string, target: string, kind: Kind): Promise<Entry> {
  const parts = relative(root, target).split(sep);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const info = await stat(current);
    if (!info) return { info: undefined };
    if (!plainDirectory(info)) throw new Invalid('unsafe-path');
  }
  const info = await stat(target);
  if (info && !matches(info, kind)) throw new Invalid('inconsistent-state');
  return { info };
}
async function internalEntry(path: string, kind: Kind): Promise<Entry> {
  const info = await stat(path);
  if (info && !matches(info, kind)) throw new Invalid('inconsistent-state');
  return { info };
}
async function names(directory: string): Promise<string[]> {
  const info = await stat(directory);
  if (!info) return [];
  if (!plainDirectory(info)) throw new Invalid('lock-unsafe');
  return readdir(directory);
}

async function load(root: string): Promise<Loaded | undefined> {
  const paths = pathsFor(root);
  const lock = await stat(paths.lock);
  if (!lock) return undefined;
  if (!plainDirectory(lock)) throw new Invalid('lock-unsafe');
  for (const name of await readdir(paths.lock))
    if (!['staging', 'backups', INSTALL_JOURNAL_FILE, DECISION_FILE].includes(name))
      throw new Invalid('unexpected-entry');
  const journalInfo = await stat(paths.journal);
  const operations = journalInfo
    ? parseInstallJournal(await readBounded(paths.journal, MAX_JOURNAL_BYTES), paths)
    : undefined;
  let decision: Loaded['decision'];
  if (await stat(paths.decision)) {
    const text = await readBounded(paths.decision, 256);
    if (text === JSON.stringify({ version: 1, decision: 'rollback' })) decision = 'rollback';
    else if (text === JSON.stringify({ version: 1, decision: 'complete' })) decision = 'complete';
    else throw new Invalid('journal-invalid');
  }
  // Internal entries must be exactly what the installer creates.
  const listedStaged = new Set(operations?.map((op) => basename(op.staged)));
  const listedBackups = new Set(
    operations?.flatMap((op) => (op.backup ? [basename(op.backup)] : [])),
  );
  for (const name of await names(paths.staging)) {
    if (operations ? !listedStaged.has(name) : !(UUID.test(name) || name === RUNTIME_STAGE))
      throw new Invalid('unexpected-entry');
    await internalEntry(join(paths.staging, name), name === RUNTIME_STAGE ? 'directory' : 'file');
  }
  for (const name of await names(paths.backups))
    if (!listedBackups.has(name)) throw new Invalid('unexpected-entry');
  return { paths, operations, decision };
}

interface OpState {
  operation: InstallOperation;
  kind: Kind;
  target: boolean;
  staged: boolean;
  backup: boolean;
}
async function scan(loaded: Loaded): Promise<OpState[]> {
  const states: OpState[] = [];
  for (const operation of loaded.operations ?? []) {
    const kind = kindOf(operation);
    const target =
      (await targetEntry(loaded.paths.root, operation.target, kind)).info !== undefined;
    const staged = (await internalEntry(operation.staged, kind)).info !== undefined;
    const backup = operation.backup
      ? (await internalEntry(operation.backup, kind)).info !== undefined
      : false;
    states.push({ operation, kind, target, staged, backup });
  }
  return states;
}
function published(state: OpState): boolean {
  return state.operation.backup
    ? state.target && state.backup && !state.staged
    : state.target && !state.staged;
}
/** Every state reachable by the installer's commit/rollback loop; anything else is invalid. */
function checkRollbackable(states: OpState[]): void {
  for (const state of states) {
    if (!state.operation.backup) continue;
    if (state.backup && state.target && state.staged) throw new Invalid('inconsistent-state');
    if (!state.backup && !state.target) throw new Invalid('inconsistent-state');
  }
}
function checkCompletable(states: OpState[]): void {
  // After a persisted `complete` decision, backups may already be gone.
  for (const state of states)
    if (!state.target || state.staged) throw new Invalid('inconsistent-state');
}

function direction(loaded: Loaded, states: OpState[]): 'rollback' | 'complete' {
  if (loaded.decision) return loaded.decision;
  return states.every(published) ? 'complete' : 'rollback';
}

/** Side-effect-free classification of `.torchlauncher-install-lock`. */
export async function inspectInstallTransaction(
  rootPath: string,
): Promise<InstallTransactionInspection> {
  const root = resolve(rootPath);
  try {
    const loaded = await load(root);
    if (!loaded) return { state: 'none' };
    if (!loaded.operations) return { state: 'rollback-needed', phase: 'staging', operations: 0 };
    const states = await scan(loaded);
    const chosen = direction(loaded, states);
    if (chosen === 'complete') checkCompletable(states);
    else checkRollbackable(states);
    return {
      state: chosen === 'complete' ? 'complete-needed' : 'rollback-needed',
      phase: 'publishing',
      operations: states.length,
    };
  } catch (error) {
    if (error instanceof Invalid) return { state: 'invalid', reason: error.reason };
    throw error;
  }
}

async function removeOwned(path: string, kind: Kind): Promise<void> {
  // Type was verified by scan; directories are installer-built runtime trees (rm never follows links).
  if (kind === 'directory') await rm(path, { recursive: true });
  else await unlink(path);
}
async function removeIfPresent(path: string, kind: Kind): Promise<void> {
  if ((await internalEntry(path, kind)).info) await removeOwned(path, kind);
}

/**
 * Resolve an interrupted installation transaction. Caller MUST hold the server-data lock.
 * Each step is idempotent and re-derived from the filesystem, so an interrupted recovery
 * can simply run again. Invalid or unexpected layouts are left untouched.
 */
export async function recoverInstallTransaction(
  rootPath: string,
  hooks: { afterStep?: () => void | Promise<void> } = {},
): Promise<{ action?: InstallRecoveryAction; invalid?: InstallInvalidReason }> {
  const root = resolve(rootPath);
  let loaded: Loaded | undefined;
  let states: OpState[];
  let chosen: 'rollback' | 'complete';
  try {
    loaded = await load(root);
    if (!loaded) return {};
    states = await scan(loaded);
    chosen = direction(loaded, states);
    if (chosen === 'complete') checkCompletable(states);
    else checkRollbackable(states);
  } catch (error) {
    if (error instanceof Invalid) return { invalid: error.reason };
    throw error;
  }
  const { paths } = loaded;
  const step = async () => {
    await hooks.afterStep?.();
  };
  const hasJournal = loaded.operations !== undefined;
  if (hasJournal && !loaded.decision) {
    await writeFile(paths.decision, JSON.stringify({ version: 1, decision: chosen }), {
      flag: 'wx',
    });
    await step();
  }
  if (chosen === 'complete') {
    for (const state of states)
      if (state.operation.backup) {
        await removeIfPresent(state.operation.backup, state.kind);
        await step();
      }
  } else {
    for (const state of [...states].reverse()) {
      const { operation, kind } = state;
      if (operation.backup) {
        if (!(await internalEntry(operation.backup, kind)).info) continue;
        // Backup present: the original was moved aside. Drop any published replacement first.
        if ((await targetEntry(root, operation.target, kind)).info) {
          await removeOwned(operation.target, kind);
          await step();
        }
        await secureDirectory(dirname(operation.target));
        await rename(operation.backup, operation.target);
        await step();
      } else if (
        !(await internalEntry(operation.staged, kind)).info &&
        (await targetEntry(root, operation.target, kind)).info
      ) {
        // Originally absent target whose staged entry is gone: it was published; remove it.
        await removeOwned(operation.target, kind);
        await step();
      }
    }
  }
  // Discard installer-owned staging (validated names/types), then the transaction itself.
  for (const name of await names(paths.staging)) {
    await removeOwned(join(paths.staging, name), name === RUNTIME_STAGE ? 'directory' : 'file');
    await step();
  }
  if (await stat(paths.staging)) await rmdir(paths.staging);
  if (await stat(paths.backups)) await rmdir(paths.backups);
  if (await stat(paths.journal)) {
    await unlink(paths.journal);
    await step();
  }
  if (await stat(paths.decision)) await unlink(paths.decision);
  await rmdir(paths.lock);
  const operations = states.length;
  return {
    action: !hasJournal
      ? { kind: 'install-staging-discarded' }
      : chosen === 'complete'
        ? { kind: 'install-completed', operations }
        : { kind: 'install-rolled-back', operations },
  };
}
