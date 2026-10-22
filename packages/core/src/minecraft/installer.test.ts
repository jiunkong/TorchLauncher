import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, type TestContext, vi } from 'vitest';
import realVersion from './fixtures/1.21.1.json';
import { fixture } from './fixtures/installation';
import { type InstallActivity, installMinecraft, VERSION_MANIFEST_URL } from './installer';
import { allows, type Platform, parseVersion, runtimePlatform, safePath } from './metadata';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'torch-game-01-'));
  roots.push(path);
  return path;
}
// Some Windows accounts/filesystems cannot create symlinks. Skip only symlink-dependent
// cases for explicit capability failures, keeping ordinary installation tests runnable.
async function symlinkOrSkip(
  context: TestContext,
  target: string,
  path: string,
  type: 'file' | 'dir',
) {
  try {
    await symlink(target, path, type);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && ['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code)) {
      context.skip(
        `Host cannot create ${type} symlinks (${code}); symlink containment requires a capable host`,
      );
    }
    throw error;
  }
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
    if (process.platform !== 'win32')
      expect((await stat(installed.javaPath)).mode & 0o111).toBeTruthy();
    expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('client-jar');
    expect(installed.classpath.some((file) => file.endsWith('windows.jar'))).toBe(
      platform.os === 'windows',
    );
    expect(data.requests.filter((url) => url === data.asset.url)).toHaveLength(1);
    expect(progress.mock.calls.at(-1)?.[0].completed).toBe(progress.mock.calls.at(-1)?.[0].total);
    expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
  });
  it('overlaps all resource kinds by default and reports safe activity with bounded counts', async () => {
    const data = fixture();
    const path = await root();
    const release = gate();
    const allStarted = gate();
    const metadata = new Set([
      VERSION_MANIFEST_URL,
      data.version.url,
      data.assetIndex.url,
      data.runtime.url,
      'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
    ]);
    const activity: InstallActivity[] = [];
    const progress = vi.fn();
    let started = 0;
    const pending = installMinecraft({
      root: path,
      platform: data.platform,
      onActivity: (event) => activity.push(event),
      onProgress: progress,
      download: async (url, options) => {
        if (!metadata.has(url)) {
          started++;
          if (started === 6) allStarted.resolve();
          await release.promise;
        }
        return data.downloader(url, options);
      },
    });
    await allStarted.promise;
    expect(progress).not.toHaveBeenCalled();
    expect(started).toBe(6);
    release.resolve();
    await pending;
    expect(new Set(activity.map((event) => event.component))).toEqual(
      new Set(['metadata', 'game', 'library', 'asset', 'logging', 'java']),
    );
    expect(activity[0]).toEqual({
      phase: 'planning',
      component: 'metadata',
      active: 0,
      completed: 0,
      total: null,
    });
    expect(activity.at(-1)).toEqual({
      phase: 'publishing',
      component: 'metadata',
      active: 0,
      completed: 6,
      total: 6,
    });
    expect(Math.max(...activity.map((event) => event.active))).toBe(6);
    for (const event of activity) {
      if (event.path) expect(safePath(event.path)).toBe(event.path);
      expect(JSON.stringify(event)).not.toContain('https:');
    }
    expect(progress.mock.calls.map(([event]) => event.completed)).toEqual([1, 2, 3, 4, 5, 6]);
    const published = vi
      .mocked(rename)
      .mock.calls.filter(([from]) =>
        String(from).startsWith(`${join(path, '.torchlauncher-install-lock', 'staging')}${sep}`),
      )
      .map(([, to]) =>
        String(to)
          .slice(path.length + 1)
          .split(sep)
          .join('/'),
      );
    expect(published).toEqual([
      'versions/1.21.1/1.21.1.jar',
      'libraries/test/common/1/common.jar',
      `assets/objects/${data.asset.sha1.slice(0, 2)}/${data.asset.sha1}`,
      'assets/log_configs/client.xml',
      `runtime/java-runtime-delta/${runtimePlatform(data.platform)}`,
      'versions/1.21.1/1.21.1.json',
      'assets/indexes/17.json',
    ]);
    data.requests.length = 0;
    activity.length = 0;
    await installMinecraft({
      root: path,
      platform: data.platform,
      download: data.downloader,
      onActivity: (event) => activity.push(event),
    });
    expect(activity.some((event) => event.phase === 'downloading')).toBe(false);
    expect(
      activity.filter((event) => event.phase === 'staging').map((event) => event.component),
    ).toEqual(['java', 'java']);
  });

  it.each(['integrity', 'progress', 'activity', 'cancel'] as const)(
    'drains stalled downloads before cleanup on %s failure',
    async (kind) => {
      const data = fixture();
      const path = await root();
      if (kind === 'activity') {
        // Reuse Java, but force two game transfers so the cached Java activity callback
        // fails while the first transfer remains stalled.
        await installMinecraft({ root: path, platform: data.platform, download: data.downloader });
        await writeFile(join(path, 'libraries/test/common/1/common.jar'), 'corrupt');
        data.requests.length = 0;
      }
      await mkdir(join(path, 'versions/1.21.1'), { recursive: true });
      await writeFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'previous');
      const clientStarted = gate();
      const release = gate();
      const aborted = gate();
      const controller = new AbortController();
      const callbackError = new Error('callback failed');
      const progress = vi.fn(() => {
        if (kind === 'progress') throw callbackError;
      });
      let settled = false;
      const pending = installMinecraft({
        root: path,
        platform: data.platform,
        concurrency: 2,
        signal: controller.signal,
        onProgress: progress,
        onActivity: (event) => {
          if (kind === 'activity' && event.phase === 'staging' && event.component === 'java')
            throw callbackError;
        },
        download: async (url, options) => {
          if (url === data.client.url) {
            options.signal?.addEventListener('abort', () => aborted.resolve(), { once: true });
            clientStarted.resolve();
            await release.promise; // Deliberately ignore cancellation until explicitly drained.
          }
          if (url === data.library.url) {
            await clientStarted.promise;
            if (kind === 'cancel') controller.abort();
            if (kind === 'integrity') return Buffer.from('corrupt');
          }
          // This adapter also ignores an already-aborted signal.
          return data.downloader(url, { maxBytes: options.maxBytes });
        },
      });
      const outcome = pending.catch((error: unknown) => {
        settled = true;
        return error;
      });
      await aborted.promise;
      expect(settled).toBe(false);
      expect(await readdir(path)).toContain('.torchlauncher-install-lock');
      expect(await readdir(path)).toContain('.torchlauncher-server-lock');
      expect(await readdir(join(path, '.torchlauncher-install-lock', 'staging'))).toContain(
        'runtime',
      );
      expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('previous');
      await expect(
        installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
      ).rejects.toThrow('in use');
      const calls = progress.mock.calls.length;
      release.resolve();
      const error = await outcome;
      if (kind === 'integrity')
        expect(error).toEqual(
          expect.objectContaining({ message: expect.stringContaining('integrity mismatch') }),
        );
      else if (kind === 'cancel') expect(error).toBe(controller.signal.reason);
      else expect(error).toBe(callbackError);
      expect(progress).toHaveBeenCalledTimes(calls);
      expect(await readFile(join(path, 'versions/1.21.1/1.21.1.jar'), 'utf8')).toBe('previous');
      expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
      expect(await readdir(path)).not.toContain('.torchlauncher-server-lock');
      expect(data.requests).not.toContain(data.asset.url);
    },
  );

  it.each(['planning', 'checking', 'downloading', 'publishing'] as const)(
    'cleans up when the %s activity callback throws',
    async (phase) => {
      const data = fixture();
      const path = await root();
      const failure = new Error('activity failed');
      await expect(
        installMinecraft({
          root: path,
          platform: data.platform,
          download: data.downloader,
          onActivity: (event) => {
            if (event.phase === phase) throw failure;
          },
        }),
      ).rejects.toBe(failure);
      expect(await readdir(path)).not.toContain('.torchlauncher-install-lock');
      expect(await readdir(path)).not.toContain('.torchlauncher-server-lock');
      await expect(readFile(join(path, 'versions/1.21.1/1.21.1.jar'))).rejects.toThrow();
    },
  );

  it.each([0, 17, 1.5, Number.NaN])(
    'rejects invalid concurrency %s before acquiring locks',
    async (concurrency) => {
      const data = fixture();
      const path = await root();
      await expect(
        installMinecraft({
          root: path,
          platform: data.platform,
          download: data.downloader,
          concurrency,
        }),
      ).rejects.toThrow('concurrency');
      expect(await readdir(path)).toEqual([]);
    },
  );

  it('installs safe relative Java license links when the host permits symlinks', async (context) => {
    const path = await root();
    const probeTarget = join(path, 'probe-target');
    const probeLink = join(path, 'probe-link');
    await writeFile(probeTarget, 'probe');
    await symlinkOrSkip(context, probeTarget, probeLink, 'file');
    const data = fixture(undefined, true);
    await installMinecraft({ root: path, platform: data.platform, download: data.downloader });
    expect(
      await readlink(
        join(path, 'runtime/java-runtime-delta', runtimePlatform(data.platform), 'legal/COPY'),
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
  it('rejects symlinked parents and preserves files outside the root', async (context) => {
    const data = fixture();
    const path = await root();
    const outside = await root();
    await symlinkOrSkip(context, outside, join(path, 'libraries'), 'dir');
    await expect(
      installMinecraft({ root: path, platform: data.platform, download: data.downloader }),
    ).rejects.toThrow('Unsafe installation directory');
    expect(await readdir(outside)).toEqual([]);
  });
  it('rejects a symlinked root', async (context) => {
    const data = fixture();
    const parent = await root();
    const outside = await root();
    await symlinkOrSkip(context, outside, join(parent, 'server'), 'dir');
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
      if (String(to).endsWith('common.jar') || String(from).includes(`${sep}backups${sep}`))
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
