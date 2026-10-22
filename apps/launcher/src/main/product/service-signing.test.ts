import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import { parseServerConfig } from '../../../../../packages/core/src/server-config/index';
import { readRollbackState } from './deployment-trust';
import { buildDeployment, MemorySource, newKey, serverId } from './deployment-trust.fixture';
import { ProductService } from './service';

const served = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined }));
vi.mock('../../../../../packages/core/src/download/source/index', async (original) => ({
  ...(await original<typeof import('../../../../../packages/core/src/download/source/index')>()),
  createDownloadSource: () => new MemorySource(served.bytes as Uint8Array),
}));
vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));

const key = newKey();
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(launchDeployment).mockReset();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-signing-')));
  roots.push(base);
  const service = new ProductService({
    base,
    version: 'test',
    config: parseServerConfig({
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.invalid/never-leak',
      signing: { algorithm: 'ed25519', publicKey: key.publicKey },
    }),
    auth: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  return { base, service };
}
const sign = (sequence: number) => buildDeployment({ signer: key.privateKey, sequence });

it('records the sequence only after the deployment was applied', async () => {
  const { base, service } = await setup();
  served.bytes = await sign(4);
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    const reader = await options.current();
    expect(await readRollbackState(base, serverId)).toBeNull(); // opened but not applied
    await options.afterSynchronization?.(reader);
    throw new Error('fixture gate finished');
  });
  await service.command({ type: 'launch' });
  expect(await readRollbackState(base, serverId)).toMatchObject({ sequence: 4 });
  await service.close();
});

it('leaves the state unchanged when the apply fails or is cancelled', async () => {
  const { base, service } = await setup();
  served.bytes = await sign(4);
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    await options.current();
    throw new Error('sync failed');
  });
  await service.command({ type: 'launch' });
  expect(await readRollbackState(base, serverId)).toBeNull();
  await service.close();
});

it('surfaces signature and rollback failures as safe codes without raw text', async () => {
  const { service } = await setup();
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    await options.current();
    throw new Error('should not be reached');
  });
  served.bytes = await buildDeployment(); // unsigned
  const unsigned = await service.command({ type: 'launch' });
  expect(unsigned).toMatchObject({ ok: false, error: 'signature-required' });
  served.bytes = await buildDeployment({ signer: newKey().privateKey, sequence: 1 });
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'signature-invalid',
  });
  expect(JSON.stringify(unsigned)).not.toContain(key.publicKey);
  await service.close();
});

it('rejects a lower sequence after a successful apply', async () => {
  const { service } = await setup();
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    const reader = await options.current();
    await options.afterSynchronization?.(reader);
    throw new Error('stop');
  });
  served.bytes = await sign(5);
  await service.command({ type: 'launch' });
  served.bytes = await sign(4);
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'rollback-lower',
  });
  await service.close();
});
