import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { stat as lstatOrUndefined } from '../../minecraft/filesystem';
import {
  acquireServerDataLock,
  type ServerDataLease,
  ServerDataLockedError,
} from '../../minecraft/lock';
import { isServerDataError, ServerDataError, throwIfAborted, toServerDataError } from './errors';
import {
  inspectServerDataLock,
  type LockInspection,
  readDeletionMarker,
  readServerDataMarker,
  type ServerDataRootMarker,
  writeDeletionMarker,
} from './marker';
import {
  DELETION_MARKER_FILE,
  LOCK_DIRECTORY,
  ROOT_MARKER_FILE,
  resolveServerDataRoot,
  type VerifiedServerRoot,
  verifyServerRoot,
} from './paths';
import { type DirectoryUsage, measureDirectory, type UsageOptions } from './usage';

export type DeletionBlocker =
  | 'root-not-found'
  | 'unsafe-path'
  | 'marker-missing'
  | 'marker-invalid'
  | 'marker-mismatch'
  | 'locked'
  | 'limit-exceeded';

export interface ServerDataDeletionPreview {
  serverId: string;
  /** Absolute target path to show the user before confirming. */
  root: string;
  exists: boolean;
  marker: 'valid' | 'missing' | 'invalid' | 'mismatch' | 'unknown';
  /** A previous deletion stopped part-way; deleting again resumes it. */
  deletionInProgress: boolean;
  lock?: LockInspection;
  usage?: DirectoryUsage;
  deletable: boolean;
  blockers: DeletionBlocker[];
  /** Present only when `deletable`; single use, bound to this exact root instance. */
  confirmation?: { token: string; expiresAt: string };
}

export interface PreviewOptions extends UsageOptions {
  /** Confirmation lifetime; defaults to 10 minutes. */
  confirmationTtlMs?: number;
}

export interface DeletionProgress {
  phase: 'deleting' | 'finalizing';
  removedEntries: number;
  removedBytes: number;
  /** Entry count measured by the preview (excluding markers and lock). */
  expectedEntries?: number;
}

export interface DeletionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DeletionProgress) => void;
}

export interface ServerDataDeletionResult {
  status: 'deleted';
  root: string;
  removedEntries: number;
  removedBytes: number;
}

const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60_000;
const MAX_PENDING_CONFIRMATIONS = 32;
/** Hard recursion cap during deletion (preview limits depth to 64 by default). */
const MAX_DELETE_DEPTH = 256;
const RESERVED_ROOT_ENTRIES = new Set([ROOT_MARKER_FILE, DELETION_MARKER_FILE, LOCK_DIRECTORY]);

interface PendingConfirmation {
  base: string;
  serverId: string;
  realBase: string;
  realRoot: string;
  dev: number;
  ino: number;
  rootId: string;
  expiresAt: number;
  expectedEntries?: number;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

function prunePending(now: number): void {
  for (const [token, pending] of pendingConfirmations)
    if (pending.expiresAt <= now) pendingConfirmations.delete(token);
  while (pendingConfirmations.size >= MAX_PENDING_CONFIRMATIONS) {
    const oldest = pendingConfirmations.keys().next().value;
    if (oldest === undefined) break;
    pendingConfirmations.delete(oldest);
  }
}

function markerBlocker(state: 'missing' | 'invalid' | 'mismatch'): DeletionBlocker {
  return state === 'missing'
    ? 'marker-missing'
    : state === 'invalid'
      ? 'marker-invalid'
      : 'marker-mismatch';
}

/**
 * Describe exactly what deletion would remove. Read-only: it never acquires the lock, creates
 * directories, or writes markers. Returns a confirmation token only when deletion is allowed.
 */
export async function previewServerDataDeletion(
  userDataBase: string,
  serverId: string,
  options: PreviewOptions = {},
): Promise<ServerDataDeletionPreview> {
  const root = resolveServerDataRoot(userDataBase, serverId);
  const preview: ServerDataDeletionPreview = {
    serverId,
    root,
    exists: false,
    marker: 'unknown',
    deletionInProgress: false,
    deletable: false,
    blockers: [],
  };
  let verified: VerifiedServerRoot;
  try {
    verified = await verifyServerRoot(userDataBase, serverId);
  } catch (error) {
    if (isServerDataError(error, 'root-not-found') || isServerDataError(error, 'unsafe-path')) {
      preview.exists = (error as ServerDataError).code === 'unsafe-path';
      preview.blockers.push((error as ServerDataError).code as DeletionBlocker);
      return preview;
    }
    throw error;
  }
  preview.exists = true;
  let marker: ServerDataRootMarker | undefined;
  try {
    const inspection = await readServerDataMarker(verified.root, serverId);
    preview.marker = inspection.state;
    if (inspection.state === 'valid') {
      marker = inspection.marker;
      const deletion = await readDeletionMarker(verified.root, marker);
      if (deletion.state === 'valid') preview.deletionInProgress = true;
      else if (deletion.state !== 'missing') preview.blockers.push(markerBlocker(deletion.state));
    } else preview.blockers.push(markerBlocker(inspection.state));
    preview.lock = await inspectServerDataLock(verified.root);
    if (preview.lock.state !== 'unlocked') preview.blockers.push('locked');
  } catch (error) {
    throw toServerDataError(error, 'Unable to inspect server data');
  }
  preview.usage = await measureDirectory(verified.root, options);
  if (preview.usage.status !== 'complete') preview.blockers.push('limit-exceeded');

  if (preview.blockers.length === 0 && marker) {
    const now = Date.now();
    const ttl = options.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl < 1)
      throw new RangeError('Confirmation TTL must be a positive integer');
    prunePending(now);
    const token = randomBytes(32).toString('base64url');
    const pending: PendingConfirmation = {
      base: userDataBase,
      serverId,
      realBase: verified.realBase,
      realRoot: verified.realRoot,
      dev: verified.rootInfo.dev,
      ino: verified.rootInfo.ino,
      rootId: marker.rootId,
      expiresAt: now + ttl,
    };
    if (preview.usage.status === 'complete')
      pending.expectedEntries =
        preview.usage.files +
        preview.usage.directories +
        preview.usage.links +
        preview.usage.others;
    pendingConfirmations.set(token, pending);
    preview.deletable = true;
    preview.confirmation = { token, expiresAt: new Date(pending.expiresAt).toISOString() };
  }
  return preview;
}

