/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Unresolved placeholder assertions. */
import { basename, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import realVersion from '../minecraft/fixtures/1.21.1.json';
import type { Installation } from '../minecraft/installer';
import { buildLaunchCommand } from '../minecraft/launch';
import { type Platform, parseVersion } from '../minecraft/metadata';
import fabricProfile from './fixtures/fabric-0.16.14-profile.json';
import fabric0195Profile from './fixtures/fabric-0.19.5-profile.json';
import neoforgeProfile from './fixtures/neoforge-21.1.264-profile.json';
import { type LoaderSelection, loaderInstallation, maven } from './profile';

const auth = {
  accessToken: 'unit-only-token',
  expiresAt: 2000,
  profile: { id: '1'.repeat(32), name: 'UnitUser' },
  userType: 'msa' as const,
  clientId: 'public-client',
};
// Host path semantics; the target OS selects rules and the classpath separator.
const root = join('/', 'games', 'server');
const platforms: { platform: Platform }[] = [
  { platform: { os: 'linux', arch: 'x64', version: '6' } },
  { platform: { os: 'windows', arch: 'x64', version: '10.0' } },
];
function assembled(platform: Platform, selection: LoaderSelection, profile: unknown) {
  const base: Installation = {
    root,
    platform,
    version: parseVersion(realVersion),
    javaPath: join(root, 'runtime', 'java'),
    classpath: [],
    nativesDirectory: join(root, 'natives'),
    assetsDirectory: join(root, 'assets'),
  };
  const tree = join(root, '.torchlauncher-loaders', `${selection.kind}-${selection.version}`);
  const installation = loaderInstallation(base, selection, profile, tree);
  const { args } = buildLaunchCommand(installation, {
    auth,
    launcherVersion: 'test',
    now: 1000,
    quickPlayServer: 'localhost:25565',
  });
  const separator = platform.os === 'windows' ? ';' : ':';
  const after = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? [] : (args[index + 1] ?? '').split(separator);
  };
  const ignoreArg = args.find((arg) => arg.startsWith('-DignoreList='));
  return {
    args,
    installation,
    classpath: after('-cp'),
    modulePath: after('-p'),
    ignoreList: ignoreArg ? ignoreArg.slice('-DignoreList='.length).split(',') : undefined,
    vanillaJar: join(root, 'versions', '1.21.1', '1.21.1.jar'),
  };
}
describe('assembled loader JVM arguments', () => {
  it.each(platforms)(
    'NeoForge on $platform.os ignores the vanilla client jar so it never becomes a module',
    ({ platform }) => {
      const result = assembled(
        platform,
        { kind: 'neoforge', version: '21.1.264' },
        neoforgeProfile,
      );
      expect(result.args.join('\n')).not.toContain('${');
      expect(result.ignoreList).toBeDefined();
      const ignores = result.ignoreList ?? [];
      // BootstrapLauncher 2.0.2 skips a legacy classpath entry when its file name starts with an entry.
      const ignored = (entry: string) =>
        ignores.some((prefix) => prefix && basename(entry).startsWith(prefix));
      const vanilla = [...result.classpath, ...result.modulePath].filter(
        (entry) => entry === result.vanillaJar,
      );
      expect(vanilla).toHaveLength(1);
      for (const entry of vanilla) expect(ignored(entry)).toBe(true);
      expect(ignores).toContain('client-extra');
      // Module-path jars must equal their classpath entries; nothing else is ignored by accident.
      const classpath = new Set(result.classpath.map((entry) => normalize(entry)));
      for (const entry of result.modulePath) expect(classpath.has(normalize(entry))).toBe(true);
      expect(result.classpath.filter(ignored)).toEqual([result.vanillaJar]);
      expect(new Set(result.classpath).size).toBe(result.classpath.length);
      // The game-facing version name keeps the official inherited-profile contract.
      expect(result.args[result.args.indexOf('--version') + 1]).toBe('neoforge-21.1.264');
      expect(result.args[result.args.indexOf('--launchTarget') + 1]).toBe('forgeclient');
    },
  );
  it.each(platforms)(
    'Fabric on $platform.os keeps one vanilla jar and one version per Maven module',
    ({ platform }) => {
      const result = assembled(platform, { kind: 'fabric', version: '0.16.14' }, fabricProfile);
      expect(result.args.join('\n')).not.toContain('${');
      expect(result.ignoreList).toBeUndefined();
      expect(result.modulePath).toEqual([]);
      expect(result.classpath.filter((entry) => entry === result.vanillaJar)).toHaveLength(1);
      expect(new Set(result.classpath).size).toBe(result.classpath.length);
      const keys = result.installation.version.libraries.map(
        (library) => maven(library.name).key + (library.rules ? JSON.stringify(library.rules) : ''),
      );
      expect(new Set(keys).size).toBe(keys.length);
      const asm = result.classpath.filter((entry) => /^asm-9\.\d+\.jar$/.test(basename(entry)));
      expect(asm.map((entry) => basename(entry))).toEqual(['asm-9.8.jar']);
      expect(result.args[result.args.indexOf('--version') + 1]).toBe(
        'fabric-loader-0.16.14-1.21.1',
      );
      expect(result.args).toContain('net.fabricmc.loader.impl.launch.knot.KnotClient');
    },
  );
  it.each(platforms)(
    'Fabric 0.19.5 on $platform.os assembles a single-jar Knot launch for the Fabric server version',
    ({ platform }) => {
      const result = assembled(platform, { kind: 'fabric', version: '0.19.5' }, fabric0195Profile);
      expect(result.args.join('\n')).not.toContain('${');
      expect(result.ignoreList).toBeUndefined();
      expect(result.modulePath).toEqual([]);
      expect(result.classpath.filter((entry) => entry === result.vanillaJar)).toHaveLength(1);
      expect(result.classpath.filter((entry) => basename(entry) === '1.21.1.jar')).toHaveLength(1);
      expect(new Set(result.classpath).size).toBe(result.classpath.length);
      const keys = result.installation.version.libraries.map(
        (library) => maven(library.name).key + (library.rules ? JSON.stringify(library.rules) : ''),
      );
      expect(new Set(keys).size).toBe(keys.length);
      expect(result.classpath.some((entry) => basename(entry) === 'fabric-loader-0.19.5.jar')).toBe(
        true,
      );
      expect(
        result.classpath.some((entry) => basename(entry) === 'fabric-loader-0.16.14.jar'),
      ).toBe(false);
      expect(result.args[result.args.indexOf('--version') + 1]).toBe('fabric-loader-0.19.5-1.21.1');
      const main = result.args.indexOf('net.fabricmc.loader.impl.launch.knot.KnotClient');
      expect(main).toBeGreaterThan(result.args.indexOf('-cp'));
      expect(result.args).toContain('-DFabricMcEmu= net.minecraft.client.main.Main ');
    },
  );
  it('leaves vanilla launches on the base version name', () => {
    const installation: Installation = {
      root,
      platform: { os: 'linux', arch: 'x64', version: '6' },
      version: parseVersion(realVersion),
      javaPath: join(root, 'java'),
      classpath: [join(root, 'versions', '1.21.1', '1.21.1.jar')],
      nativesDirectory: root,
      assetsDirectory: root,
    };
    const { args } = buildLaunchCommand(installation, { auth, launcherVersion: 'test', now: 1000 });
    expect(args[args.indexOf('--version') + 1]).toBe('1.21.1');
    expect(args.some((arg) => arg.startsWith('-DignoreList='))).toBe(false);
  });
});
