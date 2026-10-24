import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { BRANDING_ROLES } from '../../../../packages/core/src/branding/index.js';
import {
  SERVER_CONFIG_FILENAME,
  type ServerConfig,
} from '../../../../packages/core/src/server-config/index.js';
import type { BrandingSnapshots } from './branding.js';
import { StudioFailure } from './project.js';
import { writeZip, type ZipEntry } from './zip.js';

export const LAUNCHER_LIMIT = 2 * 1024 ** 3;

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
export async function saveProject(path: string, content: string | Uint8Array): Promise<void> {
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
    await handle.writeFile(content);
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
/** Copies the snapshots a config references after checking path, length and hash against the config. */
export function verifiedBrandingAssets(
  config: ServerConfig,
  snapshots: BrandingSnapshots,
): BrandingSnapshots {
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
  return assets;
}
/**
 * Writes the common launcher file and the server configuration (plus branding assets) into ONE
 * ZIP file. The binary is checked (MZ or ELF header, size); the ZIP is built beside its final
 * name and renamed into place, so an interrupted export leaves nothing behind.
 */
export async function exportLauncherZip(
  binary: string,
  destination: string,
  config: ServerConfig,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  snapshots: BrandingSnapshots = {},
): Promise<number> {
  signal.throwIfAborted();
  const assets = verifiedBrandingAssets(config, snapshots);
  await noLinks(binary);
  if (!/\.(?:exe|AppImage)$/i.test(binary)) throw new StudioFailure('INVALID');
  const appImage = /\.AppImage$/i.test(binary);
  const handle = await open(binary, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 4) throw new StudioFailure('INVALID');
    if (stat.size > LAUNCHER_LIMIT) throw new StudioFailure('TOO_LARGE');
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (
      appImage
        ? header.toString('hex') !== '7f454c46' || (stat.mode & 0o111) === 0
        : header.subarray(0, 2).toString() !== 'MZ'
    )
      throw new StudioFailure('INVALID');
  } finally {
    await handle.close();
  }
  const entries: ZipEntry[] = [
    { name: basename(binary), mode: 0o755, path: binary, maxSize: LAUNCHER_LIMIT },
    {
      name: SERVER_CONFIG_FILENAME,
      mode: 0o644,
      data: Buffer.from(`${JSON.stringify(config, null, 2)}\n`),
    },
  ];
  for (const role of BRANDING_ROLES) {
    const asset = config.branding?.[role];
    const bytes = assets[role];
    if (asset && bytes) entries.push({ name: asset.path, mode: 0o644, data: bytes });
  }
  return writeZip(destination, entries, signal, progress);
}
