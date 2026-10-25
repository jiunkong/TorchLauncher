import { describe, expect, it } from 'vitest';
import { testPublicKey } from '../deployment/fixtures/signing.js';
import {
  parseServerBranding,
  parseServerConfig,
  parseServerIdentity,
  resolveGameMemory,
  SERVER_CONFIG_FILENAME,
} from './index.js';

const config = {
  format: 'torchlauncher-server',
  version: 1,
  signing: { algorithm: 'ed25519', publicKey: testPublicKey },
  serverId: '44444444-4444-4444-8444-444444444444',
  name: 'Server',
  address: 'localhost:25565',
  sourceUrl: 'https://example.org/server.torchpack',
};
describe('server config', () => {
  it('parses a portable config including local game addresses', () => {
    expect(parseServerConfig(config)).toEqual(config);
    expect(parseServerConfig({ ...config, address: '[::1]:25565' }).address).toBe('[::1]:25565');
    for (const sourceUrl of ['https://192.0.2.1/a', 'https://localhost/a', 'https://[::1]/a'])
      expect(parseServerConfig({ ...config, sourceUrl }).sourceUrl).toBe(sourceUrl);
    expect(SERVER_CONFIG_FILENAME).toBe('torchlauncher-server.json');
  });
  it('accepts an optional game and rejects malformed ones', () => {
    const game = { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } };
    expect(parseServerConfig({ ...config, game })).toEqual({ ...config, game });
    for (const bad of [
      null,
      [],
      {},
      { ...game, extra: 1 },
      { ...game, minecraftVersion: '' },
      { ...game, minecraftVersion: '../1' },
      { ...game, minecraftVersion: 'a'.repeat(65) },
      { ...game, loader: { kind: 'forge', version: '1' } },
      { ...game, loader: { kind: 'fabric', version: 'x y' } },
      { ...game, loader: { kind: 'fabric', version: '1', extra: 1 } },
      { ...game, loader: null },
    ])
      expect(() => parseServerConfig({ ...config, game: bad })).toThrow(
        'Invalid server configuration',
      );
  });
  it.each([
    null,
    { ...config, command: 'run' },
    { ...config, serverId: 'bad' },
    { ...config, name: '\nname' },
    { ...config, address: 'localhost:0' },
    { ...config, address: '../file:12' },
    ...['http://example.org/a', 'https://user:pass@example.org/a'].map((sourceUrl) => ({
      ...config,
      sourceUrl,
    })),
  ])('rejects unsafe or malformed configs', (input) => {
    expect(() => parseServerConfig(input)).toThrow('Invalid server configuration');
  });
});

describe('optional profile branding', () => {
  const asset = {
    path: 'branding/아이콘.png',
    sha256: 'a'.repeat(64),
    length: 100,
    mediaType: 'image/png',
  };
  it('preserves optional branding and snapshots sidecar metadata without filesystem access', () => {
    const input = { ...config, branding: { appName: '운영자 런처', icon: { ...asset } } };
    const parsed = parseServerConfig(input);
    expect(parsed.branding).toEqual(input.branding);
    input.branding.icon.path = 'changed.png';
    expect(parsed.branding?.icon?.path).toBe(asset.path);
    expect(parseServerConfig({ ...config, branding: {} }).branding).toEqual({});
    expect(
      parseServerConfig({
        ...config,
        branding: { background: { ...asset, mediaType: 'image/jpeg' } },
      }).branding?.background?.mediaType,
    ).toBe('image/jpeg');
  });
  it.each([
    null,
    { appName: '' },
    { appName: ' leading' },
    { appName: 'x'.repeat(41) },
    { appName: 'bad\u202ename' },
    { appName: '\ud800' },
    { icon: null },
    { icon: { ...asset, mediaType: 'image/jpeg' } },
    { icon: { ...asset, length: 1_048_577 } },
    { icon: { ...asset, length: 0 } },
    { icon: { ...asset, length: 1.5 } },
    { background: { ...asset, length: 8_388_609 } },
    { icon: { ...asset, sha256: 'A'.repeat(64) } },
    { icon: { ...asset, extra: true } },
    { appName: 'ok', extra: true },
    ...[
      '../icon.png',
      '/icon.png',
      'C:/icon.png',
      'branding\\icon.png',
      'NUL.png',
      '.torchlauncher/icon.png',
      'branding/e\u0301.png',
    ].map((path) => ({ icon: { ...asset, path } })),
  ])(
    'rejects structurally invalid branding while runtime file/decode failures remain separate',
    (branding) => {
      expect(() => parseServerConfig({ ...config, branding })).toThrow(
        'Invalid server configuration',
      );
    },
  );
});

