import { lstat, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
/** Reject symlinks throughout caller-supplied roots and existing ancestors. */
export async function secureDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await secureDirectory(parent);
  const info = await stat(absolute);
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Unsafe installation directory: ${absolute}`);
    return;
  }
  try {
    await mkdir(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = await lstat(absolute);
    if (!raced.isDirectory() || raced.isSymbolicLink())
      throw new Error(`Unsafe installation directory: ${absolute}`);
  }
}
