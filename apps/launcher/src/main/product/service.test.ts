import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ensureServerDataRoot,
  resolveServerDataRoot,
} from '../../../../../packages/core/src/instance/data/index';
import {
  cleanTemporary,
  deploy,
  fabricJar,
  serverId,
} from '../../../../../packages/core/src/instance/mods/fixtures';
import { systemProcessProbe } from '../../../../../packages/core/src/minecraft/identity';
import { parseServerConfig } from '../../../../../packages/core/src/server-config/index';
import { type ProductHost, ProductService, safeProductError } from './service';

const roots: string[] = [];
afterEach(async () => {
  await cleanTemporary();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(overrides: Partial<ProductHost> = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-product-')));
  roots.push(base);
  const host: ProductHost = {
    base,
    version: 'test',
    config: parseServerConfig({
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/never-leak-this-url',
    }),
    auth: {
      login: vi.fn(async () => ({
        accessToken: 'never-leak-this-token',
        expiresAt: Date.now() + 100000,
        profile: { id: 'a'.repeat(32), name: 'FixtureUser' },
        userType: 'msa' as const,
        clientId: 'fixture-client',
      })),
      refresh: vi.fn(),
      logout: vi.fn(async () => {}),
    },
    chooseMod: vi.fn(async () => null),
    publish: vi.fn(),
    ...overrides,
  };
  return { host, service: new ProductService(host), root: resolveServerDataRoot(base, serverId) };
}
it('shows the configured game before login and without a game', async () => {
  const withGame = await setup({
    config: parseServerConfig({
      format: 'torchlauncher-server',
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/x',
      game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
    }),
  });
  expect(withGame.service.snapshot().game).toEqual({
    minecraftVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.19.5',
  });
  expect((await setup()).service.snapshot().game).toBeUndefined();
});
it('keeps account credentials, private URL and arbitrary errors out of snapshots/events/results', async () => {
  const { service, host } = await setup();
  expect((await service.command({ type: 'login' })).ok).toBe(true);
  expect(service.snapshot().account?.name).toBe('FixtureUser');
  const serialized = JSON.stringify([service.snapshot(), vi.mocked(host.publish).mock.calls]);
  expect(serialized).not.toMatch(/never-leak|accessToken|profile.*id|sourceUrl/);
  const result = await service.command({ type: 'refresh' });
  expect(result.ok).toBe(false);
  expect(service.snapshot().account).toBeNull();
  expect(safeProductError(new Error('https://private token-secret'))).toBe('operation-failed');
  expect((await service.command({ type: 'logout' })).ok).toBe(true);
  expect(host.auth.logout).toHaveBeenCalledOnce();
});
it('serializes auth until cancellation fully unwinds and close awaits it', async () => {
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  const unwound = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { service, host } = await setup();
  vi.mocked(host.auth.login).mockImplementation(async (signal) => {
    entered();
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve(), { once: true }),
    );
    await unwound;
    throw new DOMException('cancelled', 'AbortError');
  });
  const login = service.command({ type: 'login' });
  await started;
  expect(await service.command({ type: 'mods' })).toMatchObject({ ok: false, error: 'busy' });
  await service.command({ type: 'cancel' });
  expect(service.snapshot().operation).toBe('login');
  let closed = false;
  const close = service.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await login;
  await close;
  expect(service.snapshot().operation).toBeNull();
  expect(service.snapshot().error).toBe('cancelled');
});
it('uses native-selected mod file, enforces operator ownership, and adopts unregistered jars', async () => {
  const { service, host, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  await deploy(
    root,
    [{ path: 'mods/operator.jar', data: fabricJar('operator_mod') }],
    '22222222-2222-4222-8222-222222222222',
  );
  const external = join(host.base, 'personal.jar');
  await writeFile(external, fabricJar('personal_mod'));
  vi.mocked(host.chooseMod).mockResolvedValue(external);
  expect((await service.command({ type: 'add-mod' })).ok).toBe(true);
  expect(service.snapshot().mods.find((mod) => mod.path === 'mods/personal.jar')?.source).toBe(
    'user',
  );
  expect((await service.command({ type: 'remove-mod', path: 'mods/operator.jar' })).ok).toBe(false);
  expect(await readFile(join(root, 'mods/operator.jar'))).toEqual(fabricJar('operator_mod'));
  expect((await service.command({ type: 'remove-mod', path: 'mods/personal.jar' })).ok).toBe(true);
  await writeFile(join(root, 'mods/manual.jar'), fabricJar('manual_mod'));
  expect((await service.command({ type: 'adopt-mod', path: 'mods/manual.jar' })).ok).toBe(true);
  expect(service.snapshot().mods.find((mod) => mod.path === 'mods/manual.jar')?.source).toBe(
    'user',
  );
});
it('previews and confirms exact server deletion while preserving separate auth and other servers', async () => {
  const { service, host, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  await writeFile(join(root, 'game.txt'), 'game');
  await mkdir(join(host.base, 'authentication'));
  await writeFile(join(host.base, 'authentication/session'), 'secret');
  const otherId = '33333333-3333-4333-8333-333333333333';
  const other = await ensureServerDataRoot(host.base, otherId);
  await writeFile(join(other.root, 'other.txt'), 'other');
  expect((await service.command({ type: 'preview-delete' })).ok).toBe(true);
  const confirmation = service.snapshot().deletion?.confirmation;
  expect(confirmation).toHaveLength(43);
  expect(await service.command({ type: 'delete', confirmation: 'z'.repeat(43) })).toMatchObject({
    ok: false,
    error: 'confirmation-invalid',
  });
  expect((await service.command({ type: 'delete', confirmation })).ok).toBe(true);
  expect(await readFile(join(host.base, 'authentication/session'), 'utf8')).toBe('secret');
  expect(await readFile(join(other.root, 'other.txt'), 'utf8')).toBe('other');
  expect((await service.command({ type: 'delete', confirmation })).ok).toBe(false);
});
it('rejects stale or unknown deletion confirmations and keeps the data', async () => {
  const { service, host, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  await writeFile(join(root, 'game.txt'), 'game');
  await service.command({ type: 'preview-delete' });
  const old = service.snapshot().deletion?.confirmation;
  await service.command({ type: 'usage' });
  expect(service.snapshot().deletion).toBeNull();
  expect(await service.command({ type: 'delete', confirmation: old })).toMatchObject({
    ok: false,
  });
  expect(await readFile(join(root, 'game.txt'), 'utf8')).toBe('game');
});
it('enforces required resource packs through the real locked settings policy', async () => {
  const { service, host, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  await deploy(
    root,
    [
      {
        path: 'torchlauncher/settings-policy.json',
        data: JSON.stringify({
          version: 1,
          file: 'options.txt',
          resourcePacks: { required: ['file/required.zip'] },
        }),
      },
    ],
    '22222222-2222-4222-8222-222222222222',
  );
  expect(await service.command({ type: 'set-packs', packs: ['vanilla'] })).toMatchObject({
    ok: false,
    error: 'required-pack-removed',
  });
  expect(
    (
      await service.command({
        type: 'set-packs',
        packs: ['vanilla', 'file/required.zip', 'file/user.zip'],
      })
    ).ok,
  ).toBe(true);
  expect(service.snapshot().packs).toContainEqual({ id: 'file/required.zip', required: true });
  expect(await readFile(join(root, 'options.txt'), 'utf8')).toContain('file/user.zip');
});

it('restores cached sessions noninteractively and treats no saved session as clean idle', async () => {
  const { service, host } = await setup();
  vi.mocked(host.auth.refresh).mockRejectedValue(
    Object.assign(new Error('no_session'), { code: 'no_session' }),
  );
  await service.restoreSession();
  expect(service.snapshot().account).toBeNull();
  expect(service.snapshot().error).toBeNull();
  expect(service.snapshot().operation).toBeNull();
  expect(JSON.stringify(vi.mocked(host.publish).mock.calls)).not.toContain('no_session');
  expect(host.auth.login).not.toHaveBeenCalled();
  vi.mocked(host.auth.refresh).mockResolvedValue({
    accessToken: 'restore-secret',
    expiresAt: Date.now() + 10000,
    profile: { id: 'a'.repeat(32), name: 'RestoredUser' },
    userType: 'msa',
    clientId: 'fixture',
  });
  await service.restoreSession();
  expect(service.snapshot().account?.name).toBe('RestoredUser');
  expect(JSON.stringify(service.snapshot())).not.toContain('restore-secret');
  expect(host.auth.login).not.toHaveBeenCalled();
});

it('persists personal preference through service recreation and reports save errors without false success', async () => {
  const { service, host } = await setup();
  expect(service.snapshot().preferences.closeOnLaunch).toBe(false);
  expect((await service.command({ type: 'set-close-on-launch', value: true })).ok).toBe(true);
  const restarted = new ProductService(host);
  await restarted.command({ type: 'logout' });
  expect(restarted.snapshot().preferences.closeOnLaunch).toBe(true);
  await rm(join(host.base, 'launcher-preferences.json'));
  await mkdir(join(host.base, 'launcher-preferences.json'));
  expect(await restarted.command({ type: 'set-close-on-launch', value: false })).toMatchObject({
    ok: false,
    error: 'preferences-failed',
  });
  expect(restarted.snapshot().preferences.closeOnLaunch).toBe(true);
});
it('preserves both settings when close-on-launch and game memory saves race', async () => {
  const { service, host } = await setup();
  const [memory, close] = await Promise.all([
    service.command({ type: 'set-game-memory', maxMemoryMiB: 512, initialMemoryMiB: 256 }),
    service.command({ type: 'set-close-on-launch', value: true }),
  ]);
  expect(memory.ok).toBe(true);
  expect(close.ok).toBe(true);
  expect(service.snapshot().preferences).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 512,
    initialMemoryMiB: 256,
  });
  expect(JSON.parse(await readFile(join(host.base, 'launcher-preferences.json'), 'utf8'))).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 512,
    initialMemoryMiB: 256,
  });
});

