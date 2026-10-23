import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildSettingsPolicy,
  classifyOptionKey,
  type PolicySelection,
  parseOptionsEntries,
  parsePropertiesEntries,
  parseSettingsPolicy,
  SETTINGS_LIMITS,
  SettingsError,
  selectionFromPolicy,
  serializeSettingsPolicy,
  shaderSelectionToConfigFiles,
  sortSettingEntries,
} from './index.js';

const fixture = fileURLToPath(new URL('./fixtures/options-1.21.1.txt', import.meta.url));

describe('options entry parsing', () => {
  it('classifies the real 1.21.1 file', async () => {
    const entries = parseOptionsEntries(new Uint8Array(await readFile(fixture)));
    const by = (key: string) => entries.find((e) => e.key === key);
    expect(by('key_key.jump')).toMatchObject({
      kind: 'keybind',
      group: 'movement',
      valueType: 'text',
    });
    expect(by('key_key.hotbar.3')).toMatchObject({ kind: 'keybind', group: 'inventory' });
    expect(by('key_key.advancements')).toMatchObject({ kind: 'keybind', group: 'miscellaneous' });
    expect(by('renderDistance')).toMatchObject({
      kind: 'other',
      group: 'video',
      valueType: 'number',
    });
    expect(by('soundCategory_music')).toMatchObject({ group: 'sound' });
    expect(by('ao')).toMatchObject({ valueType: 'boolean' });
    expect(by('version')).toMatchObject({ reserved: true });
    expect(by('resourcePacks')).toMatchObject({ reserved: true, valueType: 'json' });
    // Every vanilla keybind in the file is recognised; none is mistaken for a mod keybind.
    expect(entries.filter((e) => e.kind === 'mod-keybind')).toEqual([]);
    expect(entries.filter((e) => e.kind === 'keybind').length).toBeGreaterThan(20);
  });

  it('detects mod keybinds and groups them by mod', () => {
    const entries = parseOptionsEntries(
      'key_key.jump:key.keyboard.space\nkey_iris.keybind.reload:key.keyboard.r\nkey_key.examplemod.open:key.keyboard.o\nkey_weird:key.keyboard.x\n',
    );
    expect(entries.map((e) => [e.key, e.kind, e.group])).toEqual([
      ['key_key.jump', 'keybind', 'movement'],
      ['key_iris.keybind.reload', 'mod-keybind', 'iris'],
      ['key_key.examplemod.open', 'mod-keybind', 'examplemod'],
      ['key_weird', 'mod-keybind', 'weird'],
    ]);
    expect(classifyOptionKey('key_')).toMatchObject({ kind: 'mod-keybind', group: 'unknown' });
  });

  it('sorts deterministically by kind, vanilla category order and key', () => {
    const entries = parseOptionsEntries(
      'zoom:1\nkey_mod.b:k\nkey_key.chat:k\nkey_key.jump:k\nkey_mod.a:k\nkey_key.attack:k\nao:true\n',
    );
    expect(sortSettingEntries(entries).map((e) => e.key)).toEqual([
      'key_key.jump',
      'key_key.attack',
      'key_key.chat',
      'key_mod.a',
      'key_mod.b',
      'zoom',
      'ao',
    ]);
  });

  it('preserves values with colons and accepts BOM, CRLF and comment lines', () => {
    const entries = parseOptionsEntries('﻿lang:en_us\r\n# note\r\nlastServer:a:25565\r\n');
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['lang', 'en_us'],
      ['lastServer', 'a:25565'],
    ]);
  });

  it('rejects malformed input like the launcher does', () => {
    expect(() => parseOptionsEntries('a:1\na:2\n')).toThrow(SettingsError);
    expect(() => parseOptionsEntries(new Uint8Array([0xff, 0xfe]))).toThrow(SettingsError);
    expect(() => parseOptionsEntries('a:1\0')).toThrow(SettingsError);
    expect(() => parseOptionsEntries('a'.repeat(SETTINGS_LIMITS.optionsBytes + 1))).toThrow(
      SettingsError,
    );
  });

  it('parses properties files', () => {
    const entries = parsePropertiesEntries(
      '#Iris\nenableShaders=true\nshaderPack=BSL v8.zip\nn=3\n',
    );
    expect(entries.map((e) => [e.key, e.value, e.valueType])).toEqual([
      ['enableShaders', 'true', 'boolean'],
      ['shaderPack', 'BSL v8.zip', 'text'],
      ['n', '3', 'number'],
    ]);
    expect(() => parsePropertiesEntries('a=1\na=2\n')).toThrow(SettingsError);
    expect(() => parsePropertiesEntries('a:1\n')).toThrow(SettingsError);
  });
});

