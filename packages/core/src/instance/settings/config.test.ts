import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import {
  applySettingsPolicy,
  describeManagedSettings,
  parseSettingsPolicy,
  SETTINGS_LIMITS,
  SettingsError,
  type SyncOwnership,
  validConfigPath,
} from './index.js';
import { PropertiesDocument } from './properties.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function root(): Promise<string> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'torch-config-'));
  roots.push(dir);
  return dir;
}
async function policy(dir: string, value: unknown | string): Promise<void> {
  await mkdir(join(dir, 'torchlauncher'), { recursive: true });
  await writeFile(
    join(dir, 'torchlauncher/settings-policy.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}
const v2 = (configFiles: unknown, extra: object = {}) => ({
  version: 2,
  file: 'options.txt',
  ...extra,
  configFiles,
});
const IRIS = 'config/iris.properties';
const read = (dir: string, path: string) => readFile(join(dir, path), 'utf8');
const bytes = (text: string) => new TextEncoder().encode(text);
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SettingsError) return error.code;
    throw error;
  }
  return 'none';
}
const ownership = (files: SyncOwnership['files']): SyncOwnership => ({
  serverId: 's',
  deploymentId: 'd',
  initialized: true,
  files,
});
const hash = 'a'.repeat(64);

describe('policy version 2 parsing', () => {
  it('parses config files and keeps version 1 behavior unchanged', () => {
    const parsed = parseSettingsPolicy(
      bytes(
        JSON.stringify(
          v2({
            [IRIS]: { required: { enableShaders: 'true' }, initial: { shaderPack: 'BSL.zip' } },
            'shaderpacks/BSL.zip.txt': { format: 'properties', initial: { SHADOW: '2048' } },
          }),
        ),
      ),
    );
    expect(parsed.version).toBe(2);
    expect(parsed.configFiles.map((f) => f.path)).toEqual([IRIS, 'shaderpacks/BSL.zip.txt']);
    const v1 = parseSettingsPolicy(
      bytes('{"version":1,"file":"options.txt","required":{"a":"1"}}'),
    );
    expect(v1.version).toBe(1);
    expect(v1.configFiles).toEqual([]);
  });

  it('keeps configFiles an unknown field in version 1', () => {
    expect(() =>
      parseSettingsPolicy(
        bytes(JSON.stringify({ version: 1, file: 'options.txt', configFiles: {} })),
      ),
    ).toThrow(SettingsError);
  });

  const bad: [string, unknown][] = [
    ['traversal', { 'config/../options.txt': { required: { a: '1' } } }],
    ['absolute', { '/etc/passwd.txt': { required: { a: '1' } } }],
    ['backslash', { 'config\\a.properties': { required: { a: '1' } } }],
    ['outside roots', { 'mods/a.properties': { required: { a: '1' } } }],
    ['options.txt', { 'options.txt': { required: { a: '1' } } }],
    ['bad extension', { 'config/a.json': { required: { a: '1' } } }],
    ['deep shaderpacks', { 'shaderpacks/a/b.txt': { required: { a: '1' } } }],
    ['hidden segment', { 'config/.x/a.properties': { required: { a: '1' } } }],
    ['reserved name', { 'config/CON.properties': { required: { a: '1' } } }],
    ['case collision', { 'config/A.properties': {}, 'config/a.properties': {} }],
    ['unknown field', { [IRIS]: { required: {}, extra: 1 } }],
    ['bad format', { [IRIS]: { format: 'toml' } }],
    ['key conflict', { [IRIS]: { required: { a: '1' }, initial: { a: '2' } } }],
    ['bad key', { [IRIS]: { required: { 'a b': '1' } } }],
    ['non-ascii value', { [IRIS]: { required: { a: 'é' } } }],
    ['backslash value', { [IRIS]: { required: { a: 'x\\u0041' } } }],
    ['padded value', { [IRIS]: { required: { a: ' x' } } }],
    ['newline value', { [IRIS]: { required: { a: 'x\ny=1' } } }],
    ['non-string value', { [IRIS]: { required: { a: 1 } } }],
    ['not an object', [IRIS]],
  ];
  it.each(bad)('rejects config files: %s', (_name, value) => {
    expect(() => parseSettingsPolicy(bytes(JSON.stringify(v2(value))))).toThrow(SettingsError);
  });

  it('rejects duplicate config paths and too many files or keys', () => {
    expect(() =>
      parseSettingsPolicy(
        bytes(`{"version":2,"file":"options.txt","configFiles":{"${IRIS}":{},"${IRIS}":{}}}`),
      ),
    ).toThrow(SettingsError);
    const many = Object.fromEntries(
      Array.from({ length: SETTINGS_LIMITS.configFiles + 1 }, (_, i) => [
        `config/f${i}.properties`,
        {},
      ]),
    );
    expect(() => parseSettingsPolicy(bytes(JSON.stringify(v2(many))))).toThrow(SettingsError);
    const keys = Object.fromEntries(
      Array.from({ length: SETTINGS_LIMITS.keysPerMap + 1 }, (_, i) => [`k${i}`, '1']),
    );
    expect(() =>
      parseSettingsPolicy(bytes(JSON.stringify(v2({ [IRIS]: { required: keys } })))),
    ).toThrow(SettingsError);
  });

  it('validates paths', () => {
    expect(validConfigPath('config/iris.properties')).toBe(true);
    expect(validConfigPath('config/sub/dir/x.txt')).toBe(true);
    expect(validConfigPath('shaderpacks/BSL (v8) +x.zip.txt')).toBe(true);
    expect(validConfigPath('config/')).toBe(false);
    expect(validConfigPath('config//a.txt')).toBe(false);
    expect(validConfigPath('config/a.txt ')).toBe(false);
    expect(validConfigPath('config/a:b.txt')).toBe(false);
    expect(validConfigPath('.torchlauncher-user/settings.json')).toBe(false);
    expect(validConfigPath('torchlauncher/settings-policy.json')).toBe(false);
    expect(validConfigPath(`config/${'a'.repeat(SETTINGS_LIMITS.configSegmentLength)}.txt`)).toBe(
      false,
    );
  });

  it('describes managed config files', () => {
    const parsed = parseSettingsPolicy(
      bytes(JSON.stringify(v2({ [IRIS]: { required: { a: '1' }, initial: { b: '2' } } }))),
    );
    expect(describeManagedSettings(parsed).configFiles).toEqual([
      { path: IRIS, requiredKeys: ['a'], initialKeys: ['b'] },
    ]);
  });
});

