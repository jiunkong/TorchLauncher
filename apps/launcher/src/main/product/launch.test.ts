import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

// vi.waitFor defaults to a 1 s budget; Windows runners (process probes, file locking) need more.
// Polling stops as soon as the condition holds, so the larger bound costs nothing when it passes.
const waitFor = (callback: () => unknown) =>
  vi.waitFor(callback, { timeout: 20_000, interval: 25 });

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
    await options.afterSynchronization?.({
      verification: 'verified',
      header: { indexSha256: 'a'.repeat(64) },
      index: { sequence: 1, deploymentId: '22222222-2222-4222-8222-222222222222' },
    } as never);
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
  const openLogs = vi.fn(async () => '');
  await mkdir(join(root, 'logs'));
  const service = new ProductService({
    openLogs,
    base,
    version: 'product-test',
    config: {
      format: 'torchlauncher-server',
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
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
  await waitFor(() => expect(service.snapshot().running).toBe(true));
  expect(service.snapshot().operation).toBe('launch');
  expect((await service.command({ type: 'open-logs' })).ok).toBe(true);
  expect(openLogs).toHaveBeenCalledWith(join(root, 'logs'));
  expect(stop).not.toHaveBeenCalled();
  expect(
    await service.command({ type: 'remove-unregistered', path: 'mods/file.txt' }),
  ).toMatchObject({ ok: false, error: 'busy' });
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
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
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
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
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
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
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

const serverConfig = (memory?: { maxMiB: number; initialMiB?: number }) => ({
  format: 'torchlauncher-server' as const,
  signing: {
    algorithm: 'ed25519' as const,
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  version: 1 as const,
  serverId,
  name: 'Fixture',
  address: 'localhost:25565',
  sourceUrl: 'https://example.org/fixture',
  ...(memory ? { memory } : {}),
});
const fakeGame = () =>
  ({
    pid: 1,
    finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: { entries: [] } }),
    stop: vi.fn(),
    getLogs: () => ({ entries: [], bytes: 0, droppedEntries: 0, discardedLines: 0 }),
  }) as never;

const memoryTable: {
  name: string;
  player: { closeOnLaunch: boolean; maxMemoryMiB?: number; initialMemoryMiB?: number };
  server?: { maxMiB: number; initialMiB?: number };
  expected: { max: number; initial?: number };
}[] = [
  { name: 'nothing set', player: { closeOnLaunch: false }, expected: { max: 2048 } },
  {
    name: 'server default only',
    player: { closeOnLaunch: false },
    server: { maxMiB: 4096, initialMiB: 1024 },
    expected: { max: 4096, initial: 1024 },
  },
  {
    name: 'server Xmx without Xms',
    player: { closeOnLaunch: false },
    server: { maxMiB: 3072 },
    expected: { max: 3072 },
  },
  {
    name: 'player only',
    player: { closeOnLaunch: false, maxMemoryMiB: 1024, initialMemoryMiB: 512 },
    expected: { max: 1024, initial: 512 },
  },
  {
    name: 'player Xmx wins, server Xms still fits',
    player: { closeOnLaunch: false, maxMemoryMiB: 2048 },
    server: { maxMiB: 4096, initialMiB: 1024 },
    expected: { max: 2048, initial: 1024 },
  },
  {
    name: 'player Xmx below server Xms drops Xms',
    player: { closeOnLaunch: false, maxMemoryMiB: 512 },
    server: { maxMiB: 4096, initialMiB: 1024 },
    expected: { max: 512 },
  },
  {
    name: 'player overrides both',
    player: { closeOnLaunch: false, maxMemoryMiB: 2048, initialMemoryMiB: 2048 },
    server: { maxMiB: 4096, initialMiB: 1024 },
    expected: { max: 2048, initial: 2048 },
  },
];
it.each(memoryTable)('resolves launch memory: $name', async (row) => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-effective-memory-')));
  await writeFile(join(base, 'launcher-preferences.json'), JSON.stringify(row.player));
  const product = new ProductService({
    base,
    version: 'product-test',
    config: serverConfig(row.server),
    auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.maxMemoryMiB).toBe(row.expected.max);
    expect(options.initialMemoryMiB).toBe(row.expected.initial);
    return fakeGame();
  });
  expect((await product.command({ type: 'launch' })).ok).toBe(true);
  expect(launchDeployment).toHaveBeenCalledTimes(1);
  expect(product.snapshot().serverMemory).toEqual(row.server);
});

it('reports an actionable memory-limit when the server default exceeds physical RAM', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-server-memory-limit-')));
  const make = () =>
    new ProductService({
      base,
      version: 'product-test',
      config: serverConfig({ maxMiB: 8192 }),
      auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
      chooseMod: vi.fn(),
      publish: vi.fn(),
    });
  const service = make();
  (service as unknown as { state: { physicalMemoryMiB: number } }).state.physicalMemoryMiB = 4096;
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'memory-limit-server',
  });
  expect(launchDeployment).not.toHaveBeenCalled();
  // A personal override that fits lets the launch proceed without clearing anything else.
  expect((await service.command({ type: 'set-game-memory', maxMemoryMiB: 2048 })).ok).toBe(true);
  vi.mocked(launchDeployment).mockResolvedValue(fakeGame());
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  // A too-large personal value keeps the generic message.
  await writeFile(
    join(base, 'launcher-preferences.json'),
    JSON.stringify({ closeOnLaunch: false, maxMemoryMiB: 8192 }),
  );
  const personal = make();
  (personal as unknown as { state: { physicalMemoryMiB: number } }).state.physicalMemoryMiB = 4096;
  expect(await personal.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'memory-limit',
  });
});

it('clears the personal override so the server default applies again', async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-clear-memory-')));
  await writeFile(
    join(base, 'launcher-preferences.json'),
    JSON.stringify({ closeOnLaunch: false, maxMemoryMiB: 1024, initialMemoryMiB: 512 }),
  );
  const product = new ProductService({
    base,
    version: 'product-test',
    config: serverConfig({ maxMiB: 4096 }),
    auth: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  });
  expect((await product.command({ type: 'clear-game-memory' })).ok).toBe(true);
  expect(product.snapshot().preferences).toEqual({ closeOnLaunch: false });
  expect(JSON.parse(await readFile(join(base, 'launcher-preferences.json'), 'utf8'))).toEqual({
    closeOnLaunch: false,
  });
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.maxMemoryMiB).toBe(4096);
    expect(options.initialMemoryMiB).toBeUndefined();
    return fakeGame();
  });
  expect((await product.command({ type: 'launch' })).ok).toBe(true);
});