describe('server config signing', () => {
  const publicKey = Buffer.alloc(32, 7).toString('base64url');
  it('requires a strict ed25519 signing block', () => {
    const signing = { algorithm: 'ed25519', publicKey };
    expect(parseServerConfig({ ...config, signing })).toEqual({ ...config, signing });
    const { signing: _signing, ...missing } = config;
    expect(() => parseServerConfig(missing)).toThrow('Invalid server configuration');
  });
  it.each([
    null,
    [],
    {},
    { algorithm: 'ed25519' },
    { publicKey },
    { algorithm: 'rsa', publicKey },
    { algorithm: 'Ed25519', publicKey },
    { algorithm: 'ed25519', publicKey, extra: 1 },
    { algorithm: 'ed25519', publicKey: 1 },
    { algorithm: 'ed25519', publicKey: '' },
    { algorithm: 'ed25519', publicKey: `${publicKey}=` },
    { algorithm: 'ed25519', publicKey: publicKey.slice(0, 42) },
    { algorithm: 'ed25519', publicKey: `${publicKey}A` },
    { algorithm: 'ed25519', publicKey: `${Buffer.alloc(32, 7).toString('base64')}x` },
    { algorithm: 'ed25519', publicKey: Buffer.alloc(33, 7).toString('base64url') },
    { algorithm: 'ed25519', publicKey: `${publicKey.slice(0, 42)}B` },
  ])('rejects malformed signing %j', (signing) => {
    expect(() => parseServerConfig({ ...config, signing })).toThrow('Invalid server configuration');
  });
});

describe('server metadata validation without publisher trust', () => {
  const { signing: _signing, ...identity } = config;
  it('validates only identity fields without manufacturing a signing key', () => {
    expect(parseServerIdentity(identity)).toEqual(identity);
    expect(() => parseServerIdentity(config)).toThrow();
    expect(() => parseServerConfig(identity)).toThrow();
    expect(() =>
      parseServerConfig(Object.assign(Object.create({ signing: config.signing }), identity)),
    ).toThrow();
    expect(parseServerBranding({ appName: 'Server Launcher' })).toEqual({
      appName: 'Server Launcher',
    });
  });
  it.each([
    'http://example.com/pack',
    'https://user:secret@example.com/pack',
    'https://example.com/pack#fragment',
    'https://example.com/pack bad',
    '',
  ])('rejects invalid metadata source %s', (sourceUrl) => {
    expect(() => parseServerIdentity({ ...identity, sourceUrl })).toThrow();
  });
  it('rejects extra metadata fields and invalid branding', () => {
    expect(() => parseServerIdentity({ ...identity, extra: true })).toThrow();
    expect(() => parseServerBranding({ appName: '' })).toThrow();
  });
});

describe('default game memory', () => {
  it('accepts an optional memory block with optional initial memory', () => {
    expect(parseServerConfig(config).memory).toBeUndefined();
    expect(parseServerConfig({ ...config, memory: { maxMiB: 4096 } }).memory).toEqual({
      maxMiB: 4096,
    });
    expect(
      parseServerConfig({ ...config, memory: { maxMiB: 4096, initialMiB: 4096 } }).memory,
    ).toEqual({ maxMiB: 4096, initialMiB: 4096 });
    expect(
      parseServerConfig({ ...config, memory: { initialMiB: 256, maxMiB: 512 } }).memory,
    ).toEqual({ maxMiB: 512, initialMiB: 256 });
    expect(parseServerConfig({ ...config, memory: { maxMiB: 65536 } }).memory?.maxMiB).toBe(65536);
  });
  it.each([
    null,
    [],
    'x',
    {},
    { initialMiB: 1024 },
    { maxMiB: 511 },
    { maxMiB: 65537 },
    { maxMiB: 2048.5 },
    { maxMiB: '2048' },
    { maxMiB: null },
    { maxMiB: 2048, extra: 1 },
    { maxMiB: 2048, initialMiB: 255 },
    { maxMiB: 2048, initialMiB: 2049 },
    { maxMiB: 2048, initialMiB: 1024.5 },
    { maxMiB: 2048, initialMiB: '1024' },
    { maxMiB: 2048, initialMiB: null },
    { maxMiB: 2048, initialMiB: undefined },
  ])('rejects invalid memory %j', (memory) => {
    expect(() => parseServerConfig({ ...config, memory })).toThrow('Invalid server configuration');
  });
  it('resolves player value, then server default, then built-in default', () => {
    const server = { maxMiB: 4096, initialMiB: 1024 };
    expect(resolveGameMemory({})).toEqual({ maxMemoryMiB: 2048 });
    expect(resolveGameMemory({}, { maxMiB: 3072 })).toEqual({ maxMemoryMiB: 3072 });
    expect(resolveGameMemory({}, server)).toEqual({ maxMemoryMiB: 4096, initialMemoryMiB: 1024 });
    expect(resolveGameMemory({ maxMemoryMiB: 8192 }, server)).toEqual({
      maxMemoryMiB: 8192,
      initialMemoryMiB: 1024,
    });
    expect(resolveGameMemory({ maxMemoryMiB: 8192, initialMemoryMiB: 2048 }, server)).toEqual({
      maxMemoryMiB: 8192,
      initialMemoryMiB: 2048,
    });
    // A player Xmx below the server Xms default drops the Xms instead of exceeding Xmx.
    expect(resolveGameMemory({ maxMemoryMiB: 512 }, server)).toEqual({ maxMemoryMiB: 512 });
    expect(resolveGameMemory({ maxMemoryMiB: 1024 }, server)).toEqual({
      maxMemoryMiB: 1024,
      initialMemoryMiB: 1024,
    });
    expect(resolveGameMemory({ initialMemoryMiB: 512 }, { maxMiB: 4096 })).toEqual({
      maxMemoryMiB: 4096,
      initialMemoryMiB: 512,
    });
  });
});