/** Forget an unused confirmation (for example when the user cancels the dialog). */
export function discardDeletionConfirmation(token: string): void {
  pendingConfirmations.delete(token);
}

function takeConfirmation(token: unknown, userDataBase: string, serverId: string) {
  const pending = typeof token === 'string' ? pendingConfirmations.get(token) : undefined;
  if (typeof token === 'string') pendingConfirmations.delete(token);
  if (
    !pending ||
    pending.expiresAt <= Date.now() ||
    pending.base !== userDataBase ||
    pending.serverId !== serverId
  )
    throw new ServerDataError(
      'confirmation-required',
      'Deletion needs a fresh confirmation from previewServerDataDeletion',
    );
  return pending;
}

/** Re-check that the on-disk root is the same instance the user confirmed. */
async function verifyConfirmedTarget(
  userDataBase: string,
  serverId: string,
  pending: PendingConfirmation,
): Promise<{ verified: VerifiedServerRoot; marker: ServerDataRootMarker }> {
  const verified = await verifyServerRoot(userDataBase, serverId);
  if (
    verified.realBase !== pending.realBase ||
    verified.realRoot !== pending.realRoot ||
    verified.rootInfo.dev !== pending.dev ||
    verified.rootInfo.ino !== pending.ino
  )
    throw new ServerDataError('target-changed', 'Server data root changed since the preview');
  const inspection = await readServerDataMarker(verified.root, serverId);
  if (inspection.state === 'missing')
    throw new ServerDataError('marker-missing', 'Server data root marker is missing');
  if (inspection.state === 'invalid')
    throw new ServerDataError('marker-invalid', 'Server data root marker is invalid');
  if (inspection.state === 'mismatch')
    throw new ServerDataError('marker-mismatch', 'Server data root belongs to another server');
  if (inspection.marker.rootId !== pending.rootId)
    throw new ServerDataError('target-changed', 'Server data root was recreated since the preview');
  return { verified, marker: inspection.marker };
}

interface RemovalContext {
  signal: AbortSignal | undefined;
  onProgress: ((progress: DeletionProgress) => void) | undefined;
  removedEntries: number;
  removedBytes: number;
  expectedEntries: number | undefined;
}

function report(context: RemovalContext, phase: DeletionProgress['phase']): void {
  const progress: DeletionProgress = {
    phase,
    removedEntries: context.removedEntries,
    removedBytes: context.removedBytes,
  };
  if (context.expectedEntries !== undefined) progress.expectedEntries = context.expectedEntries;
  context.onProgress?.(progress);
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Remove a symbolic link or junction itself; its target is never visited. */
async function removeLink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') return;
    // Windows directory links/junctions: rmdir deletes the reparse point, not the target.
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EISDIR')) {
      await rmdir(path);
      return;
    }
    throw error;
  }
}

async function removeNonDirectory(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') return;
    if (process.platform !== 'win32' || code !== 'EPERM') throw error;
    // Windows read-only attribute. chmod follows links, so re-confirm this is not one first.
    const info = await lstatOrUndefined(path);
    if (!info) return;
    if (info.isSymbolicLink() || info.isDirectory()) throw error;
    await chmod(path, 0o666);
    await unlink(path);
  }
}

