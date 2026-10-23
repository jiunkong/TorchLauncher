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
import { readZip } from './fixtures/zip.js';
import { newProject, parseProject } from './project.js';
import { type StudioDialogs, StudioService } from './studio.js';

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
async function projectService() {
  const d = dialogs();
  const s = new StudioService(d);
  await s.request({ action: 'new', discard: true });
  return { d, s };
}
function config() {
  const p = newProject();
  return parseServerConfig({
    format: 'torchlauncher-server',
    version: 1,
    serverId: p.serverId,
    name: p.name,
    address: p.address,
    sourceUrl: 'https://example.org/pack',
    game: p.game,
  });
}

describe('Studio project and trusted disk selections', () => {
  it('round trips validated project JSON, dirty state and reselects source after open', async () => {
    const root = await temp();
    const path = join(root, 'project.json');
    const { s, d } = await projectService();
    const project = { ...parseProject(s.snapshot().project), name: 'Persisted server' };
    expect(await s.request({ action: 'update', project })).toMatchObject({
      ok: true,
      state: { dirty: true },
    });
    d.save.mockResolvedValueOnce(path);
    expect((await s.request({ action: 'save' })).ok).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(project);
    d.open.mockResolvedValueOnce([root]);
    await s.request({ action: 'source' });
    d.open.mockResolvedValueOnce([path]);
    expect((await s.request({ action: 'open', discard: true })).ok).toBe(true);
    expect(s.snapshot()).toMatchObject({ dirty: false, sourceName: null, project });
    await s.request({ action: 'touch' });
    expect(await s.request({ action: 'new' })).toEqual({ ok: false, code: 'UNSAVED' });
    d.open.mockResolvedValueOnce([path]);
    expect(await s.request({ action: 'open' })).toEqual({ ok: false, code: 'UNSAVED' });
    expect(s.snapshot().project).toEqual(project);
    expect((await readdir(root)).sort()).toEqual(['project.json']);
  });
  it('keeps prior state after malformed open and canceled save, rejects forged renderer paths', async () => {
    const { s, d } = await projectService();
    const before = s.snapshot().project;
    expect(await s.request({ action: 'save' })).toEqual({ ok: false, code: 'CANCELLED' });
    expect(await s.request({ action: 'save', path: '/tmp/forged' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(
      await s.request({
        action: 'update',
        project: { ...before, files: [{ path: 'secret.txt', policy: 'always' }] },
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    const root = await temp();
    const path = join(root, 'bad.json');
    await writeFile(path, '{bad');
    d.open.mockResolvedValueOnce([path]);
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
  it('serializes mutations and honors cancellation after a native save dialog', async () => {
    const root = await temp();
    const { s, d } = await projectService();
    let finish!: (path: string) => void;
    d.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.request({ action: 'save' });
    expect(await s.request({ action: 'source' })).toEqual({ ok: false, code: 'BUSY' });
    await s.request({ action: 'cancel' });
    finish(join(root, 'must-not-exist.json'));
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
    expect(await readdir(root)).toEqual([]);
    expect(s.snapshot().dirty).toBe(true);
  });
  it('rejects new writes while closing, resumes only when explicitly reopened', async () => {
    const { s, d } = await projectService();
    await s.close();
    expect(await s.request({ action: 'save' })).toEqual({ ok: false, code: 'BUSY' });
    expect(await s.request({ action: 'new', discard: true })).toEqual({ ok: false, code: 'BUSY' });
    expect(d.save).not.toHaveBeenCalled();
    s.resume();
    expect((await s.request({ action: 'new', discard: true })).ok).toBe(true);
  });
  it('cancels source and new selection before modifying state after dialog', async () => {
    const root = await temp();
    const { s, d } = await projectService();
    const original = s.snapshot().project;
    let finish!: (paths: string[]) => void;
    d.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.request({ action: 'source' });
    await s.request({ action: 'cancel' });
    finish([root]);
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
    expect(s.snapshot().sourceName).toBeNull();
    expect(s.snapshot().project).toEqual(original);
  });
  it('builds arbitrary nested files with both policies using real writer and reads verified payloads', async () => {
    const root = await temp();
    const source = join(root, 'source');
    await mkdir(join(source, 'custom'), { recursive: true });
    await writeFile(join(source, 'custom', 'arbitrary.data'), 'real payload');
    await writeFile(join(source, 'options.txt'), 'initial settings');
    const { s, d } = await projectService();
    d.open.mockResolvedValueOnce([source]);
    await s.request({ action: 'source' });
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
    const checkerDialogs = dialogs();
    const checker = new StudioService(checkerDialogs, () => memorySource(bytes));
    const projectPath = join(root, 'project.json');
    const built = parseProject(s.snapshot().project);
    built.sourceUrl = 'https://example.org/pack';
    project.sourceUrl = built.sourceUrl;
    await writeFile(projectPath, JSON.stringify(built));
    checkerDialogs.open.mockResolvedValueOnce([projectPath]);
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

    await checker.request({
      action: 'update',
      project: { ...built, game: { ...built.game, minecraftVersion: '1.21.2' } },
    });
    expect(await checker.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
    await writeFile(
      projectPath,
      JSON.stringify({ ...built, serverId: '11111111-1111-4111-8111-111111111111' }),
    );
    checkerDialogs.open.mockResolvedValueOnce([projectPath]);
    await checker.request({ action: 'open', discard: true });
    expect(await checker.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
  });
  it('cancels the real writer during staged file reading and preserves previous output', async () => {
    const root = await temp();
    const source = join(root, 'source');
    await mkdir(source);
    const file = join(source, 'large.data');
    const handle = await open(file, 'wx');
    await handle.truncate(16 * 1024 * 1024);
    await handle.close();
    const { s, d } = await projectService();
    d.open.mockResolvedValueOnce([source]);
    await s.request({ action: 'source' });
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
    expect((await readdir(root)).sort()).toEqual(['server.torchpack', 'source']);
  });
  it('returns safe errors without exposing remote diagnostics', async () => {
    const root = await temp();
    const d = dialogs();
    const s = new StudioService(d, () => {
      throw new Error('private remote URL credentials');
    });
    const p = { ...newProject(), sourceUrl: 'https://example.org/pack' };
    const path = join(root, 'project.json');
    await writeFile(path, JSON.stringify(p));
    d.open.mockResolvedValueOnce([path]);
    await s.request({ action: 'open', discard: true });
    expect(await s.request({ action: 'check' })).toEqual({ ok: false, code: 'IO' });
    expect(s.snapshot().result).toBeNull();
  });
  it('rejects native file selections outside authorized root and filesystem links', async () => {
    const root = await temp();
    const source = join(root, 'source');
    await mkdir(source);
    const external = join(root, 'outside');
    await writeFile(external, 'private');
    const { s, d } = await projectService();
    d.open.mockResolvedValueOnce([source]);
    await s.request({ action: 'source' });
    d.open.mockResolvedValueOnce([external]);
    expect(await s.request({ action: 'files' })).toEqual({ ok: false, code: 'INVALID' });
    const link = join(source, 'link');
    try {
      await symlink(external, link);
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    d.open.mockResolvedValueOnce([link]);
    expect(await s.request({ action: 'files' })).toEqual({ ok: false, code: 'INVALID' });
    await expect(safeRead(link, 1024)).rejects.toThrow();
    expect(s.snapshot().project?.files).toEqual([]);
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
    const settings = config();
    const zipPath = join(root, 'out.zip');
    await exportLauncherZip(binary, zipPath, settings, new AbortController().signal, () => {});
    const zip = readZip(await readFile(zipPath));
    expect(zip.get(binaryName)?.data.equals(bytes)).toBe(true);
    expect(zip.get(binaryName)?.mode).toBe(0o755);
    expect(
      parseServerConfig(JSON.parse(zip.get('torchlauncher-server.json')?.data.toString() ?? '')),
    ).toEqual(settings);
    await exportLauncherZip(binary, zipPath, settings, new AbortController().signal, () => {});
    await rm(zipPath);
    await mkdir(zipPath);
    await expect(
      exportLauncherZip(binary, zipPath, settings, new AbortController().signal, () => {}),
    ).rejects.toThrow();
    expect((await readdir(root)).filter((n) => n.startsWith('.torchstudio-'))).toEqual([]);
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
