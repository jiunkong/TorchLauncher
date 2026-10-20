import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { secureDirectory, stat } from './filesystem';

export class ServerDataLockedError extends Error {
  constructor() {
    super('Server data is in use or requires manual stale-lock recovery');
    this.name = 'ServerDataLockedError';
  }
}
export interface ServerDataLease {
  root: string;
  release(): Promise<void>;
}
/** Cooperative filesystem lock: all installation, launch and future deletion callers must use it. */
export async function acquireServerDataLock(
  rootPath: string,
  purpose: 'install' | 'game' | 'maintenance',
): Promise<ServerDataLease> {
  const root = resolve(rootPath);
  await secureDirectory(root);
  const lock = join(root, '.torchlauncher-server-lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ServerDataLockedError();
    throw error;
  }
  const owner = JSON.stringify({ version: 1, id: randomUUID(), pid: process.pid, purpose });
  try {
    await writeFile(join(lock, 'owner.json'), owner, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    root,
    async release() {
      if (released) return;
      const info = await stat(lock);
      if (
        !info?.isDirectory() ||
        info.isSymbolicLink() ||
        (await readFile(join(lock, 'owner.json'), 'utf8')) !== owner
      )
        throw new Error('Server-data lock ownership changed; manual recovery required');
      await rm(lock, { recursive: true });
      released = true;
    },
  };
}
