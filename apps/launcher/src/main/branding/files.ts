import { randomUUID } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return !!child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
function identity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return (
    identity(a, b) &&
    a.nlink === b.nlink &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

async function directoryChain(directory: string): Promise<Map<string, BigIntStats>> {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  const chain = new Map<string, BigIntStats>();
  for (const part of ['', ...relative(current, absolute).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-branding-parent');
    chain.set(current, stat);
  }
  return chain;
}
async function verifyChain(chain: ReadonlyMap<string, BigIntStats>): Promise<void> {
  for (const [path, previous] of chain) {
    const current = await lstat(path, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !identity(previous, current))
      throw new Error('changed-branding-parent');
  }
}
async function maybeFile(path: string): Promise<BigIntStats | undefined> {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
      throw new Error('unsafe-branding-file');
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Only descendants of an existing trusted root; no link components, hardlinks, or unbounded reads. */
export async function readBrandingFile(
  rootInput: string,
  path: string,
  maximum: number,
): Promise<Buffer> {
  const root = resolve(rootInput);
  const absolute = resolve(root, path);
  if (!within(root, absolute)) throw new Error('unsafe-branding-file');
  const parents = await directoryChain(join(absolute, '..'));
  const canonicalRoot = await realpath(root);
  if (!within(canonicalRoot, await realpath(absolute))) throw new Error('unsafe-branding-file');
  const before = await lstat(absolute, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size > BigInt(maximum)
  )
    throw new Error('unsafe-branding-file');
  await verifyChain(parents);
  const file = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!same(before, await file.stat({ bigint: true }))) throw new Error('changed-branding-file');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const next = await file.read(bytes, size, bytes.length - size, size);
      if (!next.bytesRead) break;
      size += next.bytesRead;
    }
    if (
      size !== Number(before.size) ||
      !same(before, await file.stat({ bigint: true })) ||
      !same(before, await lstat(absolute, { bigint: true }))
    )
      throw new Error('changed-branding-file');
    await verifyChain(parents);
    if (!within(canonicalRoot, await realpath(absolute))) throw new Error('unsafe-branding-file');
    return bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

/** Create/verify each directory below userData, rejecting pre-existing links at every level. */
export async function ensureBrandingDirectory(
  base: string,
  components: readonly string[],
): Promise<string> {
  let current = resolve(base);
  const parents = await directoryChain(current);
  for (const part of components) {
    if (!/^[a-zA-Z0-9-]+$/.test(part)) throw new Error('unsafe-branding-cache');
    current = join(current, part);
    await verifyChain(parents);
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    });
    await verifyChain(parents);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-branding-cache');
    parents.set(current, stat);
  }
  await verifyChain(parents);
  return current;
}

/** Caller serializes commits and checks its generation immediately before rename. */
export async function atomicBrandingRecord(
  directory: string,
  filename: string,
  bytes: Buffer,
  current: () => void,
): Promise<void> {
  const parents = await directoryChain(directory);
  if (!/^(icon|background)\.json$/.test(filename)) throw new Error('unsafe-branding-cache');
  const destination = join(directory, filename);
  const original = await maybeFile(destination);
  const temporary = join(directory, `pending-${randomUUID()}`);
  let created: BigIntStats | undefined;
  try {
    await verifyChain(parents);
    const file = await open(temporary, 'wx', 0o600);
    try {
      created = await file.stat({ bigint: true });
      await file.writeFile(bytes);
      await file.sync();
      const after = await file.stat({ bigint: true });
      if (!identity(created, after) || after.nlink !== 1n || after.size !== BigInt(bytes.length))
        throw new Error('changed-branding-cache');
    } finally {
      await file.close();
    }
    await verifyChain(parents);
    const staged = await maybeFile(temporary);
    if (!staged || !identity(created, staged)) throw new Error('changed-branding-cache');
    const existing = await maybeFile(destination);
    if (original ? !existing || !same(original, existing) : existing !== undefined)
      throw new Error('changed-branding-cache');
    current();
    await rename(temporary, destination);
    await verifyChain(parents);
  } finally {
    if (created)
      try {
        await verifyChain(parents);
        const remaining = await maybeFile(temporary);
        if (remaining && identity(created, remaining)) await rm(temporary);
      } catch {
        /* Replaced paths belong to somebody else. Never follow them for cleanup. */
      }
  }
}

/** Remove only the observed scratch inode and its now-empty, unchanged private directory. */
export async function cleanupBrandingScratch(
  directory: string,
  original: BigIntStats,
  image?: BigIntStats,
): Promise<void> {
  try {
    const parents = await directoryChain(directory);
    const current = await lstat(directory, { bigint: true });
    if (!identity(original, current)) return;
    if (image) {
      const candidate = await maybeFile(join(directory, 'image'));
      if (candidate && identity(image, candidate)) await rm(join(directory, 'image'));
    }
    await verifyChain(parents);
    if (identity(original, await lstat(directory, { bigint: true }))) await rmdir(directory);
  } catch {
    /* Foreign replacements and unexpected files are preserved. */
  }
}
