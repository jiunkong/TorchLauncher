import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { acquireServerDataLock, ServerDataLockedError } from '../../minecraft/lock.js';
import { readSyncOwnership, type SyncOwnership } from '../sync/ownership.js';
import {
  checkedDirectory,
  collisionKey,
  gamePath,
  maybeStat,
  readLocalFile,
  sameStat,
  writeAll,
} from '../sync/safety.js';
import { validatePathSet } from '../sync/state.js';
import { SynchronizationError } from '../sync/types.js';
import { USER_MOD_LIMITS as L, UserModError, type UserModErrorCode } from './errors.js';
import { type JarInfo, type JarWarningCode, readJarInfo } from './jar.js';
import {
  clearIntent,
  clearTemporary,
  isJarPath,
  newTemporaryFile,
  readIntent,
  readRegistry,
  type UserModRecord,
  type UserModRegistry,
  userPaths,
  validateServerIdOrThrow,
  writeIntent,
  writeRegistry,
} from './registry.js';

export type UserModProgress =
  | {
      readonly phase: 'recovering' | 'verifying' | 'registering' | 'removing';
      readonly path?: string;
    }
  | { readonly phase: 'copying'; readonly bytes: number; readonly total: number };

export interface UserModOptions {
  /** Server data root (the single game directory for this server). */
  readonly root: string;
  readonly serverId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: UserModProgress) => void | Promise<void>;
}

export interface RegisterUserModOptions extends UserModOptions {
  /** External .jar file chosen by the user. It is copied, never moved or linked. */
  readonly sourcePath: string;
}
export interface UserModPathOptions extends UserModOptions {
  /** Server-relative portable path such as `mods/example.jar`. */
  readonly path: string;
}
export interface RemoveUserModOptions extends UserModPathOptions {
  /** Delete the file even if its content no longer matches the registered hash. */
  readonly force?: boolean;
}
export interface RemoveUnregisteredOptions extends UserModPathOptions {
  /** If given, the file is only deleted when its SHA-256 still matches what the UI showed. */
  readonly expectedSha256?: string;
}

export type UserModWarning = JarWarningCode;
export interface UserModRegistration {
  readonly mod: UserModRecord;
  readonly warnings: readonly UserModWarning[];
  /** False when an identical unregistered file already existed at the target path. */
  readonly copied: boolean;
}
export interface UserModRemoval {
  readonly path: string;
  readonly fileDeleted: boolean;
}
export type RecoveryOutcome = 'none' | 'registered' | 'removed' | 'discarded';
export interface UserModRecovery {
  readonly outcome: RecoveryOutcome;
  readonly temporaryRemoved: number;
}

export type ModSource = 'operator' | 'user' | 'unregistered';
export type ModState = 'ok' | 'missing' | 'modified' | 'unsafe';
export interface ModConflict {
  readonly kind: 'path' | 'mod-id';
  readonly modId?: string;
  readonly with: string;
}
export interface ModListEntry {
  readonly path: string;
  readonly source: ModSource;
  readonly state: ModState;
  readonly length?: number;
  readonly sha256?: string;
  readonly modIds: readonly string[];
  readonly conflicts: readonly ModConflict[];
}
export interface ModListing {
  readonly entries: readonly ModListEntry[];
  /** True when an interrupted operation is pending; the next mutating call (or recoverUserMods) repairs it. */
  readonly recoveryRequired: boolean;
  readonly warnings: readonly string[];
}

const SYNC_TO_USER: Partial<Record<SynchronizationError['code'], UserModErrorCode>> = {
  'unsafe-path': 'unsafe-path',
  conflict: 'path-conflict',
  'local-changed': 'local-changed',
  'limit-exceeded': 'limit-exceeded',
  'recovery-required': 'sync-recovery-required',
};

