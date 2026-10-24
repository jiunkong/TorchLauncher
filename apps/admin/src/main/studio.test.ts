import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import { exportLauncherZip, safeRead } from './filesystem.js';
import { StudioService } from './fixtures/signing.js';
import { readZip } from './fixtures/zip.js';
import { newProject, parseProject } from './project.js';
import { decodeProjectFile, encodeProjectFile } from './project-file.js';
import { PROJECT_DATA_DIR, PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function dialogs() {
  return {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
    reveal: vi.fn<NonNullable<StudioDialogs['reveal']>>(),
  };
}
function memorySource(bytes: Buffer): DownloadSource {
  const snapshot = { totalLength: bytes.length, etag: '"test"', lastModified: null };
  let generation = 0;
  return {
    kind: 'https',
    sourceId: 'test-pack',
    get generation() {
      return generation;
    },
    snapshot,
    async getRange(range, options) {
      options?.signal?.throwIfAborted();
      return {
        sourceId: this.sourceId,
        sourceGeneration: this.generation,
        range,
        bytes: bytes.subarray(range.start, range.end + 1),
        snapshot,
      };
    },
    reset() {
      generation++;
    },
  };
}
async function projectService(dir?: string) {
  const d = dialogs();
  const s = new StudioService(d);
  const projDir = dir ?? (await temp());
  d.open.mockResolvedValueOnce([projDir]);
  await s.request({ action: 'new', discard: true });
  return { d, s, projDir };
}
function config() {
  const p = newProject();
  return parseServerConfig({
    format: 'torchlauncher-server',
    signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    version: 1,
    serverId: p.serverId,
    name: p.name,
    address: p.address,
    sourceUrl: 'https://example.org/pack',
    game: p.game,
  });
}

describe('Studio project and trusted disk selections', () => {
  it('round trips the validated TorchLauncher Studio project folder and preserves dirty state', async () => {
    const root = await temp();
    const { s, d } = await projectService(root);
    const project = { ...parseProject(s.snapshot().project), name: 'Persisted server' };
    expect(await s.request({ action: 'update', project })).toMatchObject({
      ok: true,
      state: { dirty: true },
    });
    expect((await s.request({ action: 'save' })).ok).toBe(true);
    const path = join(root, PROJECT_FILE_NAME);
    expect(
      decodeProjectFile(await readFile(path), () => ({ width: 1, height: 1 })).project,
    ).toEqual(project);

    d.open.mockResolvedValueOnce([root]);
    expect((await s.request({ action: 'open', discard: true })).ok).toBe(true);
    expect(s.snapshot()).toMatchObject({ dirty: false, project });
    await s.request({ action: 'touch' });
    expect(await s.request({ action: 'new' })).toEqual({ ok: false, code: 'UNSAVED' });
    d.open.mockResolvedValueOnce([root]);
    expect(await s.request({ action: 'open' })).toEqual({ ok: false, code: 'UNSAVED' });
    expect(s.snapshot().project).toEqual(project);
    expect((await readdir(root)).sort()).toEqual([PROJECT_DATA_DIR, PROJECT_FILE_NAME]);
  });

  it('rejects new in non-empty folder with FOLDER_NOT_EMPTY and open in invalid folder with INVALID', async () => {
    const root = await temp();
    await writeFile(join(root, 'other.txt'), 'content');
    const d = dialogs();
    const s = new StudioService(d);
    d.open.mockResolvedValueOnce([root]);
    expect(await s.request({ action: 'new', discard: true })).toEqual({
      ok: false,
      code: 'FOLDER_NOT_EMPTY',
    });

    const empty = await temp();
    d.open.mockResolvedValueOnce([empty]);
    expect(await s.request({ action: 'open', discard: true })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  });

  it('reveals project folder in OS file manager with revealProject', async () => {
    const { s, d, projDir } = await projectService();
    expect(await s.request({ action: 'revealProject' })).toEqual({
      ok: true,
      state: s.snapshot(),
    });
    expect(d.reveal).toHaveBeenCalledWith(projDir);
  });

  it('copies full project folder on saveAs, resets dirty, and rejects nested destinations', async () => {
    const { s, d, projDir } = await projectService();
    const project = { ...parseProject(s.snapshot().project), name: 'Copied server' };
    await s.request({ action: 'update', project });
    await writeFile(join(projDir, PROJECT_DATA_DIR, 'custom.txt'), 'hello');

    const destDir = await temp();
    d.open.mockResolvedValueOnce([destDir]);
    expect(await s.request({ action: 'saveAs' })).toMatchObject({
      ok: true,
      state: { dirty: false, projectName: destDir.split(/[\\/]/).pop() },
    });

    const copied = await readFile(join(destDir, PROJECT_DATA_DIR, 'custom.txt'), 'utf8');
    expect(copied).toBe('hello');
    const projOnDest = decodeProjectFile(await readFile(join(destDir, PROJECT_FILE_NAME)), () => ({
      width: 1,
      height: 1,
    })).project;
    expect(projOnDest.name).toBe('Copied server');

    // Reject nested saveAs
    const nestedDir = join(destDir, 'nested');
    await mkdir(nestedDir);
    d.open.mockResolvedValueOnce([nestedDir]);
    expect(await s.request({ action: 'saveAs' })).toEqual({ ok: false, code: 'INVALID' });
  });

  it('keeps prior state after malformed open, rejects forged renderer paths', async () => {
    const { s, d } = await projectService();
    const before = s.snapshot().project;
    expect(
      await s.request({
        action: 'update',
        project: { ...before, files: [{ path: 'secret.txt', policy: 'always' }] },
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    const root = await temp();
    const path = join(root, PROJECT_FILE_NAME);
    await writeFile(path, '{bad');
    d.open.mockResolvedValueOnce([root]);
    expect((await s.request({ action: 'open', discard: true })).ok).toBe(false);
    expect(s.snapshot().project).toEqual(before);
    expect(() =>
      parseProject({ ...before, files: [{ path: '../escape', policy: 'always' }] }),
    ).toThrow();
    expect(() =>
      parseProject({ ...before, files: [{ path: '.torchlauncher/state', policy: 'always' }] }),
    ).toThrow();
    expect(() => parseProject({ ...before, command: 'run' })).toThrow();
  });

  it('rejects new writes while closing, resumes only when explicitly reopened', async () => {
    const { s, d } = await projectService();
    await s.close();
    expect(await s.request({ action: 'save' })).toEqual({ ok: false, code: 'BUSY' });
    expect(await s.request({ action: 'new', discard: true })).toEqual({ ok: false, code: 'BUSY' });
    s.resume();
    const empty = await temp();
    d.open.mockResolvedValueOnce([empty]);
    expect((await s.request({ action: 'new', discard: true })).ok).toBe(true);
  });

  it('cancels projectnew dialog before modifying state', async () => {
    const { s, d } = await projectService();
    const original = s.snapshot().project;
    let finish!: (paths: string[]) => void;
    d.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.request({ action: 'saveAs' });
    await s.request({ action: 'cancel' });
    const empty = await temp();
    finish([empty]);
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
    expect(s.snapshot().project).toEqual(original);
  });

  it('builds arbitrary nested files with both policies using real writer and reads verified payloads', async () => {
    const { s, d, projDir } = await projectService();
    const root = projDir;
    const source = join(projDir, PROJECT_DATA_DIR);
    await mkdir(join(source, 'custom'), { recursive: true });
    await writeFile(join(source, 'custom', 'arbitrary.data'), 'real payload');
    await writeFile(join(source, 'options.txt'), 'initial settings');

    d.open.mockResolvedValueOnce([
      join(source, 'custom', 'arbitrary.data'),
      join(source, 'options.txt'),
    ]);
    expect((await s.request({ action: 'files' })).ok).toBe(true);
    const project = parseProject(s.snapshot().project);
    const settings = project.files[1];
    if (!settings) throw new Error('Missing settings fixture');
    settings.policy = 'initial-only';
    await s.request({ action: 'update', project });
    const pack = join(root, 'server.torchpack');
    d.save.mockResolvedValueOnce(pack);
    expect((await s.request({ action: 'build' })).ok).toBe(true);
    const bytes = await readFile(pack);
    const reader = await openDeploymentReader(memorySource(bytes), {
      expectedServerId: project.serverId,
    });
    expect(reader.index.files.map((f) => [f.path, f.policy])).toEqual([
      ['custom/arbitrary.data', 'always'],
      ['options.txt', 'initial-only'],
    ]);
    await reader.stageFile('custom/arbitrary.data', join(root, 'staged'));
    expect(await readFile(join(root, 'staged'), 'utf8')).toBe('real payload');
    const built = parseProject(s.snapshot().project);
    built.sourceUrl = 'https://example.org/pack';
    project.sourceUrl = built.sourceUrl;
    await s.request({ action: 'update', project: built });
    await s.request({ action: 'save' });

    const checkerDialogs = dialogs();
    const checker = new StudioService(
      checkerDialogs,
      () => memorySource(bytes),
      undefined,
      s.testKeys,
    );
    checkerDialogs.open.mockResolvedValueOnce([projDir]);
    await checker.request({ action: 'open', discard: true });
    expect((await checker.request({ action: 'check' })).ok).toBe(true);
    const zipPath = join(root, 'export.zip');
    const binary = join(root, 'Torch.exe');
    await writeFile(binary, 'MZ portable launcher fixture');
    checkerDialogs.open.mockResolvedValueOnce([binary]);
    checkerDialogs.save.mockResolvedValueOnce(zipPath);
    expect((await checker.request({ action: 'export' })).ok).toBe(true);
    const zip = readZip(await readFile(zipPath));
    expect(zip.get('Torch.exe')?.data.toString('utf8')).toBe('MZ portable launcher fixture');
    expect(
      JSON.parse(zip.get('torchlauncher-server.json')?.data.toString('utf8') ?? '').serverId,
    ).toBe(project.serverId);

    const opened = parseProject(checker.snapshot().project);
    expect(
      (
        await checker.request({
          action: 'update',
          project: { ...opened, game: { ...opened.game, minecraftVersion: '1.21.2' } },
        })
      ).ok,
    ).toBe(true);
    expect(await checker.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
    const trusted = await s.testKeys.status(built.serverId);
    vi.spyOn(s.testKeys, 'status').mockResolvedValue(trusted);
    await writeFile(
      join(projDir, PROJECT_FILE_NAME),
      encodeProjectFile({ ...built, serverId: '11111111-1111-4111-8111-111111111111' }, {}),
    );
    checkerDialogs.open.mockResolvedValueOnce([projDir]);
    await checker.request({ action: 'open', discard: true });
    expect(await checker.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
  });

  it('cancels the real writer during staged file reading and preserves previous output', async () => {
    const { s, d, projDir } = await projectService();
    const root = projDir;
    const source = join(projDir, PROJECT_DATA_DIR);
    const file = join(source, 'large.data');
    const handle = await open(file, 'wx');
    await handle.truncate(16 * 1024 * 1024);
    await handle.close();

    d.open.mockResolvedValueOnce([file]);
    await s.request({ action: 'files' });
    const pack = join(root, 'server.torchpack');
    await writeFile(pack, 'previous committed output');
    d.save.mockResolvedValueOnce(pack);
    const pending = s.request({ action: 'build' });
    for (
      let attempt = 0;
      attempt < 10000 && s.snapshot().progress === 0 && s.snapshot().busy;
      attempt++
    )
      await new Promise((resolve) => setImmediate(resolve));
    expect(s.snapshot().progress).toBeGreaterThan(0);
    expect(s.snapshot().busy).toBe('building');
    await s.request({ action: 'cancel' });
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
    expect(await readFile(pack, 'utf8')).toBe('previous committed output');
  });

  it('returns safe errors without exposing remote diagnostics', async () => {
    const root = await temp();
    const d = dialogs();
    const s = new StudioService(d, () => {
      throw new Error('private remote URL credentials');
    });
    const p = { ...newProject(), sourceUrl: 'https://example.org/pack' };
    await writeFile(join(root, PROJECT_FILE_NAME), encodeProjectFile(p, {}));
    d.open.mockResolvedValueOnce([root]);
    await s.request({ action: 'open', discard: true });
    expect(await s.request({ action: 'check' })).toEqual({ ok: false, code: 'IO' });
    expect(s.snapshot().result).toBeNull();
  });

  it('copies external file into data directory, refuses duplicate overwrite and symlinks', async () => {
    const { s, d, projDir } = await projectService();
    const outside = await temp();
    const external = join(outside, 'external.txt');
    await writeFile(external, 'copied content');

    // External file copied into files/
    d.open.mockResolvedValueOnce([external]);
    expect((await s.request({ action: 'files' })).ok).toBe(true);
    expect(await readFile(join(projDir, PROJECT_DATA_DIR, 'external.txt'), 'utf8')).toBe(
      'copied content',
    );
    expect(s.snapshot().project?.files).toEqual([{ path: 'external.txt', policy: 'always' }]);

    // Same name existing in destination: refused with INVALID
    const external2 = join(outside, 'external.txt');
    await writeFile(external2, 'different content');
    d.open.mockResolvedValueOnce([external2]);
    expect(await s.request({ action: 'files' })).toEqual({ ok: false, code: 'INVALID' });

    // Link file: refused with INVALID
    const link = join(outside, 'link.txt');
    try {
      await symlink(external, link);
      d.open.mockResolvedValueOnce([link]);
      expect(await s.request({ action: 'files' })).toEqual({ ok: false, code: 'INVALID' });
    } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM')
        throw error;
    }
  });
});

describe('operator-selected launcher ZIP export', () => {
  it('stores actual bytes and strict config with execute bits, replaces only a regular file', async () => {
    const root = await temp();
    const binaryName = process.platform === 'win32' ? 'Torch.exe' : 'Torch.AppImage';
    const binary = join(root, binaryName);
    const bytes = Buffer.concat([
      process.platform === 'win32' ? Buffer.from('MZ00') : Buffer.from('7f454c46', 'hex'),
      Buffer.alloc(2 * 1024 * 1024, 23),
    ]);
    await writeFile(binary, bytes);
    await chmod(binary, 0o755);
    const destination = join(root, 'launcher.zip');
    let progressCalls = 0;
    const written = await exportLauncherZip(
      binary,
      destination,
      config(),
      new AbortController().signal,
      () => {
        progressCalls++;
      },
    );
    expect(written).toBeGreaterThan(0);
    expect(progressCalls).toBeGreaterThan(0);
    const zip = readZip(await readFile(destination));
    expect(zip.get(binaryName)?.mode).toBe(0o755);
    expect(zip.get('torchlauncher-server.json')?.mode).toBe(0o644);
    expect(zip.get(binaryName)?.data.equals(bytes)).toBe(true);
    if (process.platform !== 'win32') {
      const mode = (await readFile(destination)).subarray(0, 4);
      expect(mode.length).toBe(4);
    }
    await writeFile(binary, 'corrupt header');
    await expect(
      exportLauncherZip(binary, destination, config(), new AbortController().signal, () => {}),
    ).rejects.toThrow();
  });
  it('cleans the partial ZIP after abort and keeps a previous export', async () => {
    const root = await temp();
    const binary = join(root, 'Torch.exe');
    await writeFile(binary, Buffer.concat([Buffer.from('MZ00'), Buffer.alloc(3 * 1024 * 1024)]));
    const zipPath = join(root, 'out.zip');
    await writeFile(zipPath, 'previous');
    const controller = new AbortController();
    await expect(
      exportLauncherZip(binary, zipPath, config(), controller.signal, () => controller.abort()),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(['Torch.exe', 'out.zip']);
    expect(await readFile(zipPath, 'utf8')).toBe('previous');
  });
  it('rejects mislabeled binaries, absent executable permission, links and oversized reads', async () => {
    const root = await temp();
    const zipPath = join(root, 'out.zip');
    const binary = join(root, 'Fake.exe');
    await writeFile(binary, 'not a binary');
    await expect(
      exportLauncherZip(binary, zipPath, config(), new AbortController().signal, () => {}),
    ).rejects.toThrow();
    await expect(safeRead(binary, 1)).rejects.toThrow();
    if (process.platform !== 'win32') {
      const appImage = join(root, 'Fake.AppImage');
      await writeFile(appImage, Buffer.from('7f454c46', 'hex'), { mode: 0o600 });
      await expect(
        exportLauncherZip(appImage, zipPath, config(), new AbortController().signal, () => {}),
      ).rejects.toThrow();
      const real = join(root, 'Real.exe');
      await writeFile(real, 'MZ00');
      const link = join(root, 'Link.exe');
      await symlink(real, link);
      await expect(
        exportLauncherZip(link, zipPath, config(), new AbortController().signal, () => {}),
      ).rejects.toThrow();
    }
    expect(await readdir(root)).not.toContain('out.zip');
  });
});

it('asks main to close the window for exit and accepts no extra fields', async () => {
  const service = new StudioService({
    open: vi.fn(async () => null),
    save: vi.fn(async () => null),
  } as never);
  const exit = vi.fn();
  service.onExit(exit);
  expect(await service.request({ action: 'exit', path: 'x' })).toEqual({
    ok: false,
    code: 'INVALID',
  });
  expect(exit).not.toHaveBeenCalled();
  expect(await service.request({ action: 'exit' })).toMatchObject({ ok: true });
  expect(exit).toHaveBeenCalledOnce();
});
