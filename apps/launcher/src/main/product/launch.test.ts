import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureServerDataRoot } from '../../../../../packages/core/src/instance/data/index';
import {
  cleanTemporary,
  deploy,
  serverId,
} from '../../../../../packages/core/src/instance/mods/fixtures';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import { ProductService } from './service';

vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));
let base = '';
afterEach(async () => {
  await cleanTemporary();
  if (base) await rm(base, { recursive: true, force: true });
  vi.clearAllMocks();
});
it('holds product ownership through game reaping and applies policy before handing control to the process gate', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-launch-')));
  const { root } = await ensureServerDataRoot(base, serverId);
  await deploy(
    root,
    [
      {
        path: 'torchlauncher/settings-policy.json',
        data: JSON.stringify({
          version: 1,
          file: 'options.txt',
          required: { renderDistance: '12' },
        }),
      },
    ],
    '22222222-2222-4222-8222-222222222222',
  );
  let reap: () => void = () => {};
  const finished = new Promise<never>((resolve) => {
    reap = () => resolve({ reason: 'stopped', code: null } as never);
  });
  let started: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stop = vi.fn(async () => finished);
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.root).toBe(root);
    expect(options.expectedServerId).toBe(serverId);
    expect(options.server).toBe('localhost:25565');
    expect(options.launcherVersion).toBe('product-test');
    await options.authenticate();
    await options.afterSynchronization?.({} as never);
    expect(await readFile(join(root, 'options.txt'), 'utf8')).toContain('renderDistance:12');
    options.signal?.addEventListener('abort', () => {
      void stop();
    });
    started();
    return {
      pid: 1,
      finished,
      stop,
      getLogs: () => ({
        entries: [{ stream: 'stdout', text: 'safe game output' }],
        bytes: 16,
        droppedEntries: 0,
        discardedLines: 0,
      }),
    };
  });
  const service = new ProductService({
    base,
    version: 'product-test',
    config: {
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/fixture',
    },
    auth: {
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(async () => ({
        accessToken: 'secret-fixture',
        expiresAt: Date.now() + 10000,
        profile: { id: 'a'.repeat(32), name: 'User' },
        userType: 'msa' as const,
        clientId: 'fixture',
      })),
    },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  const launch = service.command({ type: 'launch' });
  await running;
  await vi.waitFor(() => expect(service.snapshot().running).toBe(true));
  expect(service.snapshot().operation).toBe('launch');
  expect(service.snapshot().runningSince).toBeGreaterThan(0);
  expect(service.snapshot().game).toBeUndefined();
  expect(JSON.stringify(service.snapshot())).not.toContain('secret-fixture');
  expect(service.snapshot()).not.toHaveProperty('authenticatedConnection');
  expect(await service.command({ type: 'preview-delete' })).toMatchObject({
    ok: false,
    error: 'busy',
  });
  let closed = false;
  const close = service.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(service.snapshot().operation).toBe('launch');
  reap();
  await launch;
  await close;
  expect(service.snapshot().running).toBe(false);
  expect(service.snapshot().runningSince).toBeUndefined();
  expect(service.snapshot().operation).toBeNull();
  expect(stop).toHaveBeenCalled();
});

it('uses a launch-time memory snapshot and accepts a concurrent save for the next run', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-memory-')));
  const product = new ProductService({
    base,
    version: 'product-test',
    config: {
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/fixture',
    },
    auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  await product.command({ type: 'set-game-memory', maxMemoryMiB: 512, initialMemoryMiB: 256 });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.maxMemoryMiB).toBe(512);
    expect(options.initialMemoryMiB).toBe(256);
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      pid: 1,
      finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: { entries: [] } }),
      stop: vi.fn(),
      getLogs: () => ({ entries: [], bytes: 0, droppedEntries: 0, discardedLines: 0 }),
    } as never;
  });
  const launch = product.command({ type: 'launch' });
  await started;
  expect(await product.command({ type: 'set-game-memory', maxMemoryMiB: 512 })).toMatchObject({
    ok: true,
  });
  expect(product.snapshot().preferences).toEqual({ closeOnLaunch: false, maxMemoryMiB: 512 });
  release();
  expect((await launch).ok).toBe(true);
});

it('keeps the 2048 MiB unset default and stops low-RAM launch before installation', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-low-memory-')));
  const service = new ProductService({
    base,
    version: 'product-test',
    config: {
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/fixture',
    },
    auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  (service as unknown as { state: { physicalMemoryMiB: number } }).state.physicalMemoryMiB = 1536;
  expect((await service.command({ type: 'launch' })).ok).toBe(false);
  expect(service.snapshot().error).toBe('memory-limit');
  expect(launchDeployment).not.toHaveBeenCalled();
  expect(await readFile(join(base, 'launcher-preferences.json'), 'utf8').catch(() => null)).toBe(
    null,
  );
});

it('preserves stored preferences when the current machine has less RAM than the saved values', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-lowered-memory-')));
  await writeFile(
    join(base, 'launcher-preferences.json'),
    JSON.stringify({ closeOnLaunch: true, maxMemoryMiB: 4096, initialMemoryMiB: 1024 }),
  );
  const service = new ProductService({
    base,
    version: 'product-test',
    config: {
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/fixture',
    },
    auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  (service as unknown as { state: { physicalMemoryMiB: number } }).state.physicalMemoryMiB = 2048;
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'memory-limit',
  });
  expect(service.snapshot().preferences).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 4096,
    initialMemoryMiB: 1024,
  });
  expect(launchDeployment).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(join(base, 'launcher-preferences.json'), 'utf8'))).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 4096,
    initialMemoryMiB: 1024,
  });
});
