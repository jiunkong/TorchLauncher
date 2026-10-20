import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import realVersion from './fixtures/1.21.1.json';
import { fixture } from './fixtures/installation';
import { installMinecraft, VERSION_MANIFEST_URL } from './installer';
import { allows, type Platform, parseVersion, runtimePlatform, safePath } from './metadata';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'torch-game-01-'));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const platforms: Platform[] = [
  { os: 'linux', arch: 'x64', version: '6.1' },
  { os: 'windows', arch: 'x64', version: '10.0' },
  { os: 'windows', arch: 'arm64', version: '10.0' },
  { os: 'osx', arch: 'x64', version: '14' },
  { os: 'osx', arch: 'arm64', version: '14' },
];
describe('Minecraft installation', () => {
  it.each(platforms)('installs verified game/assets/Java for $os $arch', async (platform) => {
    const data = fixture(platform);
    const path = await root();
    const progress = vi.fn();
    const installed = await installMinecraft({
      root: path,
      platform,
      download: data.downloader,
      onProgress: progress,
    });
    expect(await readFile(installed.javaPath, 'utf8')).toBe('java-executable');
    expect((await stat(installed.javaPath)).mode & 0o111).toBeTruthy();
    expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('client-jar');
    expect(installed.classpath.some((file) => file.endsWith('windows.jar'))).toBe(
      platform.os === 'windows',
    );
    expect(data.requests.filter((url) => url === data.asset.url)).toHaveLength(1);
    expect(progress.mock.calls.at(-1)?.[0].completed).toBe(progress.mock.calls.at(-1)?.[0].total);
    expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
    if (platform.os !== 'windows')
      expect(
        await readlink(
          join(path, 'runtime/java-runtime-delta', runtimePlatform(platform), 'legal/COPY'),
        ),
      ).toBe('LICENSE');
  });
  it('reuses valid content and repairs corrupt files without changing personal data', async () => {
    const data = fixture();
    const path = await root();
    const options = { root: path, platform: data.platform, download: data.downloader };
    await installMinecraft(options);
    await writeFile(join(path, 'options.txt'), 'personal-settings');
    data.requests.length = 0;
    await installMinecraft(options);
    for (const file of [data.java, data.client, data.asset, data.library])
      expect(data.requests).not.toContain(file.url);
    await writeFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'corruption');
    data.requests.length = 0;
    await installMinecraft(options);
    expect(data.requests).toContain(data.client.url);
    expect(await readFile(join(path, 'options.txt'), 'utf8')).toBe('personal-settings');
  });
  it('keeps prior files when a later download fails integrity', async () => {
    const data = fixture();
    const path = await root();
    await mkdir(join(path, 'versions/1.21.1'), { recursive: true });
    await writeFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'previous');
    data.responses.set(data.java.url, Buffer.from('bad-java-data!!'));
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow();
    expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('previous');
    expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
  });
  it('does not publish after cancellation even if an adapter ignores the signal', async () => {
    const data = fixture();
    const path = await root();
    const controller = new AbortController();
    await expect(
      installMinecraft({
        root: path,
        platform: data.platform,
        signal: controller.signal,
        download: async (url, options) => {
          const result = await data.downloader(url, options);
          if (url === data.java.url) controller.abort();
          return result;
        },
      }),
    ).rejects.toThrow();
    await expect(readFile(join(path, 'versions/1.21.1/1.21.1.jar'))).rejects.toThrow();
    expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
  });
  it('rejects symlinked parents and preserves files outside the root', async () => {
    const data = fixture();
    const path = await root();
    const outside = await root();
    await symlink(outside, join(path, 'libraries'), 'dir');
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow('Unsafe installation directory');
    expect(await readdir(outside)).toEqual([]);
  });
  it('rejects a symlinked root', async () => {
    const data = fixture();
    const parent = await root();
    const outside = await root();
    await symlink(outside, join(parent, 'server'), 'dir');
    await expect(
      installMinecraft({
        root: join(parent, 'server'),
        platform: data.platform,
        download: data.downloader,
      }),
    ).rejects.toThrow('Unsafe installation directory');
  });
  it('refuses a second writer and never removes another writer lock', async () => {
    const data = fixture();
    const path = await root();
    await mkdir(join(path, '.torchlauncher-install-lock'));
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow();
    expect(await readdir(path)).toContain('.torchlauncher-install-lock');
    expect(data.requests).toEqual([]);
  });
  it.each(['../escape', '/absolute', 'C:/escape', 'a\\b', 'CON', 'a./b', 'a//b'])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => safePath(path)).toThrow();
    },
  );
  it('rejects metadata tampering before requesting artifact bytes', async () => {
    const data = fixture();
    const path = await root();
    data.responses.set(data.version.url, Buffer.from('{}'));
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow('Version metadata integrity mismatch');
    expect(data.requests).toEqual([VERSION_MANIFEST_URL, data.version.url]);
  });
  it('rejects malformed asset lengths', async () => {
    const data = fixture();
    const path = await root();
    const bytes = Buffer.from(
      JSON.stringify({ objects: { malicious: { hash: data.asset.sha1, size: -1 } } }),
    );
    const { createHash } = await import('node:crypto');
    data.versionData.assetIndex = {
      ...data.assetIndex,
      size: bytes.length,
      sha1: createHash('sha1').update(bytes).digest('hex'),
      id: '17',
    };
    data.responses.set(data.assetIndex.url, bytes);
    data.refresh();
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow('Invalid metadata size');
    expect(data.requests).not.toContain(data.client.url);
  });
  it('rejects escaping runtime links before artifact downloads', async () => {
    const data = fixture();
    const path = await root();
    data.runtimeData.files['legal/COPY'] = { type: 'link', target: '../../outside' };
    data.refresh();
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow();
    expect(data.requests).not.toContain(data.client.url);
  });
  it('rolls back previous replacements when publication fails midway', async () => {
    const data = fixture();
    const path = await root();
    await mkdir(join(path, 'versions/1.21.1'), { recursive: true });
    await writeFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'old-client');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let failed = false;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (!failed && String(to).endsWith('common.jar')) {
        failed = true;
        throw new Error('Injected commit failure');
      }
      return actual.rename(from, to);
    });
    try {
      await expect(
        installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
      ).rejects.toThrow('Injected commit failure');
      expect(failed).toBe(true);
      expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('old-client');
      expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
    } finally {
      vi.mocked(rename).mockImplementation(actual.rename);
    }
  });
  it('retains the journal and backups if rollback itself fails', async () => {
    const data = fixture();
    const path = await root();
    await mkdir(join(path, 'versions/1.21.1'), { recursive: true });
    await writeFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'old-client');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to).endsWith('common.jar') || String(from).includes('/backups/'))
        throw new Error('Injected disk failure');
      return actual.rename(from, to);
    });
    try {
      await expect(
        installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
      ).rejects.toThrow('rollback failed');
      const lock = join(path, '.torchlauncher-install-lock');
      const journal = JSON.parse(await readFile(join(lock, 'journal.json'), 'utf8'));
      const client = journal.operations.find((entry: { target: string }) =>
        entry.target.endsWith('1.21.1.jar'),
      );
      expect(await readFile(client.backup, 'utf8')).toBe('old-client');
      await expect(
        installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
      ).rejects.toThrow();
    } finally {
      vi.mocked(rename).mockImplementation(actual.rename);
    }
  });
  it('rejects unsupported Linux ARM64 rather than choosing an x64 runtime', async () => {
    const data = fixture();
    await expect(
      installMinecraft({
        root: await root(),
        platform: { ...data.platform, arch: 'arm64' },
        download: data.downloader,
      }),
    ).rejects.toThrow('no Linux ARM64');
    expect(data.requests).toEqual([]);
  });
  it('preflights wrong destination types before publication', async () => {
    const data = fixture();
    const path = await root();
    await mkdir(join(path, 'versions/1.21.1/1.21.1.json'), { recursive: true });
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow('unexpected type');
    await expect(readFile(join(path, 'versions/1.21.1/1.21.1.jar'))).rejects.toThrow();
  });
});

