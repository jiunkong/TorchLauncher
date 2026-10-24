import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import type { RunningGame } from '../../../../../packages/core/src/minecraft/process';
import * as preferences from './preferences';
import { type ProductHost, ProductService } from './service';

vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'torch-exit-service-')));
  roots.push(base);
  const host: ProductHost & { quit: ReturnType<typeof vi.fn<() => void>> } = {
    base,
    version: 'test',
    config: {
      format: 'torchlauncher-server',
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      version: 1,
      serverId: '11111111-1111-4111-8111-111111111111',
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/fixture',
    },
    auth: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
    chooseMod: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
  };
  const service = new ProductService(host);
  await service.command({ type: 'set-close-on-launch', value: true });
  const game: RunningGame & { detach: ReturnType<typeof vi.fn<() => Promise<void>>> } = {
    pid: 123,
    finished: new Promise(() => {}),
    stop: vi.fn(async () => ({
      reason: 'stopped' as const,
      code: null,
      signal: null,
      logs: game.getLogs(),
    })),
    detach: vi.fn(async () => {}),
    getLogs: () => ({ entries: [], bytes: 0, droppedEntries: 0, discardedLines: 0 }),
  };
  return { host, service, game };
}
it('quits only after detach and Operations settle; shutdown leaves detached child untouched', async () => {
  const { host, service, game } = await setup();
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.process).toEqual({ detachable: true });
    return game;
  });
  vi.mocked(host.quit).mockImplementation(() => {
    expect(service.snapshot().operation).toBeNull();
    expect(game.detach).toHaveBeenCalledOnce();
  });
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  expect(host.quit).toHaveBeenCalledOnce();
  expect(service.snapshot().outcome).toBe('game-detached');
  expect(service.snapshot().outcome).not.toMatch(/^exited/);
  await service.close();
  await service.command({ type: 'stop' });
  expect(game.stop).not.toHaveBeenCalled();
  expect(await service.command({ type: 'set-close-on-launch', value: false })).toMatchObject({
    ok: false,
    error: 'busy',
  });
});
it('retains the launcher and reaps when handoff fails', async () => {
  const { host, service, game } = await setup();
  vi.mocked(launchDeployment).mockResolvedValue(game);
  vi.mocked(game.detach).mockRejectedValue(new Error('identity-unavailable'));
  expect((await service.command({ type: 'launch' })).ok).toBe(false);
  expect(game.stop).toHaveBeenCalledOnce();
  expect(host.quit).not.toHaveBeenCalled();
  expect(service.snapshot().running).toBe(false);
});
for (const stage of ['auth', 'sync', 'spawn'])
  it(`does not quit after ${stage} failure`, async () => {
    const { host, service } = await setup();
    vi.mocked(launchDeployment).mockImplementation(async (options) => {
      if (stage === 'auth') await options.authenticate();
      throw new Error(`${stage}-failed`);
    });
    vi.mocked(host.auth.refresh).mockRejectedValue(new Error('network_failed'));
    expect((await service.command({ type: 'launch' })).ok).toBe(false);
    expect(host.quit).not.toHaveBeenCalled();
  });
for (const control of ['cancel', 'close'])
  it(`reaps and keeps autoquit off when ${control} races handoff`, async () => {
    const { host, service, game } = await setup();
    let entered: () => void = () => {};
    const start = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(launchDeployment).mockImplementation(async (options) => {
      vi.mocked(game.detach).mockImplementation(async () => {
        entered();
        await new Promise<void>((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        options.signal?.throwIfAborted();
      });
      return game;
    });
    const launch = service.command({ type: 'launch' });
    await start;
    if (control === 'close') await service.close();
    else await service.command({ type: 'cancel' });
    expect((await launch).ok).toBe(false);
    expect(game.stop).toHaveBeenCalled();
    expect(host.quit).not.toHaveBeenCalled();
  });
it('serializes saving the setting before launch and rejects changes while launch owns the gate', async () => {
  const { service, game } = await setup();
  let entered: () => void = () => {};
  const start = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.process).toEqual({ detachable: true });
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return game;
  });
  const launch = service.command({ type: 'launch' });
  await start;
  expect(await service.command({ type: 'set-game-memory', maxMemoryMiB: 512 })).toMatchObject({
    ok: true,
  });
  expect(service.snapshot().preferences).toMatchObject({ closeOnLaunch: true, maxMemoryMiB: 512 });
  expect(await service.command({ type: 'set-close-on-launch', value: false })).toMatchObject({
    ok: false,
    error: 'busy',
  });
  expect(service.snapshot().preferences.closeOnLaunch).toBe(true);
  release();
  await launch;
});