function mapError(error: unknown): unknown {
  if (error instanceof ServerDataLockedError)
    return new UserModError('locked', undefined, { cause: error });
  if (error instanceof SynchronizationError)
    return new UserModError(SYNC_TO_USER[error.code] ?? 'invalid-state', undefined, {
      cause: error,
    });
  return error;
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapError(error);
  }
}

async function locked<T>(options: UserModOptions, operation: () => Promise<T>): Promise<T> {
  validateServerIdOrThrow(options.serverId);
  return guard(async () => {
    const lease = await acquireServerDataLock(options.root, 'maintenance');
    try {
      await checkedDirectory(lease.root);
      return await operation();
    } finally {
      await lease.release();
    }
  });
}

async function report(options: UserModOptions, progress: UserModProgress): Promise<void> {
  options.signal?.throwIfAborted();
  await options.onProgress?.(progress);
}

function validateModPath(serverId: string, path: string): void {
  try {
    validatePathSet([{ path, policy: 'always' }], serverId);
  } catch {
    throw new UserModError('invalid-path', { path });
  }
  if (!path.startsWith('mods/') || path === 'mods/')
    throw new UserModError('invalid-path', { path });
}

const find = <T extends { path: string }>(items: readonly T[], path: string): T | undefined =>
  items.find((item) => collisionKey(item.path) === collisionKey(path));

async function ownership(root: string, serverId: string): Promise<SyncOwnership | null> {
  return readSyncOwnership(root, serverId);
}

/** Mod IDs of operator-owned jars that currently exist on disk. */
async function operatorModIds(
  root: string,
  owned: SyncOwnership | null,
  signal?: AbortSignal,
): Promise<{ ids: Map<string, string>; warnings: string[] }> {
  const ids = new Map<string, string>();
  const warnings: string[] = [];
  let parsed = 0;
  for (const file of owned?.files ?? []) {
    if (!isJarPath(file.path)) continue;
    signal?.throwIfAborted();
    if (++parsed > L.operatorJarsParsed) {
      warnings.push('operator-jar-limit');
      break;
    }
    try {
      const target = await gamePath(root, file.path);
      if (!(await maybeStat(target))) continue;
      for (const id of (await readJarInfo(target)).modIds) if (!ids.has(id)) ids.set(id, file.path);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      warnings.push(`operator-jar-unreadable:${file.path}`);
    }
  }
  return { ids, warnings };
}

function assertNoIdConflict(
  modIds: readonly string[],
  registry: UserModRegistry,
  operatorIds: Map<string, string>,
  selfPath: string,
): void {
  const conflicts = new Set<string>();
  for (const id of modIds) {
    const operator = operatorIds.get(id);
    if (operator) conflicts.add(operator);
    for (const other of registry.mods)
      if (collisionKey(other.path) !== collisionKey(selfPath) && other.modIds.includes(id))
        conflicts.add(other.path);
  }
  if (conflicts.size > 0)
    throw new UserModError('mod-id-conflict', { path: selfPath, conflictsWith: [...conflicts] });
}

async function recoverLocked(options: UserModOptions): Promise<UserModRecovery> {
  const { root, serverId } = options;
  await report(options, { phase: 'recovering' });
  const temporaryRemoved = await clearTemporary(root);
  const intent = await readIntent(root);
  if (!intent) return { outcome: 'none', temporaryRemoved };
  const registry = await readRegistry(root, serverId);
  const { entry } = intent;
  const target = await gamePath(root, entry.path);
  const file = await readLocalFile(target);
  const matches = file !== null && file.sha256 === entry.sha256 && file.length === entry.length;
  const known = find(registry.mods, entry.path);
  let outcome: RecoveryOutcome;
  if (intent.op === 'register') {
    const owned = await ownership(root, serverId);
    if (known) outcome = 'registered';
    else if (matches && !find(owned?.files ?? [], entry.path)) {
      await writeRegistry(root, { ...registry, mods: [...registry.mods, entry] });
      outcome = 'registered';
    } else outcome = 'discarded';
  } else {
    const owned = await ownership(root, serverId);
    if (matches && !find(owned?.files ?? [], entry.path)) await unlink(target);
    if (known)
      await writeRegistry(root, { ...registry, mods: registry.mods.filter((m) => m !== known) });
    outcome = 'removed';
  }
  await clearIntent(root);
  return { outcome, temporaryRemoved };
}

