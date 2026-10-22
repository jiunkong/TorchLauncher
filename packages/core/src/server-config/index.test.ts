import { describe, expect, it } from 'vitest';
import { parseServerConfig, SERVER_CONFIG_FILENAME } from './index.js';

const config = {
  format: 'torchlauncher-server',
  version: 1,
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
