import { beforeEach, expect, it, vi } from 'vitest';
import type { DeploymentReader } from '../deployment/reader/index.js';
import { synchronizeDeployment } from '../instance/sync/index.js';
import { assertSynchronizedForLaunch } from '../instance/sync/launch-guard.js';
import type { Installation } from '../minecraft/installer';
import { launchMinecraft } from '../minecraft/process';
import { launchDeployment } from './launch-gate';

const state = vi.hoisted(() => ({ spawned: 0 }));
vi.mock('../instance/sync/index.js', () => ({ synchronizeDeployment: vi.fn(async () => ({})) }));
vi.mock('../instance/sync/launch-guard.js', () => ({
  assertSynchronizedForLaunch: vi.fn(async () => {}),
}));
vi.mock('../minecraft/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../minecraft/process')>()),
  launchMinecraft: vi.fn(async (installation, _launch, options) => {
    await options.preSpawn({ root: installation.root, signal: AbortSignal.timeout(1000) });
    state.spawned++;
    return { pid: 1 };
  }),
}));
const game = {
  minecraftVersion: '1.21.1',
  loader: { kind: 'neoforge' as const, version: '21.1.264' },
};
function reader(hash = 'a', version = '21.1.264'): DeploymentReader {
  return {
    header: { indexSha256: hash, totalLength: 305 },
    index: { serverId: 'server', game: { ...game, loader: { ...game.loader, version } } },
  } as unknown as DeploymentReader;
}
function setup() {
  return {
    root: '/game',
    expectedServerId: 'server',
    server: 'localhost:25565',
    current: vi.fn(async () => reader()),
    prepare: vi.fn(
      async () =>
        ({ root: '/game', loader: { ...game.loader, minecraftVersion: '1.21.1' } }) as Installation,
    ),
    authenticate: vi.fn(async () => ({
      accessToken: 'unit-only',
      expiresAt: Date.now() + 100000,
      profile: { id: '1'.repeat(32), name: 'UnitUser' },
      userType: 'msa' as const,
      clientId: 'public',
    })),
  };
}
beforeEach(() => {
  state.spawned = 0;
  vi.clearAllMocks();
  vi.mocked(synchronizeDeployment).mockResolvedValue({} as never);
  vi.mocked(assertSynchronizedForLaunch).mockResolvedValue();
});
it('syncs the reread deployment and checks fresh remote/local state immediately before spawn', async () => {
  const options = setup();
  await launchDeployment(options);
  expect(options.current).toHaveBeenCalledTimes(3);
  expect(synchronizeDeployment).toHaveBeenCalledOnce();
  expect(assertSynchronizedForLaunch).toHaveBeenCalledOnce();
  expect(state.spawned).toBe(1);
  expect(launchMinecraft).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ quickPlayServer: 'localhost:25565' }),
    expect.anything(),
  );
});
it('blocks changed loader identity after install', async () => {
  const options = setup();
  options.current.mockResolvedValueOnce(reader()).mockResolvedValueOnce(reader('a', '21.1.200'));
  await expect(launchDeployment(options)).rejects.toThrow('EDEPLOYMENTCHANGED');
  expect(state.spawned).toBe(0);
});
it('blocks wrong prepared installation identity', async () => {
  const options = setup();
  options.prepare.mockResolvedValue({ root: '/game' } as Installation);
  await expect(launchDeployment(options)).rejects.toThrow('EINSTALLIDENTITY');
  expect(state.spawned).toBe(0);
});
it('blocks latest-check network failure without any offline fallback', async () => {
  const options = setup();
  options.current.mockResolvedValueOnce(reader()).mockRejectedValueOnce(new Error('network'));
  await expect(launchDeployment(options)).rejects.toThrow();
  expect(state.spawned).toBe(0);
});
it('blocks failed sync, changed final index and failed local guard', async () => {
  let options = setup();
  vi.mocked(synchronizeDeployment).mockRejectedValueOnce(new Error('hash mismatch'));
  await expect(launchDeployment(options)).rejects.toThrow();
  expect(state.spawned).toBe(0);
  options = setup();
  options.current
    .mockResolvedValueOnce(reader())
    .mockResolvedValueOnce(reader())
    .mockResolvedValueOnce(reader('b'));
  await expect(launchDeployment(options)).rejects.toThrow('EDEPLOYMENTCHANGED');
  expect(state.spawned).toBe(0);
  options = setup();
  vi.mocked(assertSynchronizedForLaunch).mockRejectedValueOnce(new Error('required file changed'));
  await expect(launchDeployment(options)).rejects.toThrow('ESYNCGUARD');
  expect(state.spawned).toBe(0);
});

it('runs settings after sync before acquiring the game lease; failure blocks spawn', async () => {
  const options = setup();
  const afterSynchronization = vi.fn(async () => {
    expect(synchronizeDeployment).toHaveBeenCalledOnce();
    expect(launchMinecraft).not.toHaveBeenCalled();
  });
  await launchDeployment({ ...options, afterSynchronization });
  expect(afterSynchronization).toHaveBeenCalledOnce();
  vi.clearAllMocks();
  state.spawned = 0;
  await expect(
    launchDeployment({
      ...setup(),
      afterSynchronization: async () => {
        throw new Error('policy conflict');
      },
    }),
  ).rejects.toThrow('policy conflict');
  expect(launchMinecraft).not.toHaveBeenCalled();
  expect(state.spawned).toBe(0);
});