describe('policy building', () => {
  const selection: PolicySelection = {
    options: [
      { key: 'renderDistance', state: 'required', value: '12' },
      { key: 'gamma', state: 'initial', value: '1.0' },
      { key: 'fov', state: 'unset', value: 'ignored' },
      { key: 'ao', state: 'initial', value: 'true' },
    ],
    resourcePacks: { required: ['file/b.zip', 'file/a.zip'], initial: ['vanilla'] },
  };

  it('builds a version 1 policy deterministically, independent of input order', () => {
    const built = buildSettingsPolicy(selection);
    expect(built.policy.version).toBe(1);
    expect(built.json).toBe(`{
  "version": 1,
  "file": "options.txt",
  "required": {
    "renderDistance": "12"
  },
  "initial": {
    "ao": "true",
    "gamma": "1.0"
  },
  "resourcePacks": {
    "required": [
      "file/b.zip",
      "file/a.zip"
    ],
    "initial": [
      "vanilla"
    ]
  }
}
`);
    const reversed = buildSettingsPolicy({
      ...selection,
      options: [...(selection.options ?? [])].reverse(),
    });
    expect(reversed.json).toBe(built.json);
    expect(new TextDecoder().decode(built.bytes)).toBe(built.json);
    // Idempotent: serialize(parse(json)) is the same text.
    expect(serializeSettingsPolicy(parseSettingsPolicy(built.bytes)).json).toBe(built.json);
  });

  it('builds the empty policy', () => {
    expect(buildSettingsPolicy({}).json).toBe('{\n  "version": 1,\n  "file": "options.txt"\n}\n');
  });

  it('emits version 2 for shader settings and round-trips to selections', () => {
    const configFiles = shaderSelectionToConfigFiles({
      enabled: { state: 'required', value: true },
      pack: { state: 'initial', value: 'BSL_v8.zip' },
      packOptions: [
        {
          pack: 'BSL_v8.zip',
          items: [
            { key: 'SHADOW_RES', state: 'initial', value: '2048' },
            { key: 'SKIP', state: 'unset', value: '' },
          ],
        },
        { pack: 'Empty.zip', items: [{ key: 'X', state: 'unset', value: '1' }] },
      ],
    });
    const built = buildSettingsPolicy({ ...selection, configFiles });
    expect(built.policy.version).toBe(2);
    expect(JSON.parse(built.json).configFiles).toEqual({
      'config/iris.properties': {
        required: { enableShaders: 'true' },
        initial: { shaderPack: 'BSL_v8.zip' },
      },
      'shaderpacks/BSL_v8.zip.txt': { initial: { SHADOW_RES: '2048' } },
    });
    const back = selectionFromPolicy(built.policy);
    expect(buildSettingsPolicy(back).json).toBe(built.json);
  });

  it('drops unset-only config files and falls back to version 1', () => {
    const built = buildSettingsPolicy({
      configFiles: [
        { path: 'config/iris.properties', items: [{ key: 'a', state: 'unset', value: '' }] },
      ],
    });
    expect(built.policy.version).toBe(1);
    expect(built.policy.configFiles).toEqual([]);
  });

  const bad: [string, PolicySelection][] = [
    [
      'duplicate key',
      {
        options: [
          { key: 'a', state: 'initial', value: '1' },
          { key: 'a', state: 'required', value: '1' },
        ],
      },
    ],
    ['bad state', { options: [{ key: 'a', state: 'maybe' as never, value: '1' }] }],
    ['bad key', { options: [{ key: 'a b', state: 'required', value: '1' }] }],
    ['resourcePacks key', { options: [{ key: 'resourcePacks', state: 'required', value: '[]' }] }],
    ['version key', { options: [{ key: 'version', state: 'required', value: '1' }] }],
    ['newline', { options: [{ key: 'a', state: 'required', value: 'x\ny:1' }] }],
    ['numeric keycode', { options: [{ key: 'key_key.jump', state: 'required', value: '57' }] }],
    ['duplicate pack', { resourcePacks: { required: ['a', 'a'] } }],
    ['bad file pack', { resourcePacks: { required: ['file/../x'] } }],
    [
      'traversal',
      {
        configFiles: [
          { path: 'config/../x.txt', items: [{ key: 'a', state: 'required', value: '1' }] },
        ],
      },
    ],
    [
      'options path',
      {
        configFiles: [
          { path: 'options.txt', items: [{ key: 'a', state: 'required', value: '1' }] },
        ],
      },
    ],
    [
      'duplicate file',
      {
        configFiles: [
          { path: 'config/a.txt', items: [] },
          { path: 'config/a.txt', items: [] },
        ],
      },
    ],
    [
      'non-ascii config',
      {
        configFiles: [
          { path: 'config/a.txt', items: [{ key: 'a', state: 'required', value: 'é' }] },
        ],
      },
    ],
  ];
  it.each(bad)('rejects %s', (_name, input) => {
    expect(() => buildSettingsPolicy(input)).toThrow(SettingsError);
  });

  it('rejects an unknown Minecraft version and enforces limits', () => {
    expect(() => buildSettingsPolicy({ minecraftVersion: '1.7.10' })).toThrow(SettingsError);
    const options = Array.from({ length: SETTINGS_LIMITS.keysPerMap + 1 }, (_, i) => ({
      key: `k${i}`,
      state: 'required' as const,
      value: '1',
    }));
    expect(() => buildSettingsPolicy({ options })).toThrow(SettingsError);
    const value = 'v'.repeat(SETTINGS_LIMITS.valueLength);
    const big = Array.from({ length: 40 }, (_, i) => ({
      key: `k${i}`,
      state: 'required' as const,
      value,
    }));
    expect(() => buildSettingsPolicy({ options: big })).toThrow(SettingsError);
  });

  it('accepts the oculus path and custom config paths', () => {
    const built = buildSettingsPolicy({
      configFiles: shaderSelectionToConfigFiles({
        configPath: 'config/oculus.properties',
        enabled: { state: 'initial', value: false },
      }),
    });
    expect(built.policy.configFiles[0]?.path).toBe('config/oculus.properties');
  });
});
