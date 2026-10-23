import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import { checkedDirectory, gamePath, maybeStat, sameStat, writeAll } from '../sync/safety.js';
import { SynchronizationError } from '../sync/types.js';
import { validConfigKey, validConfigPath, validOptionKey } from './policy.js';
import {
  SETTINGS_LIMITS,
  SETTINGS_STATE_PATH,
  SettingsError,
  type SettingsOperationOptions,
} from './types.js';

/** Translate lower-level failures into the typed settings error. */
export function wrap(error: unknown): never {
  if (error instanceof SettingsError) throw error;
  if (error instanceof Error && error.name === 'ServerDataLockedError')
    throw new SettingsError('locked', 'server data is in use', { cause: error });
  if (error instanceof Error && error.name === 'AbortError')
    throw new SettingsError('aborted', 'operation aborted', { cause: error });
  if (error instanceof SynchronizationError) {
    const code =
      error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'local-changed'
          ? 'file-changed'
          : 'unsafe-path';
    throw new SettingsError(code, `unsafe or conflicting path (${error.code})`, { cause: error });
  }
  throw new SettingsError('io-error', error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

export async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return wrap(error);
  }
}

export async function withMaintenanceLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  return guarded(async () => {
    const lease = await acquireServerDataLock(root, 'maintenance');
    try {
      return await work();
    } finally {
      await lease.release();
    }
  });
}

export interface ReadFile {
  bytes: Uint8Array;
  stat: NonNullable<Awaited<ReturnType<typeof maybeStat>>>;
}

export async function resolveGamePath(
  root: string,
  path: string,
  createParents = false,
): Promise<string> {
  await checkedDirectory(root);
  return gamePath(root, path, createParents);
}

/** Read a regular, non-linked file up to `limit` bytes; null when absent. */
export async function readBounded(
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ReadFile | null> {
  signal?.throwIfAborted();
  const before = await maybeStat(path);
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
    throw new SettingsError('unsafe-path', `not a plain file: ${basename(path)}`);
  if (before.size > BigInt(limit))
    throw new SettingsError('limit-exceeded', `${basename(path)} is too large`);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!sameStat(before, await handle.stat({ bigint: true })))
      throw new SettingsError('file-changed', `${basename(path)} changed while reading`);
    const buffer = Buffer.allocUnsafe(Number(before.size));
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const probe = await handle.read(Buffer.allocUnsafe(1), 0, 1, length);
    const after = await maybeStat(path);
    if (length !== buffer.length || probe.bytesRead !== 0 || !after || !sameStat(before, after))
      throw new SettingsError('file-changed', `${basename(path)} changed while reading`);
    return { bytes: buffer, stat: before };
  } finally {
    await handle.close();
  }
}

/**
 * Write through a temporary sibling and an atomic rename. `expected` is the stat seen when the
 * content was read (undefined = file must not exist); a mismatch aborts without touching the target.
 */
export async function atomicWrite(
  path: string,
  bytes: Uint8Array,
  expected: ReadFile['stat'] | undefined,
  options: SettingsOperationOptions = {},
  mode = 0o644,
): Promise<void> {
  options.signal?.throwIfAborted();
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', mode);
  try {
    try {
      await writeAll(handle, bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.onBeforeCommit?.(path);
    options.signal?.throwIfAborted();
    const current = await maybeStat(path);
    if (expected ? !current || !sameStat(expected, current) : current)
      throw new SettingsError('file-changed', `${basename(path)} changed before commit`);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export interface SettingsState {
  /** 1: options.txt only. 2: also records first configuration per config file. */
  version: 1 | 2;
  /** null until the first configuration has completed. */
  initial: {
    keys: string[];
    resourcePacks: boolean;
    /** Config file path -> initial keys already handled (version 2 only). */
    files?: Record<string, string[]>;
  } | null;
}

export const EMPTY_STATE: SettingsState = { version: 1, initial: null };

export function parseState(bytes: Uint8Array): SettingsState {
  const invalid = (cause?: unknown): never => {
    throw new SettingsError('invalid-state', 'settings.json is invalid', { cause });
  };
  if (bytes.byteLength > SETTINGS_LIMITS.stateBytes)
    throw new SettingsError('limit-exceeded', 'settings.json is too large');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    return invalid(cause);
  }
  const record = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)))
      return invalid();
    return r;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const version = (value as Record<string, unknown>).version;
  if (version !== 1 && version !== 2) return invalid();
  const top = record(value, ['version', 'initial']);
  if (top.initial === null) return { version, initial: null };
  const initial = record(
    top.initial,
    version === 2 ? ['keys', 'resourcePacks', 'files'] : ['keys', 'resourcePacks'],
  );
  const keys = initial.keys;
  if (
    !Array.isArray(keys) ||
    keys.length > SETTINGS_LIMITS.keysPerMap * 2 ||
    keys.some((k) => typeof k !== 'string' || !validOptionKey(k)) ||
    new Set(keys).size !== keys.length ||
    typeof initial.resourcePacks !== 'boolean'
  )
    return invalid();
  const result: SettingsState = {
    version,
    initial: { keys: keys as string[], resourcePacks: initial.resourcePacks },
  };
  if (version === 2) {
    const raw = initial.files;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > SETTINGS_LIMITS.stateFiles) return invalid();
    const files: Record<string, string[]> = Object.create(null);
    for (const [path, list] of entries) {
      if (
        !validConfigPath(path) ||
        !Array.isArray(list) ||
        list.length > SETTINGS_LIMITS.keysPerMap ||
        list.some((k) => typeof k !== 'string' || !validConfigKey(k)) ||
        new Set(list).size !== list.length
      )
        return invalid();
      files[path] = list as string[];
    }
    (result.initial as { files?: Record<string, string[]> }).files = files;
  }
  return result;
}

export async function readState(
  root: string,
  signal?: AbortSignal,
): Promise<{ state: SettingsState; file: ReadFile | null; path: string }> {
  const path = await resolveGamePath(root, SETTINGS_STATE_PATH);
  const file = await readBounded(path, SETTINGS_LIMITS.stateBytes, signal);
  return { state: file ? parseState(file.bytes) : EMPTY_STATE, file, path };
}

export async function writeState(
  root: string,
  state: SettingsState,
  expected: ReadFile | null,
  options: SettingsOperationOptions,
): Promise<void> {
  const path = await resolveGamePath(root, SETTINGS_STATE_PATH, true);
  const files = state.initial?.files;
  const sorted: SettingsState = state.initial
    ? {
        ...state,
        initial: {
          ...state.initial,
          keys: [...state.initial.keys].sort(),
          ...(files
            ? {
                files: Object.fromEntries(
                  Object.keys(files)
                    .sort()
                    .map((path) => [path, [...(files[path] ?? [])].sort()]),
                ),
              }
            : {}),
        },
      }
    : state;
  // The state commit must not reuse the options.txt failure seam.
  await atomicWrite(
    path,
    new TextEncoder().encode(`${JSON.stringify(sorted)}\n`),
    expected?.stat,
    options.signal ? { signal: options.signal } : {},
    0o600,
  );
}
