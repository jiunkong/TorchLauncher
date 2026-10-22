import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyUserDataBase } from '../../../../../packages/core/src/instance/data/paths';

export interface Preferences {
  closeOnLaunch: boolean;
  maxMemoryMiB?: number;
  initialMemoryMiB?: number;
}
function parse(text: string): Preferences {
  const value = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['closeOnLaunch', 'maxMemoryMiB', 'initialMemoryMiB'].includes(key),
    ) ||
    typeof value.closeOnLaunch !== 'boolean'
  )
    throw new Error('preferences-failed');
  const maxMemoryMiB = value.maxMemoryMiB;
  const initialMemoryMiB = value.initialMemoryMiB;
  if (
    (maxMemoryMiB !== undefined &&
      (!Number.isSafeInteger(maxMemoryMiB) ||
        (maxMemoryMiB as number) < 512 ||
        (maxMemoryMiB as number) > 65536)) ||
    (initialMemoryMiB !== undefined &&
      (!Number.isSafeInteger(initialMemoryMiB) ||
        (initialMemoryMiB as number) < 256 ||
        (initialMemoryMiB as number) > (maxMemoryMiB ?? 2048)))
  )
    throw new Error('preferences-failed');
  return {
    closeOnLaunch: value.closeOnLaunch,
    ...(maxMemoryMiB === undefined ? {} : { maxMemoryMiB: maxMemoryMiB as number }),
    ...(initialMemoryMiB === undefined ? {} : { initialMemoryMiB: initialMemoryMiB as number }),
  };
}
async function plain(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024)
      throw new Error('preferences-failed');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export async function readPreferences(base: string): Promise<Preferences> {
  await verifyUserDataBase(base);
  const path = join(base, 'launcher-preferences.json');
  await plain(path);
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { closeOnLaunch: false };
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024)
      throw new Error('preferences-failed');
    const bytes = Buffer.alloc(1025);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 1024) throw new Error('preferences-failed');
    return parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}
export async function writePreferences(base: string, preferences: Preferences): Promise<void> {
  const text = JSON.stringify(parse(JSON.stringify(preferences)));
  await verifyUserDataBase(base);
  const path = join(base, 'launcher-preferences.json');
  await plain(path);
  const temporary = join(base, `.launcher-preferences-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await plain(path);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
