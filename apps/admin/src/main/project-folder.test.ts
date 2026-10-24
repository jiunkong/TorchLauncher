import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProject, StudioFailure } from './project.js';
import { encodeProjectFile } from './project-file.js';
import {
  copyIntoDataDir,
  copyProjectFolder,
  copyProjectFolderInto,
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
    const finishWith = (text: string) => async (dir: string) => {
      await writeFile(join(dir, PROJECT_FILE_NAME), text);
    };

    it('creates <parent>/<name>/files and runs the finish step inside it', async () => {
      const dir = await createProjectFolder(root, ' My Server ', finishWith('x'));
      expect(dir).toBe(join(root, 'My Server'));
      expect((await readdir(dir)).sort()).toEqual([PROJECT_DATA_DIR, PROJECT_FILE_NAME]);
    });

    it('rejects invalid and reserved names without creating anything', async () => {
      const bad = [
        '',
        '   ',
        '.',
        '..',
        'a/b',
        'a\\b',
        'a:b',
        'a*b',
        'a?b',
        'a"b',
        'a<b',
        'a>b',
        'a|b',
        'tab\tname',
        'nul\u0000',
        'trailing.',
        'CON',
        'nul',
        'Com1',
        'lpt9.txt',
        'x'.repeat(65),
      ];
      for (const name of bad) {
        await expect(createProjectFolder(root, name, finishWith('x'))).rejects.toThrow(
          new StudioFailure('FOLDER_NAME_INVALID'),
        );
      }
      expect(await readdir(root)).toEqual([]);
    });

    it('accepts ordinary names including spaces, unicode and dots inside', async () => {
      for (const name of ['서버 1', 'a.b', 'COM10', 'console', 'x'.repeat(64)]) {
        const dir = await createProjectFolder(root, name, finishWith('x'));
        expect(dir).toBe(join(root, name));
      }
    });

    it('never writes into an existing folder or file of that name', async () => {
      await mkdir(join(root, 'taken'));
      await writeFile(join(root, 'taken', 'keep.txt'), 'keep');
      await expect(createProjectFolder(root, 'taken', finishWith('x'))).rejects.toThrow(
        new StudioFailure('FOLDER_EXISTS'),
      );
      expect(await readdir(join(root, 'taken'))).toEqual(['keep.txt']);
      await writeFile(join(root, 'plain'), 'file');
      await expect(createProjectFolder(root, 'plain', finishWith('x'))).rejects.toThrow(
        new StudioFailure('FOLDER_EXISTS'),
      );
      expect(await readFile(join(root, 'plain'), 'utf8')).toBe('file');
    });

    it('rejects a missing, file or symlinked parent', async () => {
      await expect(
        createProjectFolder(join(root, 'missing'), 'p', finishWith('x')),
      ).rejects.toThrow();
      const file = join(root, 'file.txt');
      await writeFile(file, 'test');
      await expect(createProjectFolder(file, 'p', finishWith('x'))).rejects.toThrow(
        new StudioFailure('INVALID'),
      );
      const real = join(root, 'real');
      await mkdir(real);
      const link = join(root, 'link');
      await symlink(real, link);
      await expect(createProjectFolder(link, 'p', finishWith('x'))).rejects.toThrow(
        new StudioFailure('INVALID'),
      );
      expect(await readdir(real)).toEqual([]);
    });

    it('removes the created folder when a later step fails', async () => {
      await expect(
        createProjectFolder(root, 'doomed', async (dir) => {
          await writeFile(join(dir, 'partial.txt'), 'x');
          throw new StudioFailure('IO');
        }),
      ).rejects.toThrow(new StudioFailure('IO'));
      expect(await readdir(root)).toEqual([]);
    });
  });

  describe('copyProjectFolderInto', () => {
    const source = async () => {
      const src = join(root, 'src-proj');
      await mkdir(join(src, PROJECT_DATA_DIR), { recursive: true });
      await writeFile(join(src, PROJECT_FILE_NAME), encodeProjectFile(newProject('S'), {}));
      await writeFile(join(src, PROJECT_DATA_DIR, 'a.txt'), 'a');
      return src;
    };

    it('creates <parent>/<name> and copies the project into it', async () => {
      const src = await source();
      const parent = join(root, 'parent');
      await mkdir(parent);
      const dir = await copyProjectFolderInto(src, parent, 'Copy', new AbortController().signal);
      expect(dir).toBe(join(parent, 'Copy'));
      expect(await readFile(join(dir, PROJECT_DATA_DIR, 'a.txt'), 'utf8')).toBe('a');
    });

    it('rejects invalid names, existing targets and targets inside the source', async () => {
      const src = await source();
      const signal = new AbortController().signal;
      await expect(copyProjectFolderInto(src, root, 'a/b', signal)).rejects.toThrow(
        new StudioFailure('FOLDER_NAME_INVALID'),
      );
      await mkdir(join(root, 'exists'));
      await expect(copyProjectFolderInto(src, root, 'exists', signal)).rejects.toThrow(
        new StudioFailure('FOLDER_EXISTS'),
      );
      await expect(copyProjectFolderInto(src, src, 'inside', signal)).rejects.toThrow(
        new StudioFailure('INVALID'),
      );
      expect(await readdir(src)).toEqual([PROJECT_DATA_DIR, PROJECT_FILE_NAME].sort());
      // the target equals the source folder itself
      await expect(copyProjectFolderInto(src, root, 'src-proj', signal)).rejects.toThrow(
        new StudioFailure('INVALID'),
      );
    });

    it('removes the created folder when the copy fails', async () => {
      const src = await source();
      await rm(join(src, PROJECT_FILE_NAME));
      await expect(
        copyProjectFolderInto(src, root, 'fails', new AbortController().signal),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual(['src-proj']);
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