it('rejects physically invalid values without acknowledging or overwriting preferences', async () => {
  const { service, host } = await setup();
  const mutable = service as unknown as { state: { physicalMemoryMiB: number } };
  mutable.state.physicalMemoryMiB = 4096;
  expect(await service.command({ type: 'set-game-memory', maxMemoryMiB: 8192 })).toMatchObject({
    ok: false,
    error: 'memory-limit',
  });
  expect(service.snapshot().preferences).toEqual({ closeOnLaunch: false });
  expect(
    await readFile(join(host.base, 'launcher-preferences.json'), 'utf8').catch(() => null),
  ).toBe(null);
});

it('keeps valid saved values and close-on-launch when a smaller machine requires correction', async () => {
  const { service, host } = await setup();
  const mutable = service as unknown as { state: { physicalMemoryMiB: number } };
  mutable.state.physicalMemoryMiB = 8192;
  expect(
    await service.command({
      type: 'set-game-memory',
      maxMemoryMiB: 4096,
      initialMemoryMiB: 1024,
    }),
  ).toMatchObject({ ok: true });
  expect((await service.command({ type: 'set-close-on-launch', value: true })).ok).toBe(true);
  mutable.state.physicalMemoryMiB = 2048;
  const restarted = new ProductService(host);
  expect((await restarted.command({ type: 'logout' })).ok).toBe(true);
  expect(restarted.snapshot().preferences).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 4096,
    initialMemoryMiB: 1024,
  });
  expect(JSON.parse(await readFile(join(host.base, 'launcher-preferences.json'), 'utf8'))).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 4096,
    initialMemoryMiB: 1024,
  });
});

