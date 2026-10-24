import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readServerConfig, serverConfigPath } from './bootstrap';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const config = {
  format: 'torchlauncher-server',
  signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  version: 1,
  serverId: '44444444-4444-4444-8444-444444444444',
  name: 'Fixture',
  address: 'localhost:25565',
  sourceUrl: 'https://example.org/private-fixture',
};
it('resolves trusted packaged portable locations and development overrides', () => {
  const base = {
    packaged: true,
    appPath: '/application',
    executable: '/binary/launcher',
    environment: {},
  };
  expect(serverConfigPath(base)).toBe('/binary/torchlauncher-server.json');
  expect(
    serverConfigPath({
      ...base,
      environment: { PORTABLE_EXECUTABLE_DIR: '/portable', APPIMAGE: '/image/launcher' },
    }),
  ).toBe('/portable/torchlauncher-server.json');
  expect(serverConfigPath({ ...base, environment: { APPIMAGE: '/image/launcher' } })).toBe(
    '/image/torchlauncher-server.json',
  );
  expect(serverConfigPath({ ...base, packaged: false })).toBe(
    '/application/torchlauncher-server.json',
  );
  expect(
    serverConfigPath({ ...base, environment: { TORCH_SERVER_CONFIG: '/override.json' } }),
  ).toBe('/override.json');
});
it('reads the bounded real config and rejects oversized/malformed/link files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'launcher-config-'));
  roots.push(root);
  const file = join(root, 'config.json');
  await writeFile(file, JSON.stringify(config));
  expect(await readServerConfig(file)).toEqual(config);
  const { signing: _signing, ...withoutKey } = config;
  await writeFile(file, JSON.stringify(withoutKey));
  await expect(readServerConfig(file)).rejects.toThrow();
  await writeFile(file, 'x'.repeat(16385));
  await expect(readServerConfig(file)).rejects.toThrow();
  await writeFile(file, '{}');
  await expect(readServerConfig(file)).rejects.toThrow();
  if (process.platform !== 'win32') {
    const link = join(root, 'link');
    await symlink(file, link);
    await expect(readServerConfig(link)).rejects.toThrow();
  }
});
