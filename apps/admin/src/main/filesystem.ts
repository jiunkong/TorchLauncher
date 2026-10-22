import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { BRANDING_ROLES } from '../../../../packages/core/src/branding/index.js';
import {
  SERVER_CONFIG_FILENAME,
  type ServerConfig,
} from '../../../../packages/core/src/server-config/index.js';
import type { BrandingSnapshots } from './branding.js';
import { StudioFailure } from './project.js';

export async function noLinks(path: string): Promise<{ path: string; dev: number; ino: number }[]> {
  const identities: { path: string; dev: number; ino: number }[] = [];
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    identities.push({ path: current, dev: info.dev, ino: info.ino });
    if (info.isSymbolicLink()) throw new StudioFailure('INVALID');
    if (current !== absolute && !info.isDirectory()) throw new StudioFailure('INVALID');
  }
  return identities;
}
export async function safeRead(path: string, limit: number): Promise<Buffer> {
  const ancestry = await noLinks(path);
  const before = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
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
      throw new StudioFailure('INVALID');
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
      throw new StudioFailure('IO');
    const afterAncestry = await noLinks(path);
    if (
      ancestry.length !== afterAncestry.length ||
      ancestry.some(
        (entry, i) => entry.dev !== afterAncestry[i]?.dev || entry.ino !== afterAncestry[i]?.ino,
      )
    )
      throw new StudioFailure('IO');
    const current = await lstat(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== 1)
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
  snapshots: BrandingSnapshots = {},
): Promise<void> {
  signal.throwIfAborted();
  const assets: BrandingSnapshots = {};
  for (const role of BRANDING_ROLES) {
    const asset = config.branding?.[role];
    if (!asset) continue;
    const bytes = snapshots[role];
    const expectedPath = `branding/${role}.${asset.mediaType === 'image/png' ? 'png' : 'jpg'}`;
    if (
      !bytes ||
      asset.path !== expectedPath ||
      bytes.length !== asset.length ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    )
      throw new StudioFailure('INVALID');
    assets[role] = Buffer.from(bytes);
  }
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
  const created: { path: string; dev: number; ino: number; directory?: boolean }[] = [];
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
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs ||
        after.nlink !== 1
      )
        throw new StudioFailure('IO');
      await destination.sync();
      await destination.chmod(stat.mode & 0o777);
    } finally {
      await destination.close();
    }
    signal.throwIfAborted();
    if (BRANDING_ROLES.some((role) => config.branding?.[role])) {
      await assertOutput();
      const brandingPath = join(output, 'branding');
      await mkdir(brandingPath, { mode: 0o700 });
      const directory = await lstat(brandingPath);
      created.push({ path: brandingPath, dev: directory.dev, ino: directory.ino, directory: true });
      for (const role of BRANDING_ROLES) {
        const asset = config.branding?.[role];
        if (!asset) continue;
        const bytes = assets[role];
        if (!bytes) throw new StudioFailure('INVALID');
        signal.throwIfAborted();
        await assertOutput();
        await noLinks(brandingPath);
        const current = await lstat(brandingPath);
        if (current.dev !== directory.dev || current.ino !== directory.ino)
          throw new StudioFailure('INVALID');
        const targetPath = join(output, asset.path);
        const handle = await open(targetPath, 'wx', 0o600);
        const info = await handle.stat();
        created.push({ path: targetPath, dev: info.dev, ino: info.ino });
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
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
    for (const entry of created) {
      await noLinks(entry.path);
      const current = await lstat(entry.path);
      if (
        current.dev !== entry.dev ||
        current.ino !== entry.ino ||
        (!entry.directory && current.nlink !== 1)
      )
        throw new StudioFailure('IO');
    }
  } catch (error) {
    for (const entry of created.reverse()) {
      try {
        await assertOutput();
        await noLinks(dirname(entry.path));
        const parent = created.find(
          (candidate) => candidate.directory && candidate.path === dirname(entry.path),
        );
        if (parent) {
          const parentStat = await lstat(parent.path);
          if (parentStat.dev !== parent.dev || parentStat.ino !== parent.ino) continue;
        }
        const current = await lstat(entry.path);
        if (current.dev === entry.dev && current.ino === entry.ino && !current.isSymbolicLink())
          if (entry.directory) await rmdir(entry.path);
          else await rm(entry.path);
      } catch {
        /* A replaced directory or file belongs to someone else. */
      }
    }
    throw error;
  } finally {
    await source.close();
  }
}
