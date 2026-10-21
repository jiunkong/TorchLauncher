import { createHash } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DEPLOYMENT_LIMITS } from '../../deployment/contracts/index.js';
import { SynchronizationError } from './types.js';

export interface Digest {
  readonly sha256: string;
  readonly length: number;
}

export interface LocalFile extends Digest {
  readonly stat: BigIntStats;
}

export function fail(code: SynchronizationError['code'], cause?: unknown): never {
  throw new SynchronizationError(code, cause === undefined ? undefined : { cause });
}

export function collisionKey(path: string): string {
  return path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

export function protectPath(path: string): void {
  const top = collisionKey(path).split('/')[0] ?? '';
  if (
    top.startsWith('.torchlauncher') ||
    ['runtime', 'versions', 'libraries', 'assets', 'natives', 'accounts', 'public-java'].includes(
      top,
    )
  )
    fail('unsafe-path');
}

export async function maybeStat(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function sameStat(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mode === b.mode &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.nlink === b.nlink
  );
}

export function sameDigest(a: Digest | null, b: Digest | null): boolean {
  return a === null || b === null ? a === b : a.sha256 === b.sha256 && a.length === b.length;
}

export async function checkedDirectory(path: string): Promise<void> {
  const stat = await maybeStat(path);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail('unsafe-path');
}

export async function checkSpelling(parent: string, component: string): Promise<string> {
  const names = await readdir(parent);
  if (names.length > 100_000) fail('limit-exceeded');
  const matching = names.filter((name) => collisionKey(name) === collisionKey(component));
  if (
    matching.length > 1 ||
    (matching.length === 1 && matching[0]?.normalize('NFC') !== component.normalize('NFC'))
  )
    fail('conflict');
  return matching[0] ?? component;
}

/** Paths have already passed the deployment contract. This also checks real disk spelling. */
export async function gamePath(root: string, path: string, createParents = false): Promise<string> {
  await checkedDirectory(root);
  const parts = path.split('/');
  let parent = root;
  for (const component of parts.slice(0, -1)) {
    const diskComponent = await checkSpelling(parent, component);
    const child = join(parent, diskComponent);
    let stat = await maybeStat(child);
    if (!stat) {
      if (!createParents) return join(root, ...parts);
      await mkdir(child);
      stat = await maybeStat(child);
    }
    if (stat?.isFile()) fail('conflict');
    if (!stat?.isDirectory() || stat.isSymbolicLink()) fail('unsafe-path');
    parent = child;
  }
  const name = parts.at(-1);
  if (!name) fail('unsafe-path');
  const diskName = await checkSpelling(parent, name);
  return join(parent, diskName);
}

export async function readLocalFile(path: string, signal?: AbortSignal): Promise<LocalFile | null> {
  const before = await maybeStat(path);
  if (!before) return null;
  if (before.isDirectory()) fail('conflict');
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail('unsafe-path');
  if (before.size > BigInt(DEPLOYMENT_LIMITS.fileLength)) fail('limit-exceeded');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!sameStat(before, await handle.stat({ bigint: true }))) fail('local-changed');
    const hash = createHash('sha256');
    const bytes = Buffer.allocUnsafe(256 * 1024);
    let length = 0;
    while (true) {
      signal?.throwIfAborted();
      const read = await handle.read(bytes, 0, bytes.length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
      if (length > Number(before.size)) fail('local-changed');
      hash.update(bytes.subarray(0, read.bytesRead));
    }
    const after = await maybeStat(path);
    if (
      !after ||
      !sameStat(before, after) ||
      !sameStat(before, await handle.stat({ bigint: true })) ||
      length !== Number(before.size)
    )
      fail('local-changed');
    return { length, sha256: hash.digest('hex'), stat: before };
  } finally {
    await handle.close();
  }
}

export async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten === 0) throw new Error('File write made no progress');
    offset += result.bytesWritten;
  }
}

export async function checkRootAncestors(root: string): Promise<void> {
  const absolute = resolve(root);
  const parent = dirname(absolute);
  if (parent !== absolute) await checkRootAncestors(parent);
  const stat = await maybeStat(absolute);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail('unsafe-path');
}
