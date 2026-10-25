import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { projectNameProblem, type StudioProject } from '../shared/studio.js';
import type { BrandingSnapshots, ImageDecoder } from './branding.js';
import { noLinks, safeRead, saveProject } from './filesystem.js';
import { PACK_LIMIT } from './game-settings.js';
import { StudioFailure } from './project.js';
import { decodeProjectFile, PROJECT_FILE_LIMIT } from './project-file.js';
import { hashFile, isListableName, SCAN_LIMITS } from './scan.js';

export const PROJECT_FILE_NAME = 'project.torchproj';
export const PROJECT_DATA_DIR = 'files';
export const PROJECT_BRANDING_DIR = 'branding';

/**
 * Creates the empty project folder `<parent>/<name>` and returns its path. The parent must exist
 * without symlinks in its ancestry; the leaf is made with a non-recursive mkdir, so an existing
 * file or folder of that name fails atomically (FOLDER_EXISTS) and is never written into.
 */
export async function createNamedFolder(parent: string, rawName: string): Promise<string> {
  const name = rawName.trim();
  if (projectNameProblem(name) !== null) throw new StudioFailure('FOLDER_NAME_INVALID');
  await noLinks(parent);
  if (!(await lstat(parent)).isDirectory()) throw new StudioFailure('INVALID');
  const dir = join(parent, name);
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new StudioFailure('FOLDER_EXISTS');
    throw error;
  }
  return dir;
}

/**
 * Creates a new project folder `<parent>/<name>` with its `files/` data directory and runs
 * `finish` (which writes project.torchproj). Anything created is removed again on failure.
 */
