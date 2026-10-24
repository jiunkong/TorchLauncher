import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type BrandingDeploymentReader,
  openDeploymentReader,
} from '../../../../../packages/core/src/deployment/reader/index';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import { ProductService } from './service';

vi.mock('../../../../../packages/core/src/deployment/reader/index', () => ({
  openDeploymentReader: vi.fn(),
}));
vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
it('observes an already validated reader without waiting for branding or propagating observer rejection', async () => {
  const reader = {
    verification: 'verified',
    header: { indexSha256: 'a'.repeat(64) },
    index: { files: [], sequence: 1, deploymentId: 'fixture' },
  } as unknown as BrandingDeploymentReader;
  vi.mocked(openDeploymentReader).mockResolvedValue(reader);
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(await options.current()).toBe(reader);
    throw new Error('fixture gate finished');
  });
  for (const observer of [
    vi.fn(() => new Promise<void>(() => {})),
    vi.fn(async () => {
      throw new Error('optional branding');
    }),
  ]) {
    const base = await mkdtemp(join(tmpdir(), 'branding-product-'));
    roots.push(base);
    const service = new ProductService({
      base,
      version: 'fixture',
      config: {
        format: 'torchlauncher-server',
        signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        version: 1,
        serverId: '11111111-1111-4111-8111-111111111111',
        name: 'Home name',
        address: 'localhost:25565',
        sourceUrl: 'https://example.invalid/deployment',
      },
      auth: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
      chooseMod: vi.fn(),
      publish: vi.fn(),
      observeDeployment: observer,
    });
    await expect(service.command({ type: 'launch' })).resolves.toMatchObject({
      ok: false,
      error: 'operation-failed',
    });
    expect(observer).toHaveBeenCalledWith(reader);
    expect(service.snapshot()).not.toHaveProperty('branding');
    await service.close();
  }
});