it('saves memory during a live game, drains an active save on close, and uses it next launch', async () => {
  const { host, service, game } = await setup();
  await service.command({ type: 'set-close-on-launch', value: false });
  let finish: (exit: Awaited<RunningGame['finished']>) => void = () => {};
  const finished = new Promise<Awaited<RunningGame['finished']>>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(game, 'finished', { value: finished });
  vi.mocked(game.stop).mockImplementation(async () => {
    const exit = {
      reason: 'stopped',
      code: null,
      signal: null,
      logs: game.getLogs(),
    } as const;
    finish(exit);
    return exit;
  });
  vi.mocked(launchDeployment).mockResolvedValue(game);
  const firstLaunch = service.command({ type: 'launch' });
  await vi.waitFor(() => expect(service.snapshot().running).toBe(true));

  let saveEntered: () => void = () => {};
  const saving = new Promise<void>((resolve) => {
    saveEntered = resolve;
  });
  let releaseSave: () => void = () => {};
  const saveBarrier = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const originalWrite = preferences.writePreferences;
  const write = vi.spyOn(preferences, 'writePreferences');
  write.mockImplementation(async (root, value) => {
    if (value.maxMemoryMiB === 1024) {
      saveEntered();
      await saveBarrier;
    }
    return originalWrite(root, value);
  });
  const memorySave = service.command({
    type: 'set-game-memory',
    maxMemoryMiB: 1024,
    initialMemoryMiB: 512,
  });
  await saving;
  let closeSettled = false;
  const closing = service.close().then(() => {
    closeSettled = true;
  });
  await firstLaunch;
  await Promise.resolve();
  expect(closeSettled).toBe(false);
  releaseSave();
  expect((await memorySave).ok).toBe(true);
  await closing;
  expect(closeSettled).toBe(true);
  expect(game.stop).toHaveBeenCalledOnce();
  write.mockRestore();

  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.maxMemoryMiB).toBe(1024);
    expect(options.initialMemoryMiB).toBe(512);
    return game;
  });
  const nextService = new ProductService(host);
  expect((await nextService.command({ type: 'launch' })).ok).toBe(true);
});

it('does not await or stop the real child if close enters after core handoff but before service continuation', async () => {
  const { host, service, game } = await setup();
  let detached = false;
  Object.defineProperty(game, 'detached', { get: () => detached });
  let closing: Promise<void> | undefined;
  vi.mocked(game.detach).mockImplementation(async () => {
    detached = true;
    // Core has completed handoff; service has not cleared its reference yet.
    closing = service.close();
  });
  vi.mocked(launchDeployment).mockResolvedValue(game);
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  await closing;
  expect(game.stop).not.toHaveBeenCalled();
  expect(host.quit).toHaveBeenCalledOnce();
});

it('launches in managed mode after corrupt settings load, keeping autoquit safely disabled', async () => {
  const { host, game } = await setup();
  await writeFile(join(host.base, 'launcher-preferences.json'), '{bad');
  const service = new ProductService(host);
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    expect(options.process).toEqual({});
    return {
      ...game,
      finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: game.getLogs() }),
    };
  });
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  expect(service.snapshot().preferences).toEqual({
    closeOnLaunch: false,
    error: 'preferences-failed',
  });
  expect(game.detach).not.toHaveBeenCalled();
  expect(host.quit).not.toHaveBeenCalled();
});
