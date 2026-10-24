import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyPng } from '../../../../../packages/core/src/branding/fixtures/images';
import type { BrandingDeploymentReader } from '../../../../../packages/core/src/deployment/reader/index';
import type { ServerConfig } from '../../../../../packages/core/src/server-config/index';
import { readBrandingFile } from './files';
import { type BrandingOptions, BrandingService, brandingFingerprint } from './service';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const png = tinyPng();
const metadata = { sha256: hash(png), length: png.length, mediaType: 'image/png' as const };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'branding-service-'));
  roots.push(root);
  const base = join(root, 'user-data');
  const profile = join(root, 'actual-profile');
  await mkdir(base);
  await mkdir(profile);
  await mkdir(join(profile, 'branding'));
  await writeFile(join(profile, 'branding', 'icon.png'), png);
  const config: ServerConfig = {
    format: 'torchlauncher-server',
    signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    version: 1,
    serverId: '11111111-1111-4111-8111-111111111111',
    name: 'Home server stays',
    address: 'localhost:25565',
    sourceUrl: 'https://example.invalid/deployment',
    branding: { appName: 'Custom launcher', icon: { ...metadata, path: 'branding/icon.png' } },
  };
  const configPath = join(profile, 'server.json');
  const publish = vi.fn();
  const options: BrandingOptions = {
    base,
    config,
    configPath,
    decode: vi.fn(() => true),
    openReader: vi.fn(async () => {
      throw new Error('offline');
    }),
    publish,
  };
  const cache = join(
    base,
    'branding',
    'v1',
    config.serverId,
    brandingFingerprint(config, configPath),
  );
  return { root, base, profile, config, configPath, options, cache, publish };
}
function reader(config: ServerConfig, roles: Record<string, unknown>, image = png) {
  return {
    index: { serverId: config.serverId, branding: roles },
    assertCurrent: vi.fn(),
    stageBrandingAsset: vi.fn(async (role: string, path: string) => {
      await writeFile(path, image);
      return { role, outputPath: path, length: image.length, sha256: hash(image) };
    }),
  } as unknown as BrandingDeploymentReader;
}
const descriptor = (bytes: Buffer = png) => ({
  sha256: hash(bytes),
  originalLength: bytes.length,
  storedLength: bytes.length,
  offset: 0,
  compression: 'none',
  mediaType: 'image/png',
});
async function start(options: BrandingOptions) {
  const service = new BrandingService(options);
  service.start();
  await service.settled();
  return service;
}

describe('hybrid branding service', () => {
  it('loads from actual profile directory before independent offline metadata and skips unchanged roles', async () => {
    const f = await fixture();
    const service = await start(f.options);
    expect(service.snapshot()).toMatchObject({
      appName: 'Custom launcher',
      icon: `data:image/png;base64,${png.toString('base64')}`,
      background: null,
    });
    const remote = reader(f.config, { icon: descriptor(), background: descriptor() });
    service.observe(remote);
    await service.settled();
    expect(remote.stageBrandingAsset).toHaveBeenCalledTimes(1);
    expect(vi.mocked(remote.stageBrandingAsset).mock.calls[0]?.[0]).toBe('background');
    expect(JSON.stringify(service.snapshot())).not.toContain(f.config.sourceUrl);
    expect(JSON.stringify(service.snapshot())).not.toContain(f.profile);
    const cached = JSON.parse(await readFile(join(f.cache, 'background.json'), 'utf8'));
    expect(Object.keys(cached).sort()).toEqual([
      'base64',
      'length',
      'mediaType',
      'sha256',
      'version',
    ]);
    await service.close();
  });
  it('prefers reverified cache over shipped image and persists null across restart', async () => {
    const f = await fixture();
    const service = await start(f.options);
    service.observe(reader(f.config, { icon: null, background: descriptor() }));
    await service.settled();
    expect(service.snapshot().icon).toBeNull();
    await service.close();
    const restarted = await start(f.options);
    expect(restarted.snapshot().icon).toBeNull();
    expect(restarted.snapshot().background).toContain('data:image/png');
    const unchanged = reader(f.config, {});
    restarted.observe(unchanged);
    await restarted.settled();
    expect(restarted.snapshot().icon).toBeNull();
    expect(unchanged.stageBrandingAsset).not.toHaveBeenCalled();
    await restarted.close();
  });
  it('rejects corrupt cache and falls back to shipped image; decode/hash failure retains previous display', async () => {
    const f = await fixture();
    let service = await start(f.options);
    service.observe(reader(f.config, { icon: null }));
    await service.settled();
    await service.close();
    await writeFile(
      join(f.cache, 'icon.json'),
      JSON.stringify({
        version: 1,
        ...metadata,
        base64: Buffer.alloc(png.length).toString('base64'),
      }),
    );
    service = await start(f.options);
    const before = service.snapshot();
    expect(before.icon).not.toBeNull();
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 1] = 1;
    service.observe(reader(f.config, { icon: descriptor(corrupt) }, png));
    await service.settled();
    expect(service.snapshot()).toBe(before);
    vi.mocked(f.options.decode).mockReturnValue(false);
    service.observe(reader(f.config, { background: descriptor() }));
    await service.settled();
    expect(service.snapshot()).toBe(before);
    await service.close();
  });
  it('isolates cache by stable profile/source content and actual config path', async () => {
    const f = await fixture();
    expect(brandingFingerprint(f.config, f.configPath)).toBe(
      brandingFingerprint(structuredClone(f.config), f.configPath),
    );
    expect(
      brandingFingerprint({ ...f.config, sourceUrl: 'https://example.invalid/new' }, f.configPath),
    ).not.toBe(brandingFingerprint(f.config, f.configPath));
    expect(brandingFingerprint(f.config, join(f.profile, 'different.json'))).not.toBe(
      brandingFingerprint(f.config, f.configPath),
    );
    const first = await start(f.options);
    first.observe(reader(f.config, { icon: null }));
    await first.settled();
    await first.close();
    const isolated = await start({ ...f.options, configPath: join(f.profile, 'different.json') });
    expect(isolated.snapshot().icon).not.toBeNull();
    await isolated.close();
  });
  it('suppresses late startup and staged responses after superseding request or close', async () => {
    const f = await fixture();
    let finishOpen: (value: BrandingDeploymentReader) => void = () => {};
    f.options.openReader = vi.fn(
      () =>
        new Promise<BrandingDeploymentReader>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const service = new BrandingService(f.options);
    service.start();
    await vi.waitFor(() => expect(f.options.openReader).toHaveBeenCalled());
    const stale = reader(f.config, { icon: null });
    const current = reader(f.config, { background: descriptor() });
    let finishStage: () => void = () => {};
    current.stageBrandingAsset = vi.fn(async (role, path) => {
      await new Promise<void>((resolve) => {
        finishStage = resolve;
      });
      await writeFile(path, png);
      return { role, outputPath: path, length: png.length, sha256: hash(png) };
    });
    service.observe(current);
    await vi.waitFor(() => expect(current.stageBrandingAsset).toHaveBeenCalled());
    finishOpen(stale);
    await service.close();
    const before = service.snapshot();
    finishStage();
    await service.settled();
    expect(service.snapshot()).toBe(before);
    expect(before.icon).not.toBeNull();
    expect(stale.stageBrandingAsset).not.toHaveBeenCalled();
    expect(await readdir(f.cache)).toEqual([]);
  });
  it('does not publish images with wrong dimensions or after reader pin failure', async () => {
    const f = await fixture();
    const service = await start(f.options);
    const wide = Buffer.from(png);
    wide.writeUInt32BE(513, 16);
    service.observe(reader(f.config, { icon: descriptor(wide) }, wide));
    await service.settled();
    const before = service.snapshot();
    const changed = reader(f.config, { background: descriptor() });
    vi.mocked(changed.assertCurrent).mockImplementation(() => {
      throw new Error('source changed');
    });
    service.observe(changed);
    await service.settled();
    expect(service.snapshot()).toBe(before);
    expect(changed.stageBrandingAsset).not.toHaveBeenCalled();
    await service.close();
  });
});