export function recoverUserMods(options: UserModOptions): Promise<UserModRecovery> {
  return locked(options, () => recoverLocked(options));
}

async function copyJar(
  options: RegisterUserModOptions,
  destination: string,
): Promise<{ sha256: string; length: number }> {
  const source = resolve(options.sourcePath);
  const before = await maybeStat(source);
  if (!before?.isFile() || before.isSymbolicLink()) throw new UserModError('invalid-source');
  if (before.size > BigInt(L.jarBytes)) throw new UserModError('limit-exceeded');
  const input = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!sameStat(before, await input.stat({ bigint: true })))
      throw new UserModError('local-changed');
    const output = await open(destination, 'wx', 0o644);
    try {
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(256 * 1024);
      const total = Number(before.size);
      let length = 0;
      while (true) {
        options.signal?.throwIfAborted();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
        if (length > total) throw new UserModError('local-changed');
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        await writeAll(output, chunk);
        await report(options, { phase: 'copying', bytes: length, total });
      }
      const after = await maybeStat(source);
      if (length !== total || !after || !sameStat(before, after))
        throw new UserModError('local-changed');
      await output.sync();
      return { sha256: hash.digest('hex'), length };
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

/** Copies an external jar to mods/<name> and records it as user-owned. */
export function registerUserMod(options: RegisterUserModOptions): Promise<UserModRegistration> {
  return locked(options, async () => {
    const { root, serverId } = options;
    const name = basename(options.sourcePath);
    const path = `mods/${name}`;
    if (!name.toLowerCase().endsWith('.jar') || name.length <= 4)
      throw new UserModError('invalid-extension', { path });
    validateModPath(serverId, path);
    await recoverLocked(options);
    const owned = await ownership(root, serverId);
    if (find(owned?.files ?? [], path)) throw new UserModError('path-conflict', { path });
    const registry = await readRegistry(root, serverId);
    if (find(registry.mods, path)) throw new UserModError('already-registered', { path });
    if (registry.mods.length >= L.registeredMods) throw new UserModError('limit-exceeded');

    const temporary = await newTemporaryFile(root);
    try {
      const digest = await copyJar(options, temporary);
      await report(options, { phase: 'verifying', path });
      const info: JarInfo = await readJarInfo(temporary);
      const { ids: operatorIds } = await operatorModIds(root, owned, options.signal);
      assertNoIdConflict(info.modIds, registry, operatorIds, path);

      const target = await gamePath(root, path, true);
      const existing = await readLocalFile(target, options.signal);
      if (existing && (existing.sha256 !== digest.sha256 || existing.length !== digest.length))
        throw new UserModError('path-conflict', { path });
      const mod: UserModRecord = {
        path,
        sha256: digest.sha256,
        length: digest.length,
        modIds: info.modIds,
        addedAt: new Date().toISOString(),
      };
      await report(options, { phase: 'registering', path });
      // Past this point the operation always runs to completion or is repaired by recovery.
      await writeIntent(root, { version: 1, op: 'register', entry: mod });
      if (!existing) {
        if (await maybeStat(target)) throw new UserModError('path-conflict', { path });
        await rename(temporary, target);
      }
      await writeRegistry(root, { ...registry, mods: [...registry.mods, mod] });
      await clearIntent(root);
      return { mod, warnings: info.warnings, copied: !existing };
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  });
}

/** Deletes a registered user mod's file and registry entry. Operator-owned paths are never deleted. */
export function removeUserMod(options: RemoveUserModOptions): Promise<UserModRemoval> {
  return locked(options, async () => {
    const { root, serverId, path } = options;
    validateModPath(serverId, path);
    await recoverLocked(options);
    const registry = await readRegistry(root, serverId);
    const entry = find(registry.mods, path);
    if (!entry) throw new UserModError('not-registered', { path });
    const owned = await ownership(root, serverId);
    const operatorOwns = find(owned?.files ?? [], entry.path) !== undefined;
    const target = await gamePath(root, entry.path);
    const file = operatorOwns ? null : await readLocalFile(target, options.signal);
    if (file && (file.sha256 !== entry.sha256 || file.length !== entry.length) && !options.force)
      throw new UserModError('local-changed', { path });
    await report(options, { phase: 'removing', path: entry.path });
    await writeIntent(root, { version: 1, op: 'remove', entry });
    if (file) await unlink(target);
    await writeRegistry(root, { ...registry, mods: registry.mods.filter((mod) => mod !== entry) });
    await clearIntent(root);
    return { path: entry.path, fileDeleted: file !== null };
  });
}

/** Explicitly registers an existing unregistered jar under mods/ as a user mod. */
export function adoptUnregistered(options: UserModPathOptions): Promise<UserModRegistration> {
  return locked(options, async () => {
    const { root, serverId, path } = options;
    validateModPath(serverId, path);
    if (!isJarPath(path)) throw new UserModError('invalid-extension', { path });
    await recoverLocked(options);
    const owned = await ownership(root, serverId);
    if (find(owned?.files ?? [], path)) throw new UserModError('path-conflict', { path });
    const registry = await readRegistry(root, serverId);
    if (find(registry.mods, path)) throw new UserModError('already-registered', { path });
    if (registry.mods.length >= L.registeredMods) throw new UserModError('limit-exceeded');
    const target = await gamePath(root, path);
    await report(options, { phase: 'verifying', path });
    const file = await readLocalFile(target, options.signal);
    if (!file) throw new UserModError('not-found', { path });
    const info = await readJarInfo(target);
    const after = await maybeStat(target);
    if (!after || !sameStat(file.stat, after)) throw new UserModError('local-changed', { path });
    const { ids: operatorIds } = await operatorModIds(root, owned, options.signal);
    assertNoIdConflict(info.modIds, registry, operatorIds, path);
    const mod: UserModRecord = {
      path,
      sha256: file.sha256,
      length: file.length,
      modIds: info.modIds,
      addedAt: new Date().toISOString(),
    };
    await report(options, { phase: 'registering', path });
    await writeRegistry(root, { ...registry, mods: [...registry.mods, mod] });
    return { mod, warnings: info.warnings, copied: false };
  });
}

/** Deletes one unregistered file. Only runs on an explicit request for that exact path. */
export function removeUnregistered(options: RemoveUnregisteredOptions): Promise<UserModRemoval> {
  return locked(options, async () => {
    const { root, serverId, path } = options;
    validateModPath(serverId, path);
    await recoverLocked(options);
    const owned = await ownership(root, serverId);
    if (find(owned?.files ?? [], path)) throw new UserModError('not-unregistered', { path });
    const registry = await readRegistry(root, serverId);
    if (find(registry.mods, path)) throw new UserModError('not-unregistered', { path });
    const target = await gamePath(root, path);
    const stat = await maybeStat(target);
    if (!stat) throw new UserModError('not-found', { path });
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new UserModError('unsafe-path', { path });
    if (options.expectedSha256 !== undefined) {
      const file = await readLocalFile(target, options.signal);
      if (file?.sha256 !== options.expectedSha256)
        throw new UserModError('local-changed', { path });
    }
    await report(options, { phase: 'removing', path });
    await unlink(target);
    return { path, fileDeleted: true };
  });
}

async function walkMods(
  root: string,
  signal?: AbortSignal,
): Promise<{ path: string; kind: 'file' | 'other' }[]> {
  const base = join(root, 'mods');
  const stat = await maybeStat(base);
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UserModError('unsafe-path');
  const found: { path: string; kind: 'file' | 'other' }[] = [];
  const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (found.length >= L.listedFiles) throw new UserModError('limit-exceeded');
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth >= L.listedDepth) throw new UserModError('limit-exceeded');
        await visit(join(directory, entry.name), relative, depth + 1);
      } else found.push({ path: relative, kind: entry.isFile() ? 'file' : 'other' });
    }
  };
  await visit(base, 'mods', 0);
  return found;
}

