import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import { validateImage } from './branding.js';
import { createProjectAt } from './fixtures/projects.js';
import { StudioService } from './fixtures/signing.js';
import { readZip } from './fixtures/zip.js';
import { newProject, parseProject } from './project.js';
import { decodeProjectFile, encodeProjectFile } from './project-file.js';
import { PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const decode = () => ({ width: 1, height: 1 });
const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-brand-'));
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
function source(bytes: Buffer): DownloadSource {
  const snapshot = { totalLength: bytes.length, etag: '"branding"', lastModified: null };
  let generation = 0;
  return {
    kind: 'https',
    sourceId: 'branding-test',
    get generation() {
      return generation;
    },
    snapshot,
    async getRange(range) {
      return {
        sourceId: this.sourceId,
        sourceGeneration: generation,
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
async function service(dir?: string) {
  const d = dialogs();
  let pack: Buffer = Buffer.alloc(0);
  const s = new StudioService(d, () => source(pack), decode);
  const projDir = dir ?? (await temp());
  await createProjectAt(s, d, projDir);
  return {
    d,
    s,
    projDir,
    setPack: (value: Buffer) => {
      pack = value;
    },
  };
}

describe('Studio durable branding', () => {
  it('preserves one snapshot across source replacement, save/reopen, writer and folder export', async () => {
    const { s, d, projDir, setPack } = await service();
    const root = projDir;
    const outside = await temp();
    const image = join(outside, 'input.png');
    await writeFile(image, png);
    d.open.mockResolvedValueOnce([image]);
    expect((await s.request({ action: 'brandingSelect', role: 'icon' })).ok).toBe(true);
    await s.request({ action: 'brandingRemove', role: 'background' });
    await s.request({ action: 'brandingName', appName: 'Custom launcher' });
    const summary = s.snapshot().project;
    expect(JSON.stringify(summary)).not.toContain('base64');
    expect(summary?.branding?.icon).toMatchObject({ length: png.length });
    await writeFile(image, 'original replaced');
    const projectPath = join(root, PROJECT_FILE_NAME);
    expect((await s.request({ action: 'save' })).ok).toBe(true);
    const savedFile = await readFile(projectPath);
    expect(savedFile.includes(Buffer.from(png.toString('base64')))).toBe(false);
    expect(savedFile.includes(png)).toBe(true);
    expect(decodeProjectFile(savedFile, decode).snapshots.icon?.equals(png)).toBe(true);
    d.open.mockResolvedValueOnce([root]);
    expect((await s.request({ action: 'open', discard: true })).ok).toBe(true);
    expect(s.snapshot().project).toEqual(summary);
    const packPath = join(root, 'server.torchpack');
    d.save.mockResolvedValueOnce(packPath);
    expect((await s.request({ action: 'build' })).ok).toBe(true);
    const pack = await readFile(packPath);
    setPack(pack);
    const reader = await openDeploymentReader(source(pack), {
      expectedServerId: parseProject(summary).serverId,
    });
    expect(reader.header.formatVersion.minor).toBe(2);
    expect(reader.index.files).toEqual([]);
    await reader.stageBrandingAsset('icon', join(root, 'staged.png'));
    expect(await readFile(join(root, 'staged.png'))).toEqual(png);
    expect(reader.index.branding?.background).toBeNull();
    const project = parseProject(s.snapshot().project);
    project.sourceUrl = 'https://example.org/pack';
    await s.request({ action: 'update', project });
    expect((await s.request({ action: 'check' })).ok).toBe(true);
    const binary = join(root, 'Torch.exe');
    await writeFile(binary, 'MZ unchanged binary');
    const zipPath = join(root, 'output.zip');
    s.testLauncherPath = binary;
    d.save.mockResolvedValueOnce(zipPath);
    expect((await s.request({ action: 'export' })).ok).toBe(true);
    const zip = readZip(await readFile(zipPath));
    const config = JSON.parse(zip.get('torchlauncher-server.json')?.data.toString('utf8') ?? '');
    expect(config.branding.appName).toBe('Custom launcher');
    expect(config.branding.icon.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(config.branding.background).toBeUndefined();
    expect(zip.get(config.branding.icon.path)?.data).toEqual(png);
    expect(zip.get('Torch.exe')?.data.toString('utf8')).toBe('MZ unchanged binary');
    await s.request({ action: 'brandingRemove', role: 'icon' });
    expect(await s.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
  });
  it('supports background snapshots, unchanged renderer edits, appName-only signed packs and cancelled selection', async () => {
    const root = await temp();
    const image = join(root, 'background.png');
    await writeFile(image, png);
    const { s, d, projDir } = await service();
    await s.request({ action: 'brandingName', appName: 'Local title' });
    const nameOnlyPath = join(projDir, 'name-only.torchpack');
    d.save.mockResolvedValueOnce(nameOnlyPath);
    expect((await s.request({ action: 'build' })).ok).toBe(true);
    const nameOnly = await openDeploymentReader(source(await readFile(nameOnlyPath)), {
      expectedServerId: parseProject(s.snapshot().project).serverId,
    });
    expect(nameOnly.header.formatVersion.minor).toBe(2);
    d.open.mockResolvedValueOnce([image]);
    expect((await s.request({ action: 'brandingSelect', role: 'background' })).ok).toBe(true);
    const before = parseProject(s.snapshot().project);
    expect(
      (await s.request({ action: 'update', project: { ...before, name: 'Edited existing form' } }))
        .ok,
    ).toBe(true);
    expect(s.snapshot().project?.branding).toEqual(before.branding);
    let finish!: (paths: string[]) => void;
    d.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.request({ action: 'brandingSelect', role: 'background' });
    await s.request({ action: 'cancel' });
    finish([image]);
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
    expect(s.snapshot().project?.branding).toEqual(before.branding);
    const packPath = join(root, 'background.torchpack');
    d.save.mockResolvedValueOnce(packPath);
    expect((await s.request({ action: 'build' })).ok).toBe(true);
    const reader = await openDeploymentReader(source(await readFile(packPath)), {
      expectedServerId: before.serverId,
    });
    await reader.stageBrandingAsset('background', join(root, 'background-staged.png'));
    expect(await readFile(join(root, 'background-staged.png'))).toEqual(png);
  });
  it('rejects forged commands, summary changes, bad names and failed/cancelled imports without replacing selection', async () => {
    const root = await temp();
    const path = join(root, 'image.png');
    await writeFile(path, png);
    const { s, d } = await service();
    d.open.mockResolvedValueOnce([path]);
    await s.request({ action: 'brandingSelect', role: 'icon' });
    const before = s.snapshot().project;
    for (const input of [
      { action: 'brandingSelect', role: 'icon', path },
      { action: 'brandingSelect', role: 'other' },
      { action: 'brandingName', appName: 42 },
      { action: 'brandingRemove', role: 'icon', url: 'https://example.org' },
    ])
      expect(await s.request(input)).toEqual({ ok: false, code: 'INVALID' });
    expect(await s.request({ action: 'update', project: { ...before, branding: {} } })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(await s.request({ action: 'brandingName', appName: 'bad\nname' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(await s.request({ action: 'brandingSelect', role: 'icon' })).toEqual({
      ok: false,
      code: 'CANCELLED',
    });
    await writeFile(path, 'bad image');
    d.open.mockResolvedValueOnce([path]);
    expect(await s.request({ action: 'brandingSelect', role: 'icon' })).toEqual({
      ok: false,
      code: 'IMAGE_FAILED',
      image: { reason: 'unsupported', role: 'icon', name: 'image.png' },
    });
    expect(s.snapshot().project).toEqual(before);
    await s.request({ action: 'brandingName', appName: 'Title' });
    await s.request({ action: 'brandingName', appName: null });
    expect(s.snapshot().project?.branding?.appName).toBeUndefined();
  });
  it('serves bounded read-only previews keyed by sha256 and drops them on remove', async () => {
    const root = await temp();
    const path = join(root, 'image.png');
    await writeFile(path, png);
    const { s, d, projDir } = await service();
    const sha = createHash('sha256').update(png).digest('hex');
    expect(await s.request({ action: 'brandingImage', role: 'icon', sha256: sha })).toEqual({
      ok: false,
      code: 'MISMATCH',
    });
    for (const input of [
      { action: 'brandingImage', role: 'other', sha256: sha },
      { action: 'brandingImage', role: 'icon', sha256: 'abc' },
      { action: 'brandingImage', role: 'icon' },
      { action: 'brandingImage', role: 'icon', sha256: sha, path },
    ])
      expect(await s.request(input)).toEqual({ ok: false, code: 'INVALID' });
    d.open.mockResolvedValueOnce([path]);
    await s.request({ action: 'brandingSelect', role: 'icon' });
    const reply = await s.request({ action: 'brandingImage', role: 'icon', sha256: sha });
    expect(reply.ok && reply.image).toEqual({
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: 1,
      height: 1,
      sha256: sha,
    });
    expect(JSON.stringify(reply)).not.toContain(root);
    expect(
      await s.request({ action: 'brandingImage', role: 'icon', sha256: '0'.repeat(64) }),
    ).toEqual({ ok: false, code: 'MISMATCH' });
    expect(await s.request({ action: 'brandingImage', role: 'background', sha256: sha })).toEqual({
      ok: false,
      code: 'MISMATCH',
    });
    expect((await s.request({ action: 'save' })).ok).toBe(true);
    // Reopening loads the snapshot from the project file.
    const other = new StudioService(d, undefined, decode);
    d.open.mockResolvedValueOnce([projDir]);
    expect((await other.request({ action: 'open' })).ok).toBe(true);
    expect((await other.request({ action: 'brandingImage', role: 'icon', sha256: sha })).ok).toBe(
      true,
    );
    await s.request({ action: 'brandingRemove', role: 'icon' });
    expect(await s.request({ action: 'brandingImage', role: 'icon', sha256: sha })).toEqual({
      ok: false,
      code: 'MISMATCH',
    });
  });
  it('downscales large stored images for the preview and reports failures', async () => {
    const root = await temp();
    const path = join(root, 'image.png');
    const header = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(300, 16);
    header.writeUInt32BE(300, 20);
    header.set([8, 6, 0, 0, 0], 24);
    await writeFile(path, header);
    const d = dialogs();
    const small = { width: 128, height: 128 };
    let encoded = Buffer.alloc(1000, 7);
    const resize = vi.fn(() => ({
      ...small,
      resize,
      toPNG: () => encoded,
      toJPEG: () => encoded,
    }));
    const raster = vi.fn(() => ({
      width: 300,
      height: 300,
      resize,
      toPNG: () => encoded,
      toJPEG: () => encoded,
    }));
    const s = new StudioService(
      d,
      undefined,
      () => ({ width: 300, height: 300 }),
      undefined,
      undefined,
      undefined,
      raster,
    );
    await createProjectAt(s, d, await temp());
    d.open.mockResolvedValueOnce([path]);
    expect((await s.request({ action: 'brandingSelect', role: 'icon' })).ok).toBe(true);
    const sha = createHash('sha256').update(header).digest('hex');
    const reply = await s.request({ action: 'brandingImage', role: 'icon', sha256: sha });
    expect(reply.ok && reply.image).toMatchObject({ width: 128, height: 128, sha256: sha });
    expect(resize).toHaveBeenCalledWith(128, 128);
    encoded = Buffer.alloc(300 * 1024);
    expect(await s.request({ action: 'brandingImage', role: 'icon', sha256: sha })).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    });
    raster.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await s.request({ action: 'brandingImage', role: 'icon', sha256: sha })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  });
  it('rejects malformed/corrupt snapshots, metadata, bounds and actual decoder disagreement', () => {
    const metadata = validateImage('icon', png, decode);
    const project = { ...newProject(), branding: { icon: metadata } };
    const saved = encodeProjectFile(project, { icon: png });
    expect(decodeProjectFile(saved, decode).project).toEqual(project);
    expect(() => encodeProjectFile(project, {})).toThrow();
    expect(() => decodeProjectFile(saved, () => ({ width: 2, height: 1 }))).toThrow();
    expect(() => validateImage('icon', png, () => ({ width: 2, height: 1 }))).toThrow();
    expect(() =>
      validateImage('icon', png, () => {
        throw new Error('decode');
      }),
    ).toThrow();
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(513, 16);
    expect(() => validateImage('icon', oversized, decode)).toThrow();
    expect(() => validateImage('icon', Buffer.alloc(1024 ** 2 + 1), decode)).toThrow();
    expect(() =>
      parseProject({ ...project, branding: { icon: { ...metadata, base64: 'x' } } }),
    ).toThrow();
  });
  it('rejects hardlinks, symlinks and parent links and preserves current project on invalid open', async () => {
    const root = await temp();
    const path = join(root, 'image.png');
    await writeFile(path, png);
    const { s, d } = await service();
    const original = s.snapshot().project;
    const hard = join(root, 'hard.png');
    await link(path, hard);
    d.open.mockResolvedValueOnce([hard]);
    expect(await s.request({ action: 'brandingSelect', role: 'icon' })).toEqual({
      ok: false,
      code: 'IMAGE_FAILED',
      image: { reason: 'unreadable', role: 'icon', name: 'hard.png', cause: 'notFile' },
    });
    if (process.platform !== 'win32') {
      const dir = join(root, 'dir');
      await mkdir(dir);
      await writeFile(join(dir, 'image.png'), png);
      const linked = join(root, 'linked');
      await symlink(dir, linked);
      d.open.mockResolvedValueOnce([join(linked, 'image.png')]);
      expect(await s.request({ action: 'brandingSelect', role: 'icon' })).toEqual({
        ok: false,
        code: 'IMAGE_FAILED',
        image: { reason: 'unreadable', role: 'icon', name: 'image.png', cause: 'notFile' },
      });
    }
    const bad = join(root, 'project.torchproj');
    await writeFile(
      bad,
      Buffer.from(
        JSON.stringify({
          ...newProject(),
          branding: {
            icon: { sha256: '0'.repeat(64), length: 1, mediaType: 'image/png', base64: 'YQ==' },
          },
        }),
      ),
    );
    d.open.mockResolvedValueOnce([bad]);
    expect((await s.request({ action: 'open', discard: true })).ok).toBe(false);
    expect(s.snapshot().project).toEqual(original);
  });
  it('validates fixed sidecars before the ZIP is written', async () => {
    const { exportLauncherZip } = await import('./filesystem.js');
    const root = await temp();
    const binary = join(root, 'Torch.exe');
    await writeFile(binary, 'MZ fake');
    const metadata = validateImage('icon', png, decode);
    const { parseServerConfig } = await import(
      '../../../../packages/core/src/server-config/index.js'
    );
    const p = newProject();
    const config = parseServerConfig({
      format: 'torchlauncher-server',
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      version: 1,
      serverId: p.serverId,
      name: p.name,
      address: p.address,
      sourceUrl: 'https://example.org/pack',
      branding: { icon: { ...metadata, path: 'branding/icon.png' } },
    });
    const target = join(root, 'out.zip');
    const run = (cfg: typeof config, icon: Buffer) =>
      exportLauncherZip(binary, target, cfg, new AbortController().signal, () => {}, { icon });
    await expect(run(config, Buffer.from('wrong'))).rejects.toThrow();
    const badConfig = {
      ...config,
      branding: { icon: { ...metadata, path: 'branding/other.png' } },
    };
    await expect(run(badConfig, png)).rejects.toThrow();
    expect(await readdir(root)).toEqual(['Torch.exe']);
    await run(config, png);
    expect(readZip(await readFile(target)).get('branding/icon.png')?.data).toEqual(png);
  });
});