async function removeChildren(
  directory: string,
  expected: Stats,
  depth: number,
  context: RemovalContext,
): Promise<void> {
  if (depth > MAX_DELETE_DEPTH)
    throw new ServerDataError('limit-exceeded', 'Server data is nested too deeply to delete');
  const current = await lstatOrUndefined(directory);
  if (
    !current?.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  )
    throw new ServerDataError('unsafe-path', 'A directory was replaced during deletion');
  for (const name of await readdir(directory)) {
    throwIfAborted(context.signal);
    if (depth === 0 && RESERVED_ROOT_ENTRIES.has(name)) continue;
    const path = join(directory, name);
    const info = await lstatOrUndefined(path);
    if (!info) continue;
    if (info.isSymbolicLink()) await removeLink(path);
    else if (info.isDirectory()) {
      await removeChildren(path, info, depth + 1, context);
      await rmdir(path);
    } else {
      await removeNonDirectory(path);
      if (info.isFile()) context.removedBytes += info.size;
    }
    context.removedEntries += 1;
    if (context.removedEntries % 128 === 0) report(context, 'deleting');
  }
}

function incomplete(error: unknown): ServerDataError {
  const cause = toServerDataError(error, 'Server data deletion failed');
  return new ServerDataError(
    'deletion-incomplete',
    `Server data was partially deleted (${cause.code}); preview and delete again to continue`,
    { cause },
  );
}

/**
 * Delete exactly one marked server root after `previewServerDataDeletion` issued `confirmation`.
 * Contents are removed under the maintenance lock; links are unlinked without being followed.
 * Any failure after the first removal is reported as `deletion-incomplete` and is resumable.
 */
export async function deleteServerData(
  userDataBase: string,
  serverId: string,
  confirmation: string,
  options: DeletionOptions = {},
): Promise<ServerDataDeletionResult> {
  resolveServerDataRoot(userDataBase, serverId);
  const pending = takeConfirmation(confirmation, userDataBase, serverId);
  throwIfAborted(options.signal);
  const { verified } = await verifyConfirmedTarget(userDataBase, serverId, pending);

  let lease: ServerDataLease;
  try {
    lease = await acquireServerDataLock(verified.root, 'maintenance');
  } catch (error) {
    if (error instanceof ServerDataLockedError)
      throw new ServerDataError('locked', 'Server data is in use by a game or installation', {
        cause: error,
      });
    throw toServerDataError(error, 'Unable to lock server data');
  }

  const context: RemovalContext = {
    signal: options.signal,
    onProgress: options.onProgress,
    removedEntries: 0,
    removedBytes: 0,
    expectedEntries: pending.expectedEntries,
  };
  let started = false;
  let failure: unknown;
  try {
    // Revalidate under the lock: the root could have changed while we waited.
    const locked = await verifyConfirmedTarget(userDataBase, serverId, pending);
    const deletion = await readDeletionMarker(locked.verified.root, locked.marker);
    if (deletion.state === 'invalid' || deletion.state === 'mismatch')
      throw new ServerDataError(
        deletion.state === 'invalid' ? 'marker-invalid' : 'marker-mismatch',
        'Server data deletion marker is not valid for this root',
      );
    throwIfAborted(options.signal);
    if (deletion.state === 'missing')
      await writeDeletionMarker(locked.verified.root, locked.marker);
    started = true;
    report(context, 'deleting');
    await removeChildren(locked.verified.root, locked.verified.rootInfo, 0, context);
  } catch (error) {
    failure = error;
  }
  try {
    await lease.release();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined)
    throw started ? incomplete(failure) : toServerDataError(failure, 'Server data deletion failed');

  // Finalize without the lock (its directory lives inside the root). Markers are removed only
  // when nothing else is left, so any newcomer keeps the root marked and resumable.
  try {
    report(context, 'finalizing');
    const final = await verifyConfirmedTarget(userDataBase, serverId, pending);
    const remaining = await readdir(final.verified.root);
    if (remaining.some((name) => name !== ROOT_MARKER_FILE && name !== DELETION_MARKER_FILE))
      throw new ServerDataError('locked', 'New data appeared in the server root during deletion');
    await unlink(join(final.verified.root, DELETION_MARKER_FILE)).catch((error: unknown) => {
      if (errnoCode(error) !== 'ENOENT') throw error;
    });
    await unlink(join(final.verified.root, ROOT_MARKER_FILE));
    await rmdir(final.verified.root);
  } catch (error) {
    throw incomplete(error);
  }
  return {
    status: 'deleted',
    root: verified.root,
    removedEntries: context.removedEntries,
    removedBytes: context.removedBytes,
  };
}
