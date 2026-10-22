import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import {
  SERVER_CONFIG_FILENAME,
  type ServerConfig,
} from '../../../../packages/core/src/server-config/index.js';
import { StudioFailure } from './project.js';

export async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new StudioFailure('INVALID');
    if (current !== absolute && !info.isDirectory()) throw new StudioFailure('INVALID');
  }
}
export async function safeRead(path: string, limit: number): Promise<Buffer> {
  await noLinks(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new StudioFailure('INVALID');
    const data = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new StudioFailure('IO');
    return data.subarray(0, total);
  } finally {
    await handle.close();
  }
}
export async function saveProject(path: string, content: string): Promise<void> {
  await noLinks(dirname(path));
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new StudioFailure('INVALID');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(path), `.torchstudio-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function exportLauncher(
  binary: string,
  output: string,
  config: ServerConfig,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  await noLinks(binary);
  await noLinks(output);
  const outputStat = await lstat(output);
  const assertOutput = async () => {
    await noLinks(output);
    const current = await lstat(output);
    if (!current.isDirectory() || current.dev !== outputStat.dev || current.ino !== outputStat.ino)
      throw new StudioFailure('INVALID');
  };
  if (!outputStat.isDirectory() || (await readdir(output)).length)
    throw new StudioFailure('INVALID');
  if (!/\.(?:exe|AppImage)$/i.test(binary)) throw new StudioFailure('INVALID');
  const source = await open(binary, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const created: { path: string; dev: number; ino: number }[] = [];
  try {
    const stat = await source.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 4 || stat.size > 2 * 1024 ** 3)
      throw new StudioFailure('INVALID');
    const header = Buffer.alloc(4);
    await source.read(header, 0, 4, 0);
    const appImage = /\.AppImage$/i.test(binary);
    if (
      appImage
        ? header.toString('hex') !== '7f454c46' || (stat.mode & 0o111) === 0
        : header.subarray(0, 2).toString() !== 'MZ'
    )
      throw new StudioFailure('INVALID');
    const target = join(output, basename(binary));
    await assertOutput();
    const destination = await open(target, 'wx', 0o600);
    const targetStat = await destination.stat();
    created.push({ path: target, dev: targetStat.dev, ino: targetStat.ino });
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      while (position < stat.size) {
        signal.throwIfAborted();
        const { bytesRead } = await source.read(
          buffer,
          0,
          Math.min(buffer.length, stat.size - position),
          position,
        );
        if (!bytesRead) throw new StudioFailure('IO');
        let written = 0;
        while (written < bytesRead) {
          const result = await destination.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (!result.bytesWritten) throw new StudioFailure('IO');
          written += result.bytesWritten;
        }
        position += bytesRead;
        progress(position);
      }
      const after = await source.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new StudioFailure('IO');
      await destination.sync();
      await destination.chmod(stat.mode & 0o777);
    } finally {
      await destination.close();
    }
    signal.throwIfAborted();
    const configPath = join(output, SERVER_CONFIG_FILENAME);
    await assertOutput();
    const configHandle = await open(configPath, 'wx', 0o600);
    const configStat = await configHandle.stat();
    created.push({ path: configPath, dev: configStat.dev, ino: configStat.ino });
    try {
      await configHandle.writeFile(`${JSON.stringify(config, null, 2)}\n`);
      await configHandle.sync();
    } finally {
      await configHandle.close();
    }
    signal.throwIfAborted();
    await assertOutput();
  } catch (error) {
    for (const entry of created.reverse()) {
      try {
        await assertOutput();
        const current = await lstat(entry.path);
        if (current.dev === entry.dev && current.ino === entry.ino && !current.isSymbolicLink())
          await rm(entry.path);
      } catch {
        /* A replaced directory or file belongs to someone else. */
      }
    }
    throw error;
  } finally {
    await source.close();
  }
}
