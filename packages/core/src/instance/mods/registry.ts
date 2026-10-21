import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { checkedDirectory, collisionKey, maybeStat } from '../sync/safety.js';
import { readCanonical, validatePathSet, validateServerId, writeNew } from '../sync/state.js';
import { USER_MOD_LIMITS as L, UserModError } from './errors.js';
import { isValidModId } from './jar.js';

export interface UserModRecord {
  readonly path: string;
  readonly sha256: string;
  readonly length: number;
  readonly modIds: readonly string[];
  readonly addedAt: string;
}

export interface UserModRegistry {
  readonly version: 1;
  readonly serverId: string;
  readonly mods: readonly UserModRecord[];
}

export interface Intent {
  readonly version: 1;
  readonly op: 'register' | 'remove';
  readonly entry: UserModRecord;
}

export const USER_DIRECTORY = '.torchlauncher-user';

export function userPaths(root: string) {
  const dir = join(root, USER_DIRECTORY);
  return {
    dir,
    registry: join(dir, 'mods.json'),
    pending: join(dir, 'mods.json.pending'),
    intent: join(dir, 'mods-intent.json'),
    intentPending: join(dir, 'mods-intent.json.pending'),
    tmp: join(dir, 'tmp'),
  };
}

function bad(): never {
  throw new UserModError('invalid-state');
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).length !== keys.length || keys.some((key) => !Object.hasOwn(entry, key)))
    bad();
  return entry;
}

export function isJarPath(path: string): boolean {
  return path.startsWith('mods/') && path.toLowerCase().endsWith('.jar');
}

export function validateRecord(value: unknown): UserModRecord {
  const entry = exact(value, ['path', 'sha256', 'length', 'modIds', 'addedAt']);
  if (
    typeof entry.path !== 'string' ||
    !isJarPath(entry.path) ||
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
    typeof entry.length !== 'number' ||
    !Number.isSafeInteger(entry.length) ||
    entry.length < 0 ||
    entry.length > L.jarBytes ||
    typeof entry.addedAt !== 'string' ||
    entry.addedAt.length > 40 ||
    !Array.isArray(entry.modIds) ||
    entry.modIds.length > L.modIdsPerJar ||
    !entry.modIds.every(isValidModId) ||
    new Set(entry.modIds).size !== entry.modIds.length
  )
    bad();
  return {
    path: entry.path,
    sha256: entry.sha256,
    length: entry.length,
    modIds: entry.modIds as string[],
    addedAt: entry.addedAt,
  };
}

/** Rejects unsafe or case/Unicode-colliding paths and duplicate mod IDs across registered mods. */
export function validateRecords(records: readonly UserModRecord[], serverId: string): void {
  if (records.length > L.registeredMods) throw new UserModError('limit-exceeded');
  try {
    validatePathSet(
      records.map((record) => ({ path: record.path, policy: 'always' as const })),
      serverId,
    );
  } catch {
    bad();
  }
  const keys = new Set(records.map((record) => collisionKey(record.path)));
  if (keys.size !== records.length) bad();
  const ids = new Set<string>();
  for (const record of records)
    for (const id of record.modIds) {
      if (ids.has(id)) bad();
      ids.add(id);
    }
}

export async function ensureUserDirectory(root: string): Promise<void> {
  const { dir } = userPaths(root);
  if (!(await maybeStat(dir))) await mkdir(dir, { mode: 0o700 });
  await checkedDirectory(dir);
}

export async function readRegistry(root: string, serverId: string): Promise<UserModRegistry> {
  validateServerIdOrThrow(serverId);
  const paths = userPaths(root);
  const dir = await maybeStat(paths.dir);
  if (!dir) return { version: 1, serverId, mods: [] };
  await checkedDirectory(paths.dir);
  const value = await readCanonical(paths.registry, L.registryBytes);
  if (value === undefined) return { version: 1, serverId, mods: [] };
  const entry = exact(value, ['version', 'serverId', 'mods']);
  if (entry.version !== 1 || entry.serverId !== serverId || !Array.isArray(entry.mods)) bad();
  if (entry.mods.length > L.registeredMods) throw new UserModError('limit-exceeded');
  const mods = entry.mods.map(validateRecord);
  validateRecords(mods, serverId);
  return { version: 1, serverId, mods };
}

export function validateServerIdOrThrow(serverId: string): void {
  try {
    validateServerId(serverId);
  } catch {
    throw new UserModError('invalid-server-id');
  }
}

async function replaceAtomically(final: string, pending: string, value: unknown, max: number) {
  if (await maybeStat(pending)) await unlink(pending);
  await writeNew(pending, value, max);
  await rename(pending, final);
}

export async function writeRegistry(root: string, registry: UserModRegistry): Promise<void> {
  validateRecords(registry.mods, registry.serverId);
  await ensureUserDirectory(root);
  const paths = userPaths(root);
  await replaceAtomically(paths.registry, paths.pending, registry, L.registryBytes);
}

export async function readIntent(root: string): Promise<Intent | null> {
  const paths = userPaths(root);
  if (!(await maybeStat(paths.dir))) return null;
  await checkedDirectory(paths.dir);
  const value = await readCanonical(paths.intent, L.intentBytes);
  if (value === undefined) return null;
  const entry = exact(value, ['version', 'op', 'entry']);
  if (entry.version !== 1 || (entry.op !== 'register' && entry.op !== 'remove')) bad();
  return { version: 1, op: entry.op, entry: validateRecord(entry.entry) };
}

export async function writeIntent(root: string, intent: Intent): Promise<void> {
  await ensureUserDirectory(root);
  const paths = userPaths(root);
  await replaceAtomically(paths.intent, paths.intentPending, intent, L.intentBytes);
}

export async function clearIntent(root: string): Promise<void> {
  const paths = userPaths(root);
  await rm(paths.intent, { force: true });
  await rm(paths.intentPending, { force: true });
}

export async function newTemporaryFile(root: string): Promise<string> {
  const paths = userPaths(root);
  await ensureUserDirectory(root);
  if (!(await maybeStat(paths.tmp))) await mkdir(paths.tmp, { mode: 0o700 });
  await checkedDirectory(paths.tmp);
  return join(paths.tmp, `${randomUUID()}.jar`);
}

/** Removes leftover temporary copies; entries are unlinked, never followed. */
export async function clearTemporary(root: string): Promise<number> {
  const paths = userPaths(root);
  if (!(await maybeStat(paths.dir)) || !(await maybeStat(paths.tmp))) return 0;
  await checkedDirectory(paths.tmp);
  const names = await readdir(paths.tmp);
  for (const name of names) await rm(join(paths.tmp, name), { recursive: true, force: true });
  return names.length;
}
