import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProject, StudioFailure } from './project.js';
import { encodeProjectFile } from './project-file.js';
import {
  copyIntoDataDir,
  copyProjectFolder,
  createProjectFolder,
  PROJECT_DATA_DIR,
  PROJECT_FILE_NAME,
  readProjectFolder,
} from './project-folder.js';

describe('project-folder', () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `torch-test-proj-folder-${Math.random().toString(36).slice(2)}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('createProjectFolder', () => {
    it('creates files/ directory in an empty folder', async () => {
      const folder = join(root, 'empty-folder');
      await mkdir(folder);
      await createProjectFolder(folder);
      const entries = await readdir(folder);
      expect(entries).toEqual([PROJECT_DATA_DIR]);
    });

    it('rejects if directory is not empty with FOLDER_NOT_EMPTY', async () => {
      const folder = join(root, 'non-empty');
      await mkdir(folder);
      await writeFile(join(folder, 'some.txt'), 'hello');
      await expect(createProjectFolder(folder)).rejects.toThrow(
        new StudioFailure('FOLDER_NOT_EMPTY'),
      );
    });

    it('rejects if folder is a file or symlink', async () => {
      const file = join(root, 'file.txt');
      await writeFile(file, 'test');
      await expect(createProjectFolder(file)).rejects.toThrow(new StudioFailure('INVALID'));

      const folder = join(root, 'real-folder');
      await mkdir(folder);
      const link = join(root, 'link-folder');
      await symlink(folder, link);
      await expect(createProjectFolder(link)).rejects.toThrow(new StudioFailure('INVALID'));
    });
  });

  describe('readProjectFolder', () => {
    it('reads and decodes project.torchproj and ensures files/ directory', async () => {
      const folder = join(root, 'my-proj');
      await mkdir(folder);
      const proj = newProject('Test Server');
      const encoded = encodeProjectFile(proj, {});
      await writeFile(join(folder, PROJECT_FILE_NAME), encoded);

      const res = await readProjectFolder(folder, () => {
        throw new Error('No images');
      });
      expect(res.project.name).toBe('Test Server');
      const entries = await readdir(folder);
      expect(entries.sort()).toEqual([PROJECT_DATA_DIR, PROJECT_FILE_NAME]);
    });

    it('rejects with INVALID if project.torchproj is missing', async () => {
      const folder = join(root, 'no-proj');
      await mkdir(folder);
      await expect(
        readProjectFolder(folder, () => {
          throw new Error();
        }),
      ).rejects.toThrow(new StudioFailure('INVALID'));
    });
  });

  describe('copyProjectFolder', () => {
    it('copies files/ and project.torchproj to an empty destination', async () => {
      const src = join(root, 'src-proj');
      await mkdir(src);
      const proj = newProject('Source Server');
      const encoded = encodeProjectFile(proj, {});
      await writeFile(join(src, PROJECT_FILE_NAME), encoded);
      const srcData = join(src, PROJECT_DATA_DIR);
      await mkdir(join(srcData, 'mods'), { recursive: true });
      await writeFile(join(srcData, 'mods', 'foo.jar'), 'mod-bytes');

      const dest = join(root, 'dest-proj');
      await mkdir(dest);

      const controller = new AbortController();
      await copyProjectFolder(src, dest, controller.signal);

      const destEntries = await readdir(dest);
      expect(destEntries.sort()).toEqual([PROJECT_DATA_DIR, PROJECT_FILE_NAME]);
      const modContent = await readFile(join(dest, PROJECT_DATA_DIR, 'mods', 'foo.jar'), 'utf8');
      expect(modContent).toBe('mod-bytes');
    });

    it('rejects if destination is not empty with FOLDER_NOT_EMPTY', async () => {
      const src = join(root, 'src-proj');
      await mkdir(src);
      await writeFile(join(src, PROJECT_FILE_NAME), encodeProjectFile(newProject(), {}));
      const dest = join(root, 'dest-proj');
      await mkdir(dest);
      await writeFile(join(dest, 'existing.txt'), 'data');

      await expect(copyProjectFolder(src, dest, new AbortController().signal)).rejects.toThrow(
        new StudioFailure('FOLDER_NOT_EMPTY'),
      );
    });

    it('rejects nested paths with INVALID', async () => {
      const src = join(root, 'src-proj');
      await mkdir(src);
      await writeFile(join(src, PROJECT_FILE_NAME), encodeProjectFile(newProject(), {}));
      const dest = join(src, 'sub-dest');
      await mkdir(dest);

      await expect(copyProjectFolder(src, dest, new AbortController().signal)).rejects.toThrow(
        new StudioFailure('INVALID'),
      );
    });
  });

  describe('copyIntoDataDir', () => {
    it('copies external file into data directory', async () => {
      const dataDir = join(root, 'files');
      await mkdir(dataDir);
      const externalFile = join(root, 'ext.txt');
      await writeFile(externalFile, 'external-data');

      const res = await copyIntoDataDir(
        dataDir,
        externalFile,
        'sub/ext.txt',
        new AbortController().signal,
      );
      expect(res.size).toBe(13);
      const copied = await readFile(join(dataDir, 'sub/ext.txt'), 'utf8');
      expect(copied).toBe('external-data');
    });

    it('rejects if destination file already exists', async () => {
      const dataDir = join(root, 'files');
      await mkdir(dataDir);
      const externalFile = join(root, 'ext.txt');
      await writeFile(externalFile, 'new-data');
      await writeFile(join(dataDir, 'ext.txt'), 'old-data');

      await expect(
        copyIntoDataDir(dataDir, externalFile, 'ext.txt', new AbortController().signal),
      ).rejects.toThrow(new StudioFailure('INVALID'));
    });

    it('handles in-place files without copying', async () => {
      const dataDir = join(root, 'files');
      await mkdir(dataDir);
      const filePath = join(dataDir, 'inplace.txt');
      await writeFile(filePath, 'inplace-data');

      const res = await copyIntoDataDir(
        dataDir,
        filePath,
        'inplace.txt',
        new AbortController().signal,
      );
      expect(res.size).toBe(12);
    });
  });
});
