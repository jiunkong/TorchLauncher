import { describe, expect, it } from 'vitest';
import { parseMemoryGiBText, validateServer, validHttps } from './validation';

function project() {
  return {
    format: 'torchlauncher-project' as const,
    version: 1 as const,
    serverId: '44444444-4444-4444-8444-444444444444',
    name: 'New server',
    address: 'localhost:25565',
    sourceUrl: '',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric' as const, version: '0.19.5' } },
    files: [],
  };
}

describe('Studio field validation', () => {
  it('matches server name and host:port config requirements', () => {
    const value = project();
    expect(validateServer(value)).toEqual({});
    expect(validateServer({ ...value, name: ` ${value.name}` })).toHaveProperty('name');
    expect(validateServer({ ...value, name: 'x'.repeat(101) })).toHaveProperty('name');
    expect(validateServer({ ...value, name: 'bad\nname' })).toHaveProperty('name');
    expect(validateServer({ ...value, address: 'localhost' })).toHaveProperty('address');
    expect(validateServer({ ...value, address: 'localhost:65536' })).toHaveProperty('address');
    expect(validateServer({ ...value, address: 'bad host:25565' })).toHaveProperty('address');
    expect(validateServer({ ...value, address: '[::1]:25565' })).not.toHaveProperty('address');
  });

  it('matches deployment version tokens and public HTTPS URL requirements', () => {
    const value = project();
    expect(
      validateServer({ ...value, game: { ...value.game, minecraftVersion: '1.21.1/evil' } }),
    ).toHaveProperty('minecraftVersion');
    expect(
      validateServer({
        ...value,
        game: { ...value.game, loader: { ...value.game.loader, version: ' '.repeat(65) } },
      }),
    ).toHaveProperty('loaderVersion');
    expect(validHttps('https://example.org/pack.torchpack')).toBe(true);
    expect(validHttps('https://user:pass@example.org/pack')).toBe(false);
    expect(validHttps('https://example.org/pack#fragment')).toBe(false);
    expect(validHttps('https://example.org/a b')).toBe(false);
    expect(validHttps(`https://example.org/${'a'.repeat(4090)}`)).toBe(false);
    expect(validHttps('http://example.org/pack')).toBe(false);
  });

  it('requires Minecraft releases from the pinned list', () => {
    const value = project();
    expect(
      validateServer({
        ...value,
        game: { ...value.game, minecraftVersion: '1.6.4' },
      }),
    ).toHaveProperty('minecraftVersion', 'validation.gameVersion');
    expect(
      validateServer({
        ...value,
        game: { ...value.game, minecraftVersion: '1.21.1/evil' },
      }),
    ).toHaveProperty('minecraftVersion', 'validation.gameVersion');
  });
});

describe('Studio default memory validation', () => {
  it('accepts an absent or valid memory block and blank Xms', () => {
    const value = project();
    expect(validateServer(value)).toEqual({});
    expect(validateServer({ ...value, memory: { maxMiB: 2048 } })).toEqual({});
    expect(validateServer({ ...value, memory: { maxMiB: 2048, initialMiB: 256 } })).toEqual({});
    expect(validateServer({ ...value, memory: { maxMiB: 2048, initialMiB: 2048 } })).toEqual({});
  });
  it('rejects out-of-range, fractional, Xms above Xmx and Xms without Xmx', () => {
    const value = project();
    expect(validateServer({ ...value, memory: { maxMiB: 511 } })).toHaveProperty(
      'memoryMax',
      'validation.memoryMax',
    );
    expect(validateServer({ ...value, memory: { maxMiB: 65537 } })).toHaveProperty('memoryMax');
    expect(validateServer({ ...value, memory: { maxMiB: 307.2 } })).toHaveProperty('memoryMax');
    expect(validateServer({ ...value, memory: { maxMiB: Number.NaN } })).toHaveProperty(
      'memoryMax',
    );
    expect(validateServer({ ...value, memory: { maxMiB: 2048, initialMiB: 255 } })).toHaveProperty(
      'memoryInitial',
      'validation.memoryInitial',
    );
    expect(validateServer({ ...value, memory: { maxMiB: 2048, initialMiB: 4096 } })).toHaveProperty(
      'memoryInitial',
      'validation.memoryInitialAboveMax',
    );
    expect(
      validateServer({ ...value, memory: { maxMiB: Number.NaN, initialMiB: 1024 } }),
    ).toHaveProperty('memoryInitial', 'validation.memoryInitialNeedsMax');
  });
  it('parses GB text boxes into MiB', () => {
    expect(parseMemoryGiBText('')).toBeUndefined();
    expect(parseMemoryGiBText('0.25')).toBe(256);
    expect(parseMemoryGiBText('1.5')).toBe(1536);
    expect(parseMemoryGiBText('0.3')).toBe(307.2);
    expect(parseMemoryGiBText('abc')).toBeNaN();
  });
});
