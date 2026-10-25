import { execFile } from 'node:child_process';
import { link, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytes, metadata, transport } from './fixtures/release.js';
import {
  compareStableVersions,
  createLauncherReleaseClient,
  launcherTarget,
  parseStableVersion,
} from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const cacheDir = await mkdtemp(join(tmpdir(), 'release-core-'));
  roots.push(cacheDir);
  const fetch = transport();
  return {
    cacheDir,
    fetch,
    client: createLauncherReleaseClient({ cacheDir, fetch }),
    signal: new AbortController().signal,
  };
}
describe('shared release boundary', () => {
  it('checks metadata without creating cache files or fetching executable bytes', async () => {
    const h = await setup();
    expect((await h.client.latest('windows', h.signal)).version).toBe('1.10.0');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(await readdir(h.cacheDir)).toEqual([]);
  });
  it.each([
    '1.0.0-rc.1',
    '01.0.0',
    '1.0',
    '1.0.0+meta',
    '9007199254740992.0.0',
    '1.0.0\n',
    ' 1.0.0',
    '1.0.0 ',
  ])('rejects unstable or ambiguous version %s', (value) => {
    expect(parseStableVersion(value)).toBeNull();
  });
  it('orders numeric components and rejects unsupported operating systems and architectures', () => {
    expect(compareStableVersions('1.10.0', '1.9.99')).toBe(1);
    expect(compareStableVersions('v2.0.0', '10.0.0')).toBe(-1);
    expect(launcherTarget('win32', 'x64')).toBe('windows');
    for (const [platform, arch] of [
      ['linux', 'arm64'],
      ['darwin', 'x64'],
      ['win32', 'ia32'],
    ] as const)
      expect(() => launcherTarget(platform, arch)).toThrow();
  });
  it('refetches latest at download and blocks an equal or older version before fetching bytes', async () => {
    const h = await setup();
    await h.client.latest('windows', h.signal);
    h.fetch.mockResolvedValue(Response.json(metadata('1.9.0')));
    await expect(
      h.client.download('windows', { signal: h.signal, newerThan: '1.9.0' }),
    ).rejects.toMatchObject({ code: 'NO_UPDATE' });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(await readdir(h.cacheDir)).toEqual([]);
  });
  it.each(['fake-stable', 'duplicate', 'missing-digest', 'bad-repo'] as const)(
    'rejects %s before binary access',
    async (variant) => {
      const h = await setup();
      const release = metadata();
      const asset = release.assets[0];
      if (!asset) throw new Error('missing test asset');
      if (variant === 'fake-stable') release.tag_name = 'v1.10.0-rc.1';
      if (variant === 'duplicate') release.assets.push({ ...asset });
      if (variant === 'missing-digest') asset.digest = '';
      h.fetch.mockResolvedValue(Response.json(release));
      const client =
        variant === 'bad-repo'
          ? createLauncherReleaseClient({
              cacheDir: h.cacheDir,
              fetch: h.fetch,
              repository: '../repo',
            })
          : h.client;
      await expect(client.latest('windows', h.signal)).rejects.toThrow();
      expect(h.fetch.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );
  it('preserves AbortError when cancellation interrupts a metadata body', async () => {
    const h = await setup();
    const controller = new AbortController();
    h.fetch.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const pending = h.client.latest('windows', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects hardlinked binaries and publishes separate immutable generations concurrently', async () => {
    const h = await setup();
    const [a, b] = await Promise.all([
      h.client.download('windows', { signal: h.signal }),
      h.client.download('windows', { signal: h.signal }),
    ]);
    expect(await readFile(a.path)).toEqual(bytes);
    expect(await readFile(b.path)).toEqual(bytes);
    const cached = await h.client.cached('windows', h.signal);
    expect(cached).not.toBeNull();
    if (!cached) throw new Error('missing cache');
    await link(cached.path, join(h.cacheDir, 'hardlink'));
    expect(await h.client.cached('windows', h.signal)).toBeNull();
    expect(await readFile(a.path)).toEqual(bytes);
  });
});

it.skipIf(process.platform === 'win32')(
  'rejects FIFO cache metadata without blocking',
  async () => {
    const h = await setup();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(h.cacheDir, 'windows'));
    await promisify(execFile)('mkfifo', [join(h.cacheDir, 'windows/current')]);
    expect(await h.client.cached('windows', h.signal)).toBeNull();
  },
);
it('bounds a stalled metadata body by the network deadline', async () => {
  const h = await setup();
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout bypasses fake timers; use the same abort contract.
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  try {
    h.fetch.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const pending = h.client.latest('windows', h.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LAUNCHER_OFFLINE' });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
  } finally {
    timeout.mockRestore();
    vi.useRealTimers();
  }
});

describe('release application identity', () => {
  it.each(['windows', 'linux'] as const)(
    'selects the exact Studio asset for %s alongside launcher assets',
    async (target) => {
      const h = await setup();
      const release = metadata();
      const launcherName = `TorchLauncher-1.10.0-${target === 'windows' ? 'win-x64.exe' : 'linux-x64.AppImage'}`;
      const studioName = launcherName.replace('TorchLauncher-', 'TorchLauncher Studio-');
      const fixture = release.assets[0];
      if (!fixture) throw new Error('missing asset');
      release.assets = [launcherName, studioName].map((name) => ({
        ...fixture,
        name,
        browser_download_url: `https://github.com/jiunkong/TorchLauncher/releases/download/v1.10.0/${encodeURIComponent(name)}`,
      }));
      h.fetch.mockImplementation(async () => Response.json(release));
      const studio = createLauncherReleaseClient({
        cacheDir: h.cacheDir,
        fetch: h.fetch,
        application: 'studio',
      });
      expect((await studio.latest(target, h.signal)).name).toBe(studioName);
      expect((await h.client.latest(target, h.signal)).name).toBe(launcherName);
      release.assets = release.assets.filter((asset) => asset.name === launcherName);
      h.fetch.mockImplementation(async () => Response.json(release));
      await expect(studio.latest(target, h.signal)).rejects.toMatchObject({
        code: 'LAUNCHER_NO_ASSET',
      });
    },
  );
  it('never reuses a different product cache and retains each verified artifact', async () => {
    const h = await setup();
    const studioRelease = metadata('1.10.0', 'studio');
    h.fetch.mockImplementation(async (url) =>
      String(url).includes('/latest') ? Response.json(studioRelease) : new Response(bytes),
    );
    const studio = createLauncherReleaseClient({
      cacheDir: h.cacheDir,
      fetch: h.fetch,
      application: 'studio',
    });
    const artifact = await studio.download('windows', { signal: h.signal });
    expect(artifact.name).toBe('TorchLauncher Studio-1.10.0-win-x64.exe');
    expect((await studio.cached('windows', h.signal))?.path).toBe(artifact.path);
    expect(await h.client.cached('windows', h.signal)).toBeNull();
    h.fetch.mockImplementation(async (url) =>
      String(url).includes('/latest') ? Response.json(metadata()) : new Response(bytes),
    );
    const launcher = await h.client.download('windows', { signal: h.signal });
    expect(launcher.name).toBe('TorchLauncher-1.10.0-win-x64.exe');
    expect(await studio.cached('windows', h.signal)).toBeNull();
    expect(await readFile(artifact.path)).toEqual(bytes);
    expect(await readFile(launcher.path)).toEqual(bytes);
  });
});
