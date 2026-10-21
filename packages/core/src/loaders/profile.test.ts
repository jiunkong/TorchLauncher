/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Literal Mojang argument placeholders. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import realVersion from '../minecraft/fixtures/1.21.1.json';
import type { Installation } from '../minecraft/installer';
import { buildLaunchCommand } from '../minecraft/launch';
import { parseVersion } from '../minecraft/metadata';
import { installLoader } from './installer';
import { inspectProfile, loaderInstallation, maven } from './profile';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function base(): Promise<Installation> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-loader-test-'));
  roots.push(root);
  return {
    root,
    platform: { os: 'linux', arch: 'x64', version: '6' },
    version: parseVersion(realVersion),
    classpath: [],
    javaPath: process.execPath,
    nativesDirectory: root,
    assetsDirectory: root,
  };
}
const selection = { kind: 'fabric' as const, version: '0.16.14' };
const artifact = Buffer.from('verified-library');
const sha1 = createHash('sha1').update(artifact).digest('hex');
function profile() {
  return {
    id: 'fabric-loader-0.16.14-1.21.1',
    inheritsFrom: '1.21.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    arguments: { game: [], jvm: [] },
    libraries: [
      {
        name: 'org.ow2.asm:asm:9.8',
        downloads: {
          artifact: {
            path: maven('org.ow2.asm:asm:9.8').path,
            url: 'https://fixture.test/library.jar',
            sha1,
            size: artifact.length,
          },
        },
      },
    ],
  };
}
const download = async (url: string) =>
  url.includes('/profile/json') ? Buffer.from(JSON.stringify(profile())) : artifact;
describe('loader profile integrity and staging', () => {
  it('overrides one Maven module deliberately and preserves native classifier variants', async () => {
    const installed = await base();
    const merged = loaderInstallation(
      installed,
      selection,
      profile(),
      join(installed.root, 'private'),
    );
    expect(merged.loader).toEqual({ ...selection, minecraftVersion: '1.21.1' });
    expect(
      merged.version.libraries
        .filter((library) => library.name.startsWith('org.ow2.asm:asm:'))
        .map((library) => library.name),
    ).toEqual(['org.ow2.asm:asm:9.8']);
    expect(merged.version.libraries.some((library) => library.name.includes('natives-linux'))).toBe(
      true,
    );
  });
  it('rejects incompatible inheritance, duplicate module versions, unsafe Maven paths and sources', async () => {
    const installed = await base();
    expect(() =>
      inspectProfile({ ...profile(), inheritsFrom: '1.20.1' }, installed, selection),
    ).toThrow();
    expect(() =>
      inspectProfile(
        { ...profile(), libraries: [...profile().libraries, ...profile().libraries] },
        installed,
        selection,
      ),
    ).toThrow();
    expect(() => maven('bad:../escape:1')).toThrow();
    const changed = profile();
    const first = changed.libraries[0];
    if (!first) throw new Error('Missing fixture');
    first.downloads.artifact.url = 'http://fixture.test/library.jar';
    expect(() => inspectProfile(changed, installed, selection)).toThrow();
  });
  it('publishes verified digest/lengths and detects cache corruption', async () => {
    const installed = await base();
    const result = await installLoader(installed, { selection, download });
    const own = result.version.libraries.find((library) => library.name === 'org.ow2.asm:asm:9.8');
    expect(own?.artifact.sha1).toBe(sha1);
    expect(own?.artifact.size).toBe(artifact.length);
    await installLoader(installed, {
      selection,
      download: async () => {
        throw new Error('cache should avoid download');
      },
    });
    const target = join(result.libraryDirectory as string, maven('org.ow2.asm:asm:9.8').path);
    await writeFile(target, 'corrupt');
    await expect(installLoader(installed, { selection, download })).rejects.toThrow(
      'cache integrity',
    );
  });
  it('bounds receipt/profile files before reading and preserves the prior tree on refusal', async () => {
    const installed = await base();
    const result = await installLoader(installed, { selection, download });
    const directory = join(result.libraryDirectory as string, '..');
    const receipt = join(directory, 'receipt.json');
    const saved = await readFile(receipt);
    await truncate(receipt, 17 * 1024 * 1024);
    await expect(installLoader(installed, { selection, download })).rejects.toThrow('oversized');
    await writeFile(receipt, saved);
    await truncate(join(directory, 'profile.json'), 5 * 1024 * 1024);
    await expect(installLoader(installed, { selection, download })).rejects.toThrow('oversized');
    expect(
      await readFile(join(result.libraryDirectory as string, maven('org.ow2.asm:asm:9.8').path)),
    ).toEqual(artifact);
  });
  it('does not publish on corrupt download or cancellation', async () => {
    const installed = await base();
    await expect(
      installLoader(installed, {
        selection,
        download: async (url) =>
          url.includes('/profile/json')
            ? Buffer.from(JSON.stringify(profile()))
            : Buffer.from('corrupt'),
      }),
    ).rejects.toThrow('integrity');
    await expect(
      installLoader(installed, { selection, download, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    const { readdir } = await import('node:fs/promises');
    expect(
      (await readdir(join(installed.root, '.torchlauncher-loaders'))).filter(
        (name) => !name.startsWith('.'),
      ),
    ).toEqual([]);
  });
  it('resolves loader module placeholders with the target classpath separator', async () => {
    const installed = await base();
    const child = profile();
    child.arguments.jvm.push(
      ...([
        '-p',
        '${library_directory}/module.jar${classpath_separator}${library_directory}/other.jar',
      ] as never[]),
    );
    const merged = loaderInstallation(installed, selection, child, join(installed.root, 'private'));
    const result = buildLaunchCommand(merged, {
      auth: {
        accessToken: 'fake-for-unit-only',
        expiresAt: Date.now() + 100000,
        profile: { id: '1'.repeat(32), name: 'UnitUser' },
        userType: 'msa',
        clientId: 'public',
      },
      launcherVersion: 'test',
    });
    expect(result.args.some((arg) => arg.includes('/module.jar:'))).toBe(true);
    expect(result.args.join(' ')).not.toContain('${');
  });
});
