import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { ReleaseFailure } from './types.js';

const LAUNCHER_LIMIT = 2 * 1024 ** 3;

async function noLinks(path: string): Promise<{ path: string; dev: number; ino: number }[]> {
  const identities: { path: string; dev: number; ino: number }[] = [];
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    identities.push({ path: current, dev: info.dev, ino: info.ino });
    if (info.isSymbolicLink()) throw new ReleaseFailure('INVALID');
    if (current !== absolute && !info.isDirectory()) throw new ReleaseFailure('INVALID');
  }
  return identities;
}
async function safeRead(path: string, limit: number): Promise<Buffer> {
  const ancestry = await noLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1) throw new ReleaseFailure('INVALID');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > limit ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.ctimeMs !== before.ctimeMs
    )
      throw new ReleaseFailure('INVALID');
    const data = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (
      total !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.nlink !== 1
    )
      throw new ReleaseFailure('IO');
    const afterAncestry = await noLinks(path);
    if (
      ancestry.length !== afterAncestry.length ||
      ancestry.some(
        (entry, i) => entry.dev !== afterAncestry[i]?.dev || entry.ino !== afterAncestry[i]?.ino,
      )
    )
      throw new ReleaseFailure('IO');
    const current = await lstat(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== 1)
      throw new ReleaseFailure('IO');
    return data.subarray(0, total);
  } finally {
    await handle.close();
  }
}
async function writeAtomicFile(
  path: string,
  content: string | Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  await noLinks(dirname(path));
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new ReleaseFailure('INVALID');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(path), `.torch-release-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    signal?.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function validateLauncherBinary(binary: string): Promise<void> {
  await noLinks(binary);
  if (!/\.(?:exe|AppImage)$/i.test(binary)) throw new ReleaseFailure('INVALID');
  const appImage = /\.AppImage$/i.test(binary);
  // Windows cannot represent Unix execute bits.
  const before = await lstat(binary);
  if (!before.isFile() || before.nlink !== 1) throw new ReleaseFailure('INVALID');
  const handle = await open(
    binary,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 4) throw new ReleaseFailure('INVALID');
    if (stat.size > LAUNCHER_LIMIT) throw new ReleaseFailure('TOO_LARGE');
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (
      appImage
        ? header.toString('hex') !== '7f454c46' ||
          (process.platform !== 'win32' && (stat.mode & 0o111) === 0)
        : header.subarray(0, 2).toString() !== 'MZ'
    )
      throw new ReleaseFailure('INVALID');
  } finally {
    await handle.close();
  }
}
async function hashFile(
  path: string,
  limit: number,
  signal?: AbortSignal,
  onBytes?: (bytes: number) => void,
): Promise<{ sha256: string; size: number }> {
  await noLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1) throw new ReleaseFailure('INVALID');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new ReleaseFailure('INVALID');
    if (stat.size > limit) throw new ReleaseFailure('TOO_LARGE');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      if (position > limit) throw new ReleaseFailure('TOO_LARGE');
      hash.update(buffer.subarray(0, bytesRead));
      onBytes?.(position);
    }
    const after = await handle.stat();
    if (
      position !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.nlink !== 1
    )
      throw new ReleaseFailure('IO');
    const current = await lstat(path);
    await noLinks(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== 1)
      throw new ReleaseFailure('IO');
    return { sha256: hash.digest('hex'), size: position };
  } finally {
    await handle.close();
  }
}

export { hashFile, LAUNCHER_LIMIT, noLinks, safeRead, validateLauncherBinary, writeAtomicFile };