describe('published 1.21.1 metadata and rules', () => {
  it('parses real metadata and chooses native JARs by published OS rules', () => {
    const version = parseVersion(realVersion);
    expect(version.javaVersion).toEqual({ component: 'java-runtime-delta', majorVersion: 21 });
    for (const platform of platforms) {
      const selected = version.libraries.filter((library) => allows(library.rules, platform));
      expect(selected.length).toBeGreaterThan(50);
      expect(selected.some((library) => library.name.endsWith('natives-linux'))).toBe(
        platform.os === 'linux',
      );
      expect(selected.some((library) => library.name.endsWith('natives-windows'))).toBe(
        platform.os === 'windows',
      );
    }
  });
  it('applies last matching rule, OS version, architecture and feature defaults', () => {
    const platform = platforms[0] as Platform;
    expect(allows(undefined, platform)).toBe(true);
    expect(allows([], platform)).toBe(false);
    expect(
      allows(
        [
          { action: 'allow' },
          { action: 'disallow', os: { name: 'linux', arch: 'x86_64', version: '^6\\.' } },
        ],
        platform,
      ),
    ).toBe(false);
    expect(allows([{ action: 'allow', features: { enabled: false } }], platform)).toBe(true);
    expect(allows([{ action: 'allow', features: { enabled: true } }], platform)).toBe(false);
  });
});