it('does not acknowledge an in-memory update after an atomic save failure', async () => {
  const { service, host } = await setup();
  expect((await service.command({ type: 'set-game-memory', maxMemoryMiB: 512 })).ok).toBe(true);
  const previous = service.snapshot().preferences;
  await rm(join(host.base, 'launcher-preferences.json'));
  await mkdir(join(host.base, 'launcher-preferences.json'));
  expect(await service.command({ type: 'set-game-memory', maxMemoryMiB: 1024 })).toMatchObject({
    ok: false,
    error: 'preferences-failed',
  });
  expect(service.snapshot().preferences).toEqual(previous);
});

it('uses safe default after corrupt preference read and allows explicit repair without blocking auth', async () => {
  const { host } = await setup();
  await writeFile(join(host.base, 'launcher-preferences.json'), '{bad');
  const service = new ProductService(host);
  expect((await service.command({ type: 'login' })).ok).toBe(true);
  expect(service.snapshot().preferences).toEqual({
    closeOnLaunch: false,
    error: 'preferences-failed',
  });
  expect((await service.command({ type: 'set-close-on-launch', value: true })).ok).toBe(true);
  expect(service.snapshot().preferences).toEqual({ closeOnLaunch: true });
  expect(JSON.parse(await readFile(join(host.base, 'launcher-preferences.json'), 'utf8'))).toEqual({
    closeOnLaunch: true,
  });
});