/** Read-only classification of everything under mods/. No lock is required. */
export function listMods(options: UserModOptions): Promise<ModListing> {
  validateServerIdOrThrow(options.serverId);
  return guard(async () => {
    const { root, serverId, signal } = options;
    await checkedDirectory(root);
    const registry = await readRegistry(root, serverId);
    const recoveryRequired = (await readIntent(root)) !== null || (await hasTemporary(root));
    const owned = await ownership(root, serverId);
    const operatorFiles = (owned?.files ?? []).filter((file) => file.path.startsWith('mods/'));
    const operatorKeys = new Map(operatorFiles.map((file) => [collisionKey(file.path), file]));
    const userKeys = new Map(registry.mods.map((mod) => [collisionKey(mod.path), mod]));
    const disk = await walkMods(root, signal);
    const onDisk = new Map(disk.map((file) => [collisionKey(file.path), file]));
    const { ids: operatorIds, warnings } = await operatorModIds(root, owned, signal);
    const entries: ModListEntry[] = [];

    for (const file of disk) {
      const key = collisionKey(file.path);
      if (userKeys.has(key) || operatorKeys.has(key)) continue;
      const stat = await maybeStat(join(root, ...file.path.split('/')));
      entries.push({
        path: file.path,
        source: 'unregistered',
        state: file.kind === 'file' && stat?.nlink === 1n ? 'ok' : 'unsafe',
        ...(stat?.isFile() ? { length: Number(stat.size) } : {}),
        modIds: [],
        conflicts: [],
      });
    }
    for (const file of operatorFiles) {
      const disk = onDisk.get(collisionKey(file.path));
      entries.push({
        path: file.path,
        source: 'operator',
        state: !disk ? 'missing' : disk.kind === 'file' ? 'ok' : 'unsafe',
        length: file.length,
        sha256: file.sha256,
        modIds: [...operatorIds].filter(([, path]) => path === file.path).map(([id]) => id),
        conflicts: userKeys.has(collisionKey(file.path)) ? [{ kind: 'path', with: file.path }] : [],
      });
    }
    for (const mod of registry.mods) {
      const key = collisionKey(mod.path);
      const disk = onDisk.get(key);
      let state: ModState = 'missing';
      if (disk) {
        state = 'unsafe';
        if (disk.kind === 'file')
          try {
            const local = await readLocalFile(join(root, ...mod.path.split('/')), signal);
            state = local?.sha256 === mod.sha256 && local.length === mod.length ? 'ok' : 'modified';
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') throw error;
          }
      }
      const conflicts: ModConflict[] = [];
      if (operatorKeys.has(key)) conflicts.push({ kind: 'path', with: mod.path });
      for (const id of mod.modIds) {
        const operator = operatorIds.get(id);
        if (operator && collisionKey(operator) !== key)
          conflicts.push({ kind: 'mod-id', modId: id, with: operator });
        for (const other of registry.mods)
          if (other !== mod && other.modIds.includes(id))
            conflicts.push({ kind: 'mod-id', modId: id, with: other.path });
      }
      entries.push({
        path: mod.path,
        source: 'user',
        state,
        length: mod.length,
        sha256: mod.sha256,
        modIds: mod.modIds,
        conflicts,
      });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { entries, recoveryRequired, warnings };
  });
}

async function hasTemporary(root: string): Promise<boolean> {
  const { tmp } = userPaths(root);
  if (!(await maybeStat(tmp))) return false;
  return (await readdir(tmp)).length > 0;
}