describe('PropertiesDocument', () => {
  it('preserves comments, CRLF, BOM and order', () => {
    const src = '﻿#Iris\r\n!x\r\n\r\nenableShaders=false\r\nshaderPack=\r\n';
    const doc = PropertiesDocument.parse(bytes(src));
    expect(doc.get('shaderPack')).toBe('');
    expect(doc.set('enableShaders', 'true')).toBe(true);
    expect(doc.set('enableShaders', 'true')).toBe(false);
    doc.set('new', '1');
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(doc.serialize())).toBe(
      '﻿#Iris\r\n!x\r\n\r\nenableShaders=true\r\nshaderPack=\r\nnew=1\r\n',
    );
  });

  it('adds a newline when the last line is unterminated', () => {
    const doc = PropertiesDocument.parse(bytes('a=1'));
    doc.set('b', '2');
    expect(new TextDecoder().decode(doc.serialize())).toBe('a=1\nb=2\n');
  });

  const bad: [string, string | Uint8Array][] = [
    ['duplicate key', 'a=1\na=2\n'],
    ['no separator', 'a 1\n'],
    ['colon separator', 'a:1\n'],
    ['padded key', 'a =1\n'],
    ['indented key', ' a=1\n'],
    ['continuation', 'a=1\\\nb\n'],
    ['NUL', 'a=1\0\n'],
    ['invalid UTF-8', new Uint8Array([0x61, 0x3d, 0xff])],
    ['equals first', '=1\n'],
  ];
  it.each(bad)('rejects %s', (_name, input) => {
    const data = typeof input === 'string' ? bytes(input) : input;
    expect(() => PropertiesDocument.parse(data)).toThrow(SettingsError);
  });

  it('accepts an escaped trailing backslash and rejects oversize files', () => {
    expect(PropertiesDocument.parse(bytes('a=1\\\\\n')).get('a')).toBe('1\\\\');
    expect(() => PropertiesDocument.parse(new Uint8Array(SETTINGS_LIMITS.configBytes + 1))).toThrow(
      SettingsError,
    );
  });
});