it('reclaims exited game locks for ordinary management but preserves locks protecting a live identified child', async () => {
  const { host, service, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  const probe = systemProcessProbe();
  const hostIdentity = await probe.host();
  const self = await probe.process(process.pid);
  if (self.state !== 'running' || !hostIdentity.machine)
    throw new Error('fixture identity unavailable');
  const directory = join(root, '.torchlauncher-server-lock');
  const owner = {
    version: 2,
    id: '22222222-2222-4222-8222-222222222222',
    pid: 2147483000,
    start: 'dead-owner',
    purpose: 'game',
    host: hostIdentity,
    child: { state: 'running', pid: process.pid, start: self.start },
  };
  await mkdir(directory);
  const path = join(directory, 'owner.json');
  const liveText = JSON.stringify(owner);
  await writeFile(path, liveText);
  expect(await service.command({ type: 'mods' })).toMatchObject({ ok: false, error: 'locked' });
  expect(await readFile(path, 'utf8')).toBe(liveText);
  expect(
    await service.command({ type: 'remove-unregistered', path: 'mods/readme.txt' }),
  ).toMatchObject({ ok: false, error: 'locked' });
  expect(await readFile(path, 'utf8')).toBe(liveText);
  owner.child = { state: 'running', pid: 2147483001, start: 'dead-child' };
  await writeFile(path, JSON.stringify(owner));
  expect((await service.command({ type: 'mods' })).ok).toBe(true);
  expect(service.snapshot().mods).toEqual([]);
});

it('exposes the planned server location without querying or creating data', async () => {
  const { service, root } = await setup();
  expect(service.snapshot().serverDataRoot).toBe(root);
  expect(service.snapshot().usage).toBeNull();
  expect(service.snapshot().deletion).toBeNull();
  expect((await service.command({ type: 'usage' })).ok).toBe(false);
  expect(service.snapshot().usage).toBeNull();
  expect((await setup({ config: null })).service.snapshot().serverDataRoot).toBeNull();
});
it('opens only the existing fixed logs directory and preserves deletion confirmation', async () => {
  const openLogs = vi.fn(async () => '');
  const { service, host, root } = await setup({ openLogs });
  expect((await service.command({ type: 'open-logs' })).ok).toBe(false);
  expect(openLogs).not.toHaveBeenCalled();
  await ensureServerDataRoot(host.base, serverId);
  await mkdir(join(root, 'logs'));
  await service.command({ type: 'preview-delete' });
  const before = service.snapshot();
  expect((await service.command({ type: 'open-logs' })).ok).toBe(true);
  expect(openLogs).toHaveBeenCalledWith(join(root, 'logs'));
  expect(service.snapshot()).toEqual(before);
  openLogs.mockResolvedValue('private OS detail');
  expect(await service.command({ type: 'open-logs' })).toMatchObject({
    ok: false,
    error: 'operation-failed',
  });
});
it.skipIf(process.platform === 'win32')(
  'rejects logs and ancestor symlinks without invoking the shell',
  async () => {
    const openLogs = vi.fn(async () => '');
    const { service, host, root } = await setup({ openLogs });
    await ensureServerDataRoot(host.base, serverId);
    await mkdir(join(host.base, 'outside'));
    await symlink(join(host.base, 'outside'), join(root, 'logs'), 'dir');
    expect(await service.command({ type: 'open-logs' })).toMatchObject({
      ok: false,
      error: 'unsafe-path',
    });
    await rm(root, { recursive: true });
    await symlink(join(host.base, 'outside'), root, 'dir');
    expect(await service.command({ type: 'open-logs' })).toMatchObject({
      ok: false,
      error: 'unsafe-path',
    });
    expect(openLogs).not.toHaveBeenCalled();
  },
);
it('opens logs independently while another operation holds serialization', async () => {
  const openLogs = vi.fn(async () => '');
  const { service, host, root } = await setup({ openLogs });
  await ensureServerDataRoot(host.base, serverId);
  await mkdir(join(root, 'logs'));
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(host.auth.logout).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        entered();
      }),
  );
  const pending = service.command({ type: 'logout' });
  await started;
  expect((await service.command({ type: 'open-logs' })).ok).toBe(true);
  expect(service.snapshot().operation).toBe('logout');
  expect(await service.command({ type: 'remove-unregistered', path: 'mods/a.txt' })).toMatchObject({
    ok: false,
    error: 'busy',
  });
  finish();
  await pending;
});
it('removes exact unregistered non-jar files but preserves managed files and directories', async () => {
  const { service, host, root } = await setup();
  await ensureServerDataRoot(host.base, serverId);
  await deploy(
    root,
    [{ path: 'mods/operator.jar', data: fabricJar('operator_mod') }],
    '22222222-2222-4222-8222-222222222222',
  );
  await writeFile(join(root, 'mods/manual.jar'), fabricJar('manual_mod'));
  await service.command({ type: 'adopt-mod', path: 'mods/manual.jar' });
  for (const path of ['mods/operator.jar', 'mods/manual.jar']) {
    expect(await service.command({ type: 'remove-unregistered', path })).toMatchObject({
      ok: false,
      error: 'not-unregistered',
    });
    expect((await readFile(join(root, path))).length).toBeGreaterThan(0);
  }
  await mkdir(join(root, 'mods/nested'));
  await writeFile(join(root, 'mods/nested/readme.txt'), 'temporary fixture');
  expect(
    (await service.command({ type: 'remove-unregistered', path: 'mods/nested/readme.txt' })).ok,
  ).toBe(true);
  expect(service.snapshot().mods.some((mod) => mod.path.endsWith('readme.txt'))).toBe(false);
  await expect(readFile(join(root, 'mods/nested/readme.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await service.command({ type: 'remove-unregistered', path: 'mods/nested' })).toMatchObject(
    { ok: false, error: 'unsafe-path' },
  );
});
it('keeps cosmetic skin work off the authentication path and invalidates stale responses', async () => {
  const completions: ((skin: string | null) => void)[] = [];
  const skins = {
    get: vi.fn(() => new Promise<string | null>((resolve) => completions.push(resolve))),
    clear: vi.fn(),
  };
  const { service, host } = await setup({ skins });
  expect((await service.command({ type: 'login' })).ok).toBe(true);
  expect(skins.get).toHaveBeenCalledWith('a'.repeat(32), expect.any(AbortSignal));
  await service.command({ type: 'login' });
  completions[0]?.('old');
  await Promise.resolve();
  await Promise.resolve();
  expect(service.snapshot().account?.skin).toBeUndefined();
  completions[1]?.('current');
  await vi.waitFor(() => expect(service.snapshot().account?.skin).toBe('current'));
  await service.command({ type: 'login' });
  await service.command({ type: 'logout' });
  completions[2]?.('late');
  await Promise.resolve();
  await Promise.resolve();
  expect(service.snapshot().account).toBeNull();
  expect(skins.clear).toHaveBeenCalled();
  await service.command({ type: 'login' });
  vi.mocked(host.auth.refresh).mockRejectedValue(new Error('network_failed'));
  await service.command({ type: 'refresh' });
  completions[3]?.('failed');
  await Promise.resolve();
  await Promise.resolve();
  expect(service.snapshot().account).toBeNull();
  await service.command({ type: 'login' });
  await service.close();
  completions[4]?.('closed');
  await Promise.resolve();
  await Promise.resolve();
  expect(service.snapshot().account?.skin).toBeUndefined();
});