export async function createProjectFolder(
  parent: string,
  name: string,
  finish: (dir: string) => Promise<void>,
): Promise<string> {
  const dir = await createNamedFolder(parent, name);
  try {
    const dataDir = join(dir, PROJECT_DATA_DIR);
    await mkdir(dataDir, { mode: 0o700 });
    await noLinks(dataDir);
    await finish(dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return dir;
}

/** True when the two paths are the same folder or one lies inside the other. */
export function foldersNested(a: string, b: string): boolean {
  const x = resolve(a);
  const y = resolve(b);
  return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
}

/**
 * Creates `<parent>/<name>` and copies the project folder `from` into it (Save As). The target
 * must not lie inside the source (checked before anything is created); the created folder is
 * removed again if the copy fails.
 */
export async function copyProjectFolderInto(
  from: string,
  parent: string,
  name: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (foldersNested(from, join(parent, name.trim()))) throw new StudioFailure('INVALID');
  const dir = await createNamedFolder(parent, name);
  try {
    await copyProjectFolder(from, dir, signal);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return dir;
}

/**
 * Validates that `dir` is a project folder containing `project.torchproj`,
 * reads and decodes the project file, and ensures `files/` exists.
 */
export async function readProjectFolder(
  dir: string,
  decode: ImageDecoder,
): Promise<{ project: StudioProject; snapshots: BrandingSnapshots }> {
  await noLinks(dir);
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new StudioFailure('INVALID');
  const projPath = join(dir, PROJECT_FILE_NAME);
  let bytes: Buffer;
  try {
    bytes = await safeRead(projPath, PROJECT_FILE_LIMIT);
  } catch {
    throw new StudioFailure('INVALID');
  }
  const decoded = decodeProjectFile(bytes, decode);
  const dataDir = join(dir, PROJECT_DATA_DIR);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await noLinks(dataDir);
  return decoded;
}

/**
 * Copies an entire project folder to a new, empty directory.
 * The files/ tree is copied first; project.torchproj is written last.
 * On failure, any created files in `to` are cleaned up.
 */
export async function copyProjectFolder(
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const absFrom = resolve(from);
  const absTo = resolve(to);
  if (absTo === absFrom || absTo.startsWith(absFrom + sep) || absFrom.startsWith(absTo + sep)) {
    throw new StudioFailure('INVALID');
  }

  await noLinks(from);
  const fromInfo = await lstat(from);
  if (!fromInfo.isDirectory()) throw new StudioFailure('INVALID');

  await noLinks(to);
  const toInfo = await lstat(to);
  if (!toInfo.isDirectory()) throw new StudioFailure('INVALID');
  const toEntries = await readdir(to);
  if (toEntries.length > 0) throw new StudioFailure('FOLDER_NOT_EMPTY');

  // Verify project.torchproj exists before copying anything
  const projBytes = await safeRead(join(from, PROJECT_FILE_NAME), PROJECT_FILE_LIMIT);

  const fromFiles = join(from, PROJECT_DATA_DIR);
  const toFiles = join(to, PROJECT_DATA_DIR);
  await mkdir(toFiles, { recursive: true, mode: 0o700 });
  await noLinks(toFiles);

  let fileCount = 0;
  try {
    const copyTree = async (srcDir: string, destDir: string, depth: number): Promise<void> => {
      signal.throwIfAborted();
      if (depth >= SCAN_LIMITS.depth) throw new StudioFailure('INVALID');
      const entries = await readdir(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        signal.throwIfAborted();
        if (entry.name.startsWith('.torchstudio-')) continue;
        if (!isListableName(entry.name) || entry.isSymbolicLink()) {
          throw new StudioFailure('INVALID');
        }
        const srcPath = join(srcDir, entry.name);
        const destPath = join(destDir, entry.name);
        if (entry.isDirectory()) {
          await mkdir(destPath, { recursive: true, mode: 0o700 });
          await noLinks(destPath);
          await copyTree(srcPath, destPath, depth + 1);
        } else if (entry.isFile()) {
          fileCount++;
          if (fileCount > SCAN_LIMITS.files) throw new StudioFailure('INVALID');
          const st = await lstat(srcPath);
          if (!st.isFile() || st.nlink !== 1) throw new StudioFailure('INVALID');
          await copyFileAtomic(srcPath, destPath, signal);
        } else {
          throw new StudioFailure('INVALID');
        }
      }
    };

    try {
      const fromFilesStat = await lstat(fromFiles);
      if (fromFilesStat.isDirectory()) {
        await copyTree(fromFiles, toFiles, 0);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const fromBranding = join(absFrom, PROJECT_BRANDING_DIR);
    const toBranding = join(absTo, PROJECT_BRANDING_DIR);
    try {
      const brandingStat = await lstat(fromBranding);
      if (!brandingStat.isDirectory() || brandingStat.isSymbolicLink())
        throw new StudioFailure('INVALID');
      await mkdir(toBranding, { recursive: true, mode: 0o700 });
      await noLinks(toBranding);
      await copyTree(fromBranding, toBranding, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // project.torchproj is written LAST
    await saveProject(join(to, PROJECT_FILE_NAME), projBytes);
  } catch (error) {
    // Clean up created contents in destination
    try {
      const entries = await readdir(to);
      for (const e of entries) {
        await rm(join(to, e), { recursive: true, force: true });
      }
    } catch {
      // Ignore secondary cleanup error
    }
    throw error;
  }
}

/** Stores a selected branding image in the project folder using the same atomic write as project saves. */
export async function saveProjectBrandingAsset(
  projectDir: string,
  role: 'icon' | 'background',
  mediaType: 'image/png' | 'image/jpeg',
  bytes: Uint8Array,
): Promise<void> {
  await noLinks(projectDir);
  const directory = join(projectDir, PROJECT_BRANDING_DIR);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await noLinks(directory);
  const extension = mediaType === 'image/png' ? 'png' : 'jpg';
  await saveProject(join(directory, `${role}.${extension}`), bytes);
}

/** Removes stale image variants for a role after the current project save succeeds. */
export async function removeStaleProjectBrandingAsset(
  projectDir: string,
  role: 'icon' | 'background',
  keepMediaType: 'image/png' | 'image/jpeg',
): Promise<void> {
  const directory = join(projectDir, PROJECT_BRANDING_DIR);
  try {
    await noLinks(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const keep = `${role}.${keepMediaType === 'image/png' ? 'png' : 'jpg'}`;
  for (const name of [`${role}.png`, `${role}.jpg`]) {
    if (name === keep) continue;
    const path = join(directory, name);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new StudioFailure('INVALID');
      await rm(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function copyFileAtomic(src: string, dest: string, signal: AbortSignal): Promise<void> {
  await noLinks(src);
  const destDir = dirname(dest);
  await noLinks(destDir);
  const temporary = join(destDir, `.torchstudio-${randomUUID()}.tmp`);
  const input = await open(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const out = await open(temporary, 'wx', 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        signal.throwIfAborted();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        if (position + bytesRead > PACK_LIMIT) throw new StudioFailure('TOO_LARGE');
        await out.write(buffer, 0, bytesRead, position);
        position += bytesRead;
      }
      await out.sync();
    } finally {
      await out.close();
    }
    await rename(temporary, dest);
  } finally {
    await input.close();
    await rm(temporary, { force: true });
  }
}

/**
 * Copies an external file into the data directory at `<dataDir>/<relTarget>`.
 * Rejects if a file already exists at the destination unless it is already in-place.
 */
export async function copyIntoDataDir(
  dataDir: string,
  picked: string,
  relTarget: string,
  signal: AbortSignal,
): Promise<{ sha256: string; size: number }> {
  signal.throwIfAborted();
  await noLinks(picked);
  await noLinks(dataDir);

  const targetPath = join(dataDir, relTarget);
  const targetDir = dirname(targetPath);

  // Check if picked is already in-place
  let inPlace = false;
  try {
    inPlace = (await realpath(picked)) === (await realpath(targetPath));
  } catch {
    inPlace = false;
  }

  const name = basename(targetPath);
  if (!isListableName(name)) throw new StudioFailure('INVALID');

  if (inPlace) {
    return hashFile(targetPath, PACK_LIMIT, signal);
  }

  // Refuse if destination already exists
  try {
    await lstat(targetPath);
    throw new StudioFailure('INVALID');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  await noLinks(targetDir);

  const temporary = join(targetDir, `.torchstudio-${randomUUID()}.tmp`);
  const input = await open(picked, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const out = await open(temporary, 'wx', 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        signal.throwIfAborted();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        if (position + bytesRead > PACK_LIMIT) throw new StudioFailure('TOO_LARGE');
        await out.write(buffer, 0, bytesRead, position);
        position += bytesRead;
      }
      await out.sync();
    } finally {
      await out.close();
    }
    // Final check before rename
    try {
      await lstat(targetPath);
      throw new StudioFailure('INVALID');
    } catch (inner) {
      if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') throw inner;
    }
    await rename(temporary, targetPath);
  } finally {
    await input.close();
    await rm(temporary, { force: true });
  }

  return hashFile(targetPath, PACK_LIMIT, signal);
}