describe('bounded local branding file safety', () => {
  it('rejects excess sizes, parent traversal, hardlinks and link components', async () => {
    const f = await fixture();
    await expect(
      readBrandingFile(f.profile, 'branding/icon.png', png.length - 1),
    ).rejects.toThrow();
    await expect(readBrandingFile(f.profile, '../outside', 100)).rejects.toThrow();
    const source = join(f.profile, 'branding', 'icon.png');
    await link(source, join(f.profile, 'hard.png'));
    await expect(readBrandingFile(f.profile, 'hard.png', png.length)).rejects.toThrow();
    await rm(join(f.profile, 'hard.png'));
    await symlink(source, join(f.profile, 'link.png'));
    await expect(readBrandingFile(f.profile, 'link.png', png.length)).rejects.toThrow();
    await symlink(join(f.profile, 'branding'), join(f.profile, 'linked-dir'));
    await expect(readBrandingFile(f.profile, 'linked-dir/icon.png', png.length)).rejects.toThrow();
    await symlink(f.profile, join(f.base, 'branding'));
    const service = await start(f.options);
    expect(service.snapshot().icon).not.toBeNull();
    await service.close();
    expect(await readdir(f.profile)).not.toContain('v1');
  });
});

it('reserves startup generation before delayed initialization so observe supersedes it', async () => {
  const files = await import('./files');
  const originalRead = files.readBrandingFile;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(files, 'readBrandingFile').mockImplementationOnce(async (...args) => {
    await gate;
    return originalRead(...args);
  });
  const f = await fixture();
  const service = new BrandingService(f.options);
  service.start();
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  const remote = reader(f.config, { icon: null });
  service.observe(remote);
  release();
  await service.settled();
  expect(f.options.openReader).not.toHaveBeenCalled();
  expect(service.snapshot().icon).toBeNull();
  expect(JSON.parse(await readFile(join(f.cache, 'icon.json'), 'utf8'))).toEqual({
    version: 1,
    removed: true,
  });
  await service.close();
});
it('retains identical bytes on inconsistent same-hash remote metadata without fetching', async () => {
  const f = await fixture();
  const service = await start(f.options);
  const previous = service.snapshot();
  for (const change of [{ originalLength: png.length + 1 }, { mediaType: 'image/jpeg' }]) {
    const remote = reader(f.config, { icon: { ...descriptor(), ...change } });
    service.observe(remote);
    await service.settled();
    expect(remote.stageBrandingAsset).not.toHaveBeenCalled();
    expect(service.snapshot()).toBe(previous);
  }
  await service.close();
});

it('finishes an accepted atomic commit before a newer omitted-role reader decides retention', async () => {
  const files = await import('./files');
  const original = files.atomicBrandingRecord;
  let release: () => void = () => {};
  let accepted: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acceptance = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  vi.spyOn(files, 'atomicBrandingRecord').mockImplementationOnce(async (...args) => {
    await original(...args);
    accepted();
    await gate;
  });
  const f = await fixture();
  const service = await start(f.options);
  service.observe(reader(f.config, { icon: null }));
  await acceptance;
  service.observe(reader(f.config, {}));
  release();
  await service.settled();
  expect(service.snapshot().icon).toBeNull();
  await service.close();
  const restarted = await start(f.options);
  expect(restarted.snapshot().icon).toBeNull();
  await restarted.close();
});
