import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LauncherReleaseInfo, LauncherTarget } from '../shared/studio.js';
import { LAUNCHER_LIMIT } from './filesystem.js';
import {
  createLauncherResolver,
  type LauncherResolveRequest,
  launcherAssetName,
} from './launcher-release.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const bytes = Buffer.from('MZ00 launcher release fixture');
const digest = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const repo = 'torch-test/launcher';
function release(version = '1.0.0', target: LauncherTarget = 'windows', data = bytes) {
  const name = launcherAssetName(version, target);
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        state: 'uploaded',
        size: data.length,
        digest: digest(data),
        browser_download_url: `https://github.com/${repo}/releases/download/v${version}/${name}`,
      },
    ],
  };
}
async function harness(packaged = true) {
  const root = await mkdtemp(join(tmpdir(), 'launcher-release-'));
  roots.push(root);
  const appPath = join(root, 'admin');
  await mkdir(appPath);
  let metadata = release();
  let body = bytes;
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).includes('/releases/latest') ? Response.json(metadata) : new Response(body),
  );
  const cacheDir = join(root, 'cache');
  const status = vi.fn<(info: LauncherReleaseInfo) => void>();
  const controller = new AbortController();
  const request: LauncherResolveRequest = {
    target: 'windows',
    allowCached: false,
    signal: controller.signal,
    progress: vi.fn(),
    status,
  };
  const options = {
    packaged,
    appPath,
    appVersion: '0.1.0',
    cacheDir,
    repository: repo,
    fetch: transport,
  };
  const resolve = createLauncherResolver(options);
  return {
    root,
    appPath,
    cacheDir,
    options,
    transport,
    resolve,
    request,
    status,
    controller,
    setRelease: (value: typeof metadata) => {
      metadata = value;
    },
    setBody: (value: Buffer) => {
      body = Buffer.from(value);
    },
  };
}
describe('automatic launcher source', () => {
  it.each(['windows', 'linux'] as const)(
    'uses only the local %s package in development',
    async (target) => {
      const h = await harness(false);
      const binary = join(h.appPath, '../launcher/dist', launcherAssetName('0.1.0', target));
      await mkdir(dirname(binary), { recursive: true });
      await writeFile(binary, target === 'linux' ? Buffer.from('\x7fELF00') : bytes);
      await chmod(binary, 0o755);
      expect(await h.resolve({ ...h.request, target })).toBe(binary);
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.status).toHaveBeenLastCalledWith({ target, version: '0.1.0', source: 'local' });
    },
  );
  it('reports a missing local artifact without downloading', async () => {
    const h = await harness(false);
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_LOCAL_MISSING' });
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('blocks unconfigured packaged Studio before network/cache access', async () => {
    const h = await harness();
    await expect(
      createLauncherResolver({ ...h.options, repository: '' })(h.request),
    ).rejects.toMatchObject({ code: 'LAUNCHER_UNCONFIGURED' });
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('downloads, hashes and reuses only a cache matching latest metadata', async () => {
    const h = await harness();
    const binary = await h.resolve(h.request);
    expect(await readFile(binary)).toEqual(bytes);
    expect(h.request.progress).toHaveBeenCalledWith(bytes.length);
    expect(h.status).toHaveBeenLastCalledWith({
      target: 'windows',
      version: '1.0.0',
      source: 'release',
    });
    expect(await h.resolve(h.request)).toBe(binary);
    expect(h.transport).toHaveBeenCalledTimes(3);
    expect(h.status).toHaveBeenLastCalledWith({
      target: 'windows',
      version: '1.0.0',
      source: 'cache',
    });
    h.setRelease(release('2.0.0'));
    expect(await h.resolve(h.request)).not.toBe(binary);
    expect(await readFile(binary)).toEqual(bytes);
    expect(h.status).toHaveBeenLastCalledWith({
      target: 'windows',
      version: '2.0.0',
      source: 'release',
    });
  });
  it('detects cache tampering and downloads again', async () => {
    const h = await harness();
    const path = await h.resolve(h.request);
    await writeFile(path, 'MZ00 tampered');
    expect(await readFile(await h.resolve(h.request))).toEqual(bytes);
    expect(h.transport).toHaveBeenCalledTimes(4);
  });
  it('requires explicit consent for the exact offline cached version', async () => {
    const h = await harness();
    const binary = await h.resolve(h.request);
    h.transport.mockRejectedValue(new TypeError('offline'));
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_CACHE_CONFIRM' });
    expect(h.status).toHaveBeenLastCalledWith({
      target: 'windows',
      version: '1.0.0',
      source: 'offline-cache',
    });
    await expect(
      h.resolve({ ...h.request, allowCached: true, cachedVersion: '0.9.0' }),
    ).rejects.toMatchObject({ code: 'LAUNCHER_CACHE_CONFIRM' });
    expect(await h.resolve({ ...h.request, allowCached: true, cachedVersion: '1.0.0' })).toBe(
      binary,
    );
    await writeFile(binary, 'MZ00 damaged');
    await expect(
      h.resolve({ ...h.request, allowCached: true, cachedVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'LAUNCHER_OFFLINE' });
  });
  it('reports offline without cache and does not treat cancellation as offline', async () => {
    const h = await harness();
    h.transport.mockRejectedValue(new TypeError('offline'));
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_OFFLINE' });
    h.controller.abort();
    await expect(h.resolve(h.request)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([
    [404, 'LAUNCHER_NO_RELEASE'],
    [429, 'LAUNCHER_RELEASE_FAILED'],
    [503, 'LAUNCHER_RELEASE_FAILED'],
  ] as const)('distinguishes HTTP %s', async (status, code) => {
    const h = await harness();
    await h.resolve(h.request);
    h.transport.mockResolvedValue(new Response('', { status }));
    await expect(
      h.resolve({ ...h.request, allowCached: true, cachedVersion: '1.0.0' }),
    ).rejects.toMatchObject({ code });
  });
  it.each(['prerelease', 'draft', 'asset', 'digest', 'size', 'header', 'length', 'hash'] as const)(
    'preserves the old cache on invalid %s',
    async (variant) => {
      const h = await harness();
      const previous = await h.resolve(h.request);
      const pointer = await readFile(join(h.cacheDir, 'windows/current'), 'utf8');
      const meta = release('2.0.0');
      const asset = meta.assets[0];
      if (!asset) throw new Error('missing test asset');
      if (variant === 'prerelease') meta.prerelease = true;
      if (variant === 'draft') meta.draft = true;
      if (variant === 'asset') meta.assets = [];
      if (variant === 'digest') asset.digest = '';
      if (variant === 'size') asset.size = LAUNCHER_LIMIT + 1;
      if (variant === 'header') {
        h.setBody(Buffer.from('NO00'));
        asset.digest = digest(Buffer.from('NO00'));
        asset.size = 4;
      }
      if (variant === 'length') h.setBody(bytes.subarray(0, 4));
      if (variant === 'hash') h.setBody(Buffer.alloc(bytes.length));
      h.setRelease(meta);
      await expect(h.resolve(h.request)).rejects.toMatchObject({
        code: ['draft', 'prerelease'].includes(variant)
          ? 'LAUNCHER_NO_RELEASE'
          : variant === 'asset'
            ? 'LAUNCHER_NO_ASSET'
            : 'LAUNCHER_VERIFY',
      });
      expect(await readFile(join(h.cacheDir, 'windows/current'), 'utf8')).toBe(pointer);
      expect(await readFile(previous)).toEqual(bytes);
      expect((await readdir(join(h.cacheDir, 'windows'))).sort()).toEqual(
        [pointer, 'current'].sort(),
      );
    },
  );
  it('cleans staging on download cancellation and preserves previous cache', async () => {
    const h = await harness();
    await h.resolve(h.request);
    const pointer = await readFile(join(h.cacheDir, 'windows/current'), 'utf8');
    h.setRelease(release('2.0.0'));
    h.request.progress = () => h.controller.abort();
    await expect(h.resolve(h.request)).rejects.toThrow();
    expect(await readFile(join(h.cacheDir, 'windows/current'), 'utf8')).toBe(pointer);
    expect((await readdir(join(h.cacheDir, 'windows'))).sort()).toEqual(
      [pointer, 'current'].sort(),
    );
  });
  it('installs Linux assets with execute permissions', async () => {
    const h = await harness();
    const elf = Buffer.from('\x7fELF launcher');
    h.setRelease(release('1.0.0', 'linux', elf));
    h.setBody(elf);
    const binary = await h.resolve({ ...h.request, target: 'linux' });
    expect(binary).toMatch(/\.AppImage$/);
    expect(await readFile(binary)).toEqual(elf);
    expect(await h.resolve({ ...h.request, target: 'linux' })).toBe(binary);
  });
  it.each([
    'http://github.com/file',
    'https://evil.example/file',
    'https://github.com:444/file',
    'https://user:secret@github.com/file',
  ])('rejects unsafe redirect %s', async (location) => {
    const h = await harness();
    h.transport.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('allows bounded GitHub asset redirects and rejects redirect loops', async () => {
    const h = await harness();
    const normal = h.transport.getMockImplementation();
    if (!normal) throw new Error('missing test transport');
    h.transport.mockImplementation(async (url, init) => {
      if (String(url).startsWith('https://github.com/'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/test' },
        });
      if (String(url).includes('release-assets')) return new Response(bytes);
      return normal(url, init);
    });
    expect(await readFile(await h.resolve(h.request))).toEqual(bytes);
    h.transport.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://api.github.com/loop' } }),
    );
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
  });
  it('bounds metadata size before reading and rejects malformed JSON', async () => {
    const h = await harness();
    h.transport.mockResolvedValueOnce(
      new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    );
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
    h.transport.mockResolvedValueOnce(new Response('{broken'));
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
  });
  it('bounds streamed bytes even without content-length', async () => {
    const h = await harness();
    const normal = h.transport.getMockImplementation();
    if (!normal) throw new Error('missing transport');
    h.transport.mockImplementation(async (url, init) =>
      String(url).includes('/releases/latest')
        ? normal(url, init)
        : new Response(Buffer.alloc(bytes.length + 1)),
    );
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
    expect(await readdir(join(h.cacheDir, 'windows'))).toEqual([]);
  });
  it('rejects non-GitHub asset URLs and missing checksums before download', async () => {
    const h = await harness();
    const metadata = release();
    const asset = metadata.assets[0];
    if (!asset) throw new Error('missing asset');
    asset.browser_download_url = 'https://evil.example/launcher.exe';
    h.setRelease(metadata);
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_VERIFY' });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it.skipIf(process.platform === 'win32')(
    'rejects a linked cache root before writing into it',
    async () => {
      const h = await harness();
      const outside = join(h.root, 'outside');
      await mkdir(outside);
      await symlink(outside, h.cacheDir);
      await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'INVALID' });
      expect(await readdir(outside)).toEqual([]);
    },
  );
  it('offers the cache after a metadata stream disconnect', async () => {
    const h = await harness();
    await h.resolve(h.request);
    h.transport.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('connection lost'));
          },
        }),
      ),
    );
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_CACHE_CONFIRM' });
  });
  it('offers the old verified cache if the latest asset download goes offline', async () => {
    const h = await harness();
    const previous = await h.resolve(h.request);
    h.setRelease(release('2.0.0'));
    const normal = h.transport.getMockImplementation();
    if (!normal) throw new Error('missing transport');
    h.transport.mockImplementation(async (url, init) => {
      if (String(url).includes('/releases/latest')) return normal(url, init);
      throw new TypeError('offline');
    });
    await expect(h.resolve(h.request)).rejects.toMatchObject({ code: 'LAUNCHER_CACHE_CONFIRM' });
    expect(await h.resolve({ ...h.request, allowCached: true, cachedVersion: '1.0.0' })).toBe(
      previous,
    );
  });
});
