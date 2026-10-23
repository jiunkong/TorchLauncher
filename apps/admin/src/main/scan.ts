import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { noLinks } from './filesystem.js';
import { StudioFailure } from './project.js';

export const SCAN_LIMITS = { files: 10000, depth: 24 } as const;
export interface ScanFile {
  path: string;
  size: number;
  mtimeMs: number;
}
export interface ScanResult {
  files: ScanFile[];
  truncated: boolean;
  skipped: number;
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected on purpose.
const UNSAFE_NAME = /[\u0000-\u001f\u007f\\:*?"<>|]/;
export function isListableName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !UNSAFE_NAME.test(name) &&
    !name.startsWith('.torchstudio-') &&
    Buffer.byteLength(name) <= 255
  );
}
/** Lists regular files below `root`. Links, special files and odd names are counted, never followed. */
export async function scanSource(root: string, signal: AbortSignal): Promise<ScanResult> {
  await noLinks(root);
  const files: ScanFile[] = [];
  let skipped = 0;
  let truncated = false;
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (truncated) return;
      signal.throwIfAborted();
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isListableName(entry.name) || entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        if (depth >= SCAN_LIMITS.depth) skipped++;
        else await walk(join(directory, entry.name), rel, depth + 1);
      } else if (entry.isFile()) {
        const info = await lstat(join(directory, entry.name));
        if (!info.isFile() || info.nlink !== 1) {
          skipped++;
          continue;
        }
        if (files.length >= SCAN_LIMITS.files) {
          truncated = true;
          return;
        }
        files.push({ path: rel, size: info.size, mtimeMs: info.mtimeMs });
      } else skipped++;
    }
  };
  await walk(root, '', 0);
  return { files, truncated, skipped };
}
/** Streams a regular file through sha256. Refuses links, hard links, growth past `limit` and changes while reading. */
export async function hashFile(
  path: string,
  limit: number,
  signal?: AbortSignal,
  onBytes?: (bytes: number) => void,
): Promise<{ sha256: string; size: number }> {
  await noLinks(path);
  const before = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino)
      throw new StudioFailure('INVALID');
    if (stat.size > limit) throw new StudioFailure('TOO_LARGE');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      if (position > limit) throw new StudioFailure('TOO_LARGE');
      hash.update(buffer.subarray(0, bytesRead));
      onBytes?.(position);
    }
    const after = await handle.stat();
    if (position !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new StudioFailure('IO');
    return { sha256: hash.digest('hex'), size: position };
  } finally {
    await handle.close();
  }
}
