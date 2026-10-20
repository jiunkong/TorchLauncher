/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Test literal Mojang placeholders. */
import { describe, expect, it } from 'vitest';
import realVersion from './fixtures/1.21.1.json';
import type { Installation } from './installer';
import { buildLaunchCommand, type LaunchAuth } from './launch';
import { type Platform, parseVersion } from './metadata';

const auth: LaunchAuth = {
  accessToken: 'test-token-never-real',
  expiresAt: 2000,
  profile: { id: '1234567890abcdef1234567890abcdef', name: 'TestPlayer' },
  userType: 'msa',
  clientId: 'public-client-id',
  xuid: '12345',
};
function installation(
  platform: Platform = { os: 'linux', arch: 'x64', version: '6.1' },
): Installation {
  return {
    root: '/server/game with spaces',
    platform,
    version: parseVersion(realVersion),
    javaPath: '/server/runtime/bin/java',
    classpath: ['/server/lib one.jar', '/server/client.jar'],
    nativesDirectory: '/server/natives',
    assetsDirectory: '/server/assets',
    loggingPath: '/server/assets/log_configs/client.xml',
  };
}
function command(
  overrides: Parameters<typeof buildLaunchCommand>[1] = {
    auth,
    launcherVersion: '0.1.0',
    now: 1000,
  },
) {
  return buildLaunchCommand(installation(), overrides);
}
describe('Minecraft launch command', () => {
  it('assembles published 1.21.1 arguments with an external account and no shell quoting', () => {
    const result = command();
    expect(result.shell).toBe(false);
    expect(result.executable).toBe('/server/runtime/bin/java');
    expect(result.args).toContain('/server/game with spaces');
    expect(result.args).toContain('/server/lib one.jar:/server/client.jar');
    expect(result.args).toContain(
      '-Dlog4j.configurationFile=/server/assets/log_configs/client.xml',
    );
    expect(result.args).toContain('net.minecraft.client.main.Main');
    expect(result.args).toContain(auth.accessToken);
    expect(result.args).not.toContain('--demo');
    expect(result.args).not.toContain('--width');
    expect(result.args).not.toContain('--quickPlayMultiplayer');
    expect(result.args.join(' ')).not.toMatch(/\$\{/);
    for (const privateValue of [auth.accessToken, auth.profile.id, auth.profile.name, auth.xuid]) {
      expect(result.redactedArgs.join(' ')).not.toContain(privateValue);
    }
  });
  it('uses target OS classpath separator and macOS JVM rules', () => {
    for (const os of ['windows', 'osx', 'linux'] as const) {
      const result = buildLaunchCommand(installation({ os, arch: 'x64', version: '10' }), {
        auth,
        launcherVersion: '0.1.0',
        now: 1000,
      });
      expect(result.args).toContain(
        os === 'windows'
          ? '/server/lib one.jar;/server/client.jar'
          : '/server/lib one.jar:/server/client.jar',
      );
      expect(result.args.includes('-XstartOnFirstThread')).toBe(os === 'osx');
    }
  });
  it('selects custom resolution and multiplayer Quick Play', () => {
    const result = command({
      auth,
      now: 1000,
      launcherVersion: '0.1.0',
      maxMemoryMiB: 4096,
      resolution: { width: 1280, height: 720 },
      quickPlayServer: 'play.example:25565',
    });
    expect(result.args).toContain('-Xmx4096M');
    expect(
      result.args.slice(result.args.indexOf('--width'), result.args.indexOf('--width') + 4),
    ).toEqual(['--width', '1280', '--height', '720']);
    expect(result.args).toContain('--quickPlayPath');
    expect(result.args.slice(-2)).toEqual(['--quickPlayMultiplayer', 'play.example:25565']);
  });
  it('accepts missing optional xuid without inventing an Xbox identity', () => {
    const { xuid: _, ...withoutXuid } = auth;
    const result = command({ auth: withoutXuid, now: 1000, launcherVersion: '0.1.0' });
    expect(result.args[result.args.indexOf('--xuid') + 1]).toBe('');
  });
  it.each([0, 2000, Number.NaN])('rejects expired or invalid token lifetime %s', (expiresAt) => {
    expect(() =>
      command({ auth: { ...auth, expiresAt }, now: 2000, launcherVersion: '0.1.0' }),
    ).toThrow('current Minecraft access token');
  });
  it('rejects unknown placeholders rather than launching unresolved arguments', () => {
    const installed = installation();
    installed.version.arguments.game.push('${toString}');
    expect(() =>
      buildLaunchCommand(installed, { auth, now: 1000, launcherVersion: '0.1.0' }),
    ).toThrow('Unsupported launch placeholder');
  });
  it('rejects NUL arguments, invalid identity, memory and Quick Play inputs', () => {
    expect(() =>
      command({
        auth: { ...auth, accessToken: 'token\0bad' },
        now: 1000,
        launcherVersion: '0.1.0',
      }),
    ).toThrow();
    expect(() =>
      command({
        auth: { ...auth, profile: { ...auth.profile, id: '../bad' } },
        now: 1000,
        launcherVersion: '0.1.0',
      }),
    ).toThrow('identity');
    expect(() => command({ auth, now: 1000, launcherVersion: '0.1.0', maxMemoryMiB: -1 })).toThrow(
      'memory',
    );
    expect(() =>
      command({ auth, now: 1000, launcherVersion: '0.1.0', resolution: { width: 0, height: 1 } }),
    ).toThrow('resolution');
    expect(() =>
      command({ auth, now: 1000, launcherVersion: '0.1.0', quickPlayServer: 'bad\0server' }),
    ).toThrow('Quick Play');
  });
});
