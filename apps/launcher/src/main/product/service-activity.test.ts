import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeploymentReader } from '../../../../../packages/core/src/deployment/reader/index';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import type { Installation } from '../../../../../packages/core/src/minecraft/installer';
import type { RunningGame } from '../../../../../packages/core/src/minecraft/process';
import { parseServerConfig } from '../../../../../packages/core/src/server-config/index';
import type { ProductState } from '../../shared/product';
import { ProductService } from './service';

vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));
vi.mock('../../../../../packages/core/src/minecraft/installer', () => ({
  installMinecraft: vi.fn(async (options) => {
    options.onActivity({
      phase: 'checking',
      component: 'game',
      path: 'versions/1.21.1/client.jar',
      active: 1,
      completed: 0,
      total: 1,
    });
    options.onProgress({ completed: 1, total: 1 });
    return {} as Installation;
  }),
}));
vi.mock('../../../../../packages/core/src/loaders/installer', () => ({
  installLoader: vi.fn(async () => ({}) as Installation),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['success', 'failure', 'cancelled'] as const)(
  'clears activity at stage transitions and operation end (%s)',
  async (ending) => {
    const base = await mkdtemp(join(tmpdir(), 'product-activity-'));
    roots.push(base);
    const events: ProductState[] = [];
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new ProductService({
      base,
      version: 'test',
      config: parseServerConfig({
        format: 'torchlauncher-server',
        version: 1,
        serverId: '11111111-1111-4111-8111-111111111111',
        name: 'Test',
        address: 'localhost:25565',
        sourceUrl: 'https://private.example/secret',
      }),
      auth: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
      chooseMod: vi.fn(),
      confirmDeletion: vi.fn(),
      confirmRecovery: vi.fn(),
      publish: (state) => {
        events.push(state);
      },
    });
    vi.mocked(launchDeployment).mockImplementationOnce(async (options) => {
      await options.prepare({
        index: {
          game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
        },
      } as DeploymentReader);
      expect(service.snapshot().activity).toEqual({
        phase: 'installing',
        component: 'loader',
        active: 1,
        completed: null,
        total: null,
      });
      options.onPhase?.('authentication');
      expect(service.snapshot().activity).toBeNull();
      options.onPhase?.('synchronization');
      await options.onSynchronizationProgress?.({
        phase: 'planning',
        downloaded: 100,
        reused: 20,
        preserved: 0,
        deleted: 0,
      });
      expect(service.snapshot().activity?.completed).toBeNull();
      expect(service.snapshot().progress).toBeNull();
      await options.onSynchronizationActivity?.({
        phase: 'staging',
        state: 'started',
        path: 'mods/arbitrary-file',
      });
      expect(service.snapshot().activity).toEqual({
        phase: 'staging',
        component: 'server-mod',
        path: 'mods/arbitrary-file',
        active: 1,
        completed: null,
        total: null,
      });
      entered();
      if (ending === 'failure') throw new Error('private secret');
      if (ending === 'cancelled') {
        await new Promise<void>((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        options.signal?.throwIfAborted();
      }
      return {
        finished: Promise.resolve({ reason: 'exited', code: 0 }),
        getLogs: () => ({ entries: [] }),
      } as unknown as RunningGame;
    });
    expect(service.snapshot().activity).toBeNull();
    const operation = service.command({ type: 'launch' });
    await started;
    if (ending === 'cancelled') await service.command({ type: 'cancel' });
    const result = await operation;
    expect(result.ok).toBe(ending === 'success');
    expect(service.snapshot().activity).toBeNull();
    expect(service.snapshot().progress).toBeNull();
    expect(service.snapshot().operation).toBeNull();
    expect(events.some((state) => state.activity?.component === 'game')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/private|secret|accessToken|sourceUrl/);
  },
);