describe('applying config files', () => {
  const shaders = v2({
    [IRIS]: { required: { enableShaders: 'true' }, initial: { shaderPack: 'BSL.zip' } },
    'shaderpacks/BSL.zip.txt': { initial: { SHADOW: '2048' }, required: { CLOUDS: 'false' } },
  });

  it('creates missing files and parent directories', async () => {
    const dir = await root();
    await policy(dir, shaders);
    const result = await applySettingsPolicy(dir);
    expect(result.status).toBe('applied');
    expect(await read(dir, IRIS)).toBe('enableShaders=true\nshaderPack=BSL.zip\n');
    expect(await read(dir, 'shaderpacks/BSL.zip.txt')).toBe('CLOUDS=false\nSHADOW=2048\n');
    expect(result.configFiles.map((f) => [f.path, f.created])).toEqual([
      [IRIS, true],
      ['shaderpacks/BSL.zip.txt', true],
    ]);
    expect(result.optionsCreated).toBe(false);
    expect(await readdir(dir)).not.toContain('options.txt');
  });

  it('enforces required, never overwrites user values for initial, and is idempotent', async () => {
    const dir = await root();
    await policy(dir, shaders);
    await mkdir(join(dir, 'config'));
    await writeFile(
      join(dir, IRIS),
      '#Iris Configuration\r\nenableShaders=false\r\nshaderPack=Other.zip\r\nextra=1\r\n',
    );
    const first = await applySettingsPolicy(dir);
    expect(await read(dir, IRIS)).toBe(
      '#Iris Configuration\r\nenableShaders=true\r\nshaderPack=Other.zip\r\nextra=1\r\n',
    );
    const iris = first.configFiles.find((f) => f.path === IRIS);
    expect(iris?.enforcedKeys).toEqual(['enableShaders']);
    expect(iris?.initialSkipped).toEqual([{ key: 'shaderPack', reason: 'user-value-present' }]);
    const state = JSON.parse(await read(dir, '.torchlauncher-user/settings.json'));
    expect(state.version).toBe(2);
    expect(state.initial.files['shaderpacks/BSL.zip.txt']).toEqual(['SHADOW']);
    // The user changes the initial item and a later run keeps it; required is restored.
    await writeFile(join(dir, IRIS), 'enableShaders=false\nshaderPack=Mine.zip\n');
    const again = await applySettingsPolicy(dir);
    expect(await read(dir, IRIS)).toBe('enableShaders=true\nshaderPack=Mine.zip\n');
    expect(again.configFiles[0]?.initialApplied).toEqual([]);
    const third = await applySettingsPolicy(dir);
    expect(third.status).toBe('unchanged');
    expect(third.configFiles.every((f) => !f.changed)).toBe(true);
  });

  it('does not restore an initial key the user deleted', async () => {
    const dir = await root();
    await policy(dir, shaders);
    await applySettingsPolicy(dir);
    await writeFile(join(dir, IRIS), 'enableShaders=true\n');
    await applySettingsPolicy(dir);
    expect(await read(dir, IRIS)).toBe('enableShaders=true\n');
  });

  it('treats a newly added file as its own first configuration and reports later keys as skipped', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { initial: { a: '1' } } }));
    await applySettingsPolicy(dir);
    await policy(
      dir,
      v2({
        [IRIS]: { initial: { a: '1', b: '2' } },
        'config/new.properties': { initial: { c: '3' } },
      }),
    );
    const result = await applySettingsPolicy(dir);
    expect(result.configFiles[0]?.initialSkipped).toEqual([
      { key: 'b', reason: 'already-configured' },
    ]);
    expect(await read(dir, IRIS)).toBe('a=1\n');
    expect(await read(dir, 'config/new.properties')).toBe('c=3\n');
  });

  it('applies options.txt and config files together', async () => {
    const dir = await root();
    await policy(
      dir,
      v2({ [IRIS]: { required: { x: '1' } } }, { required: { renderDistance: '8' } }),
    );
    const result = await applySettingsPolicy(dir);
    expect(result.enforcedKeys).toEqual(['renderDistance']);
    expect(await read(dir, 'options.txt')).toBe('renderDistance:8\n');
    expect(await read(dir, IRIS)).toBe('x=1\n');
  });

  it('keeps version 1 state files for version 1 policies', async () => {
    const dir = await root();
    await policy(dir, { version: 1, file: 'options.txt', initial: { a: '1' } });
    await applySettingsPolicy(dir);
    expect(JSON.parse(await read(dir, '.torchlauncher-user/settings.json'))).toEqual({
      version: 1,
      initial: { keys: ['a'], resourcePacks: false },
    });
  });

  it('reads old version 1 state when a policy later gains config files', async () => {
    const dir = await root();
    await policy(dir, { version: 1, file: 'options.txt', initial: { a: '1' } });
    await applySettingsPolicy(dir);
    await policy(dir, v2({ [IRIS]: { initial: { b: '2' } } }, { initial: { a: '1' } }));
    const result = await applySettingsPolicy(dir);
    expect(await read(dir, IRIS)).toBe('b=2\n');
    expect(result.initialSkipped).toEqual([]);
    const state = JSON.parse(await read(dir, '.torchlauncher-user/settings.json'));
    expect(state).toEqual({
      version: 2,
      initial: { keys: ['a'], resourcePacks: false, files: { [IRIS]: ['b'] } },
    });
  });

  it('rejects malformed config files without modifying anything', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }, { required: { b: '2' } }));
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, IRIS), 'a=1\na=2\n');
    expect(await code(applySettingsPolicy(dir))).toBe('invalid-config');
    expect(await readdir(dir)).not.toContain('options.txt');
    expect(await read(dir, IRIS)).toBe('a=1\na=2\n');
  });

  it('rejects an oversized config file', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, IRIS), Buffer.alloc(SETTINGS_LIMITS.configBytes + 1, 0x61));
    expect(await code(applySettingsPolicy(dir))).toBe('limit-exceeded');
  });

  it('refuses a directory, and a linked parent, at the config path', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    await mkdir(join(dir, IRIS), { recursive: true });
    expect(await code(applySettingsPolicy(dir))).not.toBe('none');
  });

  it('refuses a differently-cased existing directory', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    await mkdir(join(dir, 'Config'));
    expect(await code(applySettingsPolicy(dir))).not.toBe('none');
    expect(await readdir(join(dir, 'Config'))).toEqual([]);
  });

  it('is blocked by the maintenance lock', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    const lease = await acquireServerDataLock(dir, 'game');
    try {
      expect(await code(applySettingsPolicy(dir))).toBe('locked');
    } finally {
      await lease.release();
    }
    expect(await readdir(dir)).toEqual(['torchlauncher']);
  });

  it('leaves no temp file and no state after an interrupted write, then recovers', async () => {
    const dir = await root();
    await policy(dir, shaders);
    await expect(
      applySettingsPolicy(dir, {
        onBeforeCommit: (target) => {
          if (target.endsWith('BSL.zip.txt')) throw new Error('boom');
        },
      }),
    ).rejects.toMatchObject({ code: 'io-error' });
    expect(await readdir(join(dir, 'shaderpacks'))).toEqual([]);
    expect(await readdir(dir)).not.toContain('.torchlauncher-user');
    // The iris file was already committed: its initial key now reads as a user value.
    const result = await applySettingsPolicy(dir);
    expect(await read(dir, IRIS)).toBe('enableShaders=true\nshaderPack=BSL.zip\n');
    expect(await read(dir, 'shaderpacks/BSL.zip.txt')).toBe('CLOUDS=false\nSHADOW=2048\n');
    expect(result.configFiles[0]?.initialSkipped).toEqual([
      { key: 'shaderPack', reason: 'user-value-present' },
    ]);
  });

  it('detects a change between read and commit', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, IRIS), 'z=1\n');
    expect(
      await code(
        applySettingsPolicy(dir, {
          onBeforeCommit: async (target) => {
            await writeFile(target, 'z=2\n');
          },
        }),
      ),
    ).toBe('file-changed');
    expect(await read(dir, IRIS)).toBe('z=2\n');
  });

  it('rejects policies naming an always-synchronized config file', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    const owned = ownership([
      { path: 'Config/Iris.properties', policy: 'always', sha256: hash, length: 1 },
    ]);
    expect(await code(applySettingsPolicy(dir, { ownership: owned }))).toBe('config-owned-by-sync');
    expect(await readdir(dir)).toEqual(['torchlauncher']);
  });

  it('allows an initial-only synchronized config file', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { required: { a: '1' } } }));
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, IRIS), 'b=2\n');
    const owned = ownership([{ path: IRIS, policy: 'initial-only', sha256: hash, length: 4 }]);
    await applySettingsPolicy(dir, { ownership: owned });
    expect(await read(dir, IRIS)).toBe('b=2\na=1\n');
  });

  it('rejects a corrupt state file', async () => {
    const dir = await root();
    await policy(dir, v2({ [IRIS]: { initial: { a: '1' } } }));
    await mkdir(join(dir, '.torchlauncher-user'));
    await writeFile(
      join(dir, '.torchlauncher-user/settings.json'),
      JSON.stringify({
        version: 2,
        initial: { keys: [], resourcePacks: false, files: { '../x.txt': [] } },
      }),
    );
    expect(await code(applySettingsPolicy(dir))).toBe('invalid-state');
  });
});
