import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ensureServerDataRoot,
  resolveServerDataRoot,
} from '../../../../../packages/core/src/instance/data/index';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import { systemProcessProbe } from '../../../../../packages/core/src/minecraft/identity';
import type { RunningGame } from '../../../../../packages/core/src/minecraft/process';
import { type ProductHost, ProductService } from './service';

vi.mock('../../../../../packages/core/src/loaders/launch-gate', () => ({
  launchDeployment: vi.fn(),
}));
const serverId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'torch-automation-')));
  roots.push(base);
  const host: ProductHost = {
    base,
    version: 'test',
    config: {
      format: 'torchlauncher-server',
      signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      version: 1,
      serverId,
      name: 'Fixture',
      address: 'localhost:25565',
      sourceUrl: 'https://example.org/never-leak-this-url',
    },
    auth: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn(async () => {}) },
    chooseMod: vi.fn(),
    publish: vi.fn(),
  };
  const root = resolveServerDataRoot(base, serverId);
  await ensureServerDataRoot(base, serverId);
  return { host, root, service: new ProductService(host) };
}
function fakeGame(lines: string[] = []): RunningGame {
  const entries = lines.map((text, index) => ({
    stream: 'stdout' as const,
    text,
    sequence: index,
    bytes: text.length,
  }));
  const logs = { entries, bytes: 0, droppedEntries: 0, discardedLines: 0 };
  return {
    pid: 1,
    finished: Promise.resolve({ reason: 'exited' as const, code: 0, signal: null, logs }),
    stop: vi.fn(),
    getLogs: () => logs,
  } as unknown as RunningGame;
}
async function writeOwner(root: string, owner: unknown) {
  const directory = join(root, '.torchlauncher-server-lock');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'owner.json');
  await writeFile(path, JSON.stringify(owner));
  return { directory, path };
}
async function gameOwner(child: { pid: number; start: string | null }) {
  const probe = systemProcessProbe();
  const host = await probe.host();
  if (!host.machine) throw new Error('fixture identity unavailable');
  return {
    version: 2,
    id: '22222222-2222-4222-8222-222222222222',
    pid: 2147483000,
    start: 'dead-owner',
    purpose: 'game',
    host,
    child: { state: 'running', ...child },
  };
}
const dead = { pid: 2147483001, start: 'dead-child' };

it('recovers a verified-stale lock silently at startup, leaving no recovery flag and a launcher log', async () => {
  const { service, root, host } = await setup();
  const { directory } = await writeOwner(root, await gameOwner(dead));
  vi.mocked(host.auth.refresh).mockRejectedValue(
    Object.assign(new Error('no_session'), { code: 'no_session' }),
  );
  await service.restoreSession();
  expect(service.snapshot().recovery).toBeNull();
  expect(await readdir(root)).not.toContain(directory.split('/').pop());
  expect(
    service.snapshot().logs.some((l) => l.source === 'launcher' && /recovery/.test(l.text)),
  ).toBe(true);
  expect(service.snapshot().error).toBeNull();
});

it('recovers stale state at the start of a play attempt and then proceeds to launch', async () => {
  const { service, root } = await setup();
  await writeOwner(root, await gameOwner(dead));
  vi.mocked(launchDeployment).mockResolvedValue(fakeGame(['hello from game']));
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  expect(launchDeployment).toHaveBeenCalledOnce();
  expect(service.snapshot().recovery).toBeNull();
});

it('does not clear an uncertain lock, blocks play, and proceeds only after explicit confirmation', async () => {
  const { service, root } = await setup();
  const { path } = await writeOwner(root, { version: 1, id: 'x', pid: 4242, purpose: 'game' });
  vi.mocked(launchDeployment).mockResolvedValue(fakeGame());
  const blocked = await service.command({ type: 'launch' });
  expect(blocked).toMatchObject({ ok: false, error: 'recovery-required' });
  expect(launchDeployment).not.toHaveBeenCalled();
  expect(service.snapshot().recovery).toMatchObject({
    needed: true,
    confirmable: true,
    lock: 'uncertain',
  });
  expect(await readFile(path, 'utf8')).toContain('"version":1');
  expect((await service.command({ type: 'recover', acceptUncertain: true })).ok).toBe(true);
  expect((await service.command({ type: 'launch' })).ok).toBe(true);
  expect(launchDeployment).toHaveBeenCalledOnce();
  expect(service.snapshot().recovery).toBeNull();
});

it('never recovers a lock whose game child is alive, even with confirmation', async () => {
  const { service, root } = await setup();
  const probe = systemProcessProbe();
  const self = await probe.process(process.pid);
  if (self.state !== 'running') throw new Error('fixture identity unavailable');
  const { path } = await writeOwner(root, await gameOwner({ pid: process.pid, start: self.start }));
  const before = await readFile(path, 'utf8');
  const launch = await service.command({ type: 'launch' });
  expect(launch.ok).toBe(false);
  expect(launchDeployment).not.toHaveBeenCalled();
  expect(service.snapshot().recovery).toMatchObject({ lock: 'held-live', confirmable: false });
  expect(await readFile(path, 'utf8')).toBe(before);
  await service.command({ type: 'recover', acceptUncertain: true });
  expect(await readFile(path, 'utf8')).toBe(before);
});

it('reports an invalid install journal without clearing it or marking it confirmable', async () => {
  const { service, root } = await setup();
  const lock = join(root, '.torchlauncher-install-lock');
  await mkdir(lock);
  await writeFile(join(lock, 'journal.json'), '{bad');
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'recovery-required',
  });
  expect(service.snapshot().recovery).toMatchObject({ needed: true, confirmable: false });
  expect(service.snapshot().recovery?.issues).toContain('install-invalid');
  expect(await readFile(join(lock, 'journal.json'), 'utf8')).toBe('{bad');
});

it('cancels cleanly during a play attempt without launching', async () => {
  const { service, root } = await setup();
  await writeOwner(root, await gameOwner(dead));
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    const signal = options.signal;
    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
    signal?.throwIfAborted();
    return fakeGame();
  });
  const launch = service.command({ type: 'launch' });
  await vi.waitFor(() => expect(launchDeployment).toHaveBeenCalled());
  await service.command({ type: 'cancel' });
  expect(await launch).toMatchObject({ ok: false, error: 'cancelled' });
  expect(service.snapshot().operation).toBeNull();
});

it('returns to login-required when the session cannot be refreshed during play', async () => {
  const { service, host } = await setup();
  vi.mocked(host.auth.login).mockResolvedValue({
    accessToken: 'never-leak-this-token',
    expiresAt: Date.now() + 100000,
    profile: { id: 'a'.repeat(32), name: 'FixtureUser' },
    userType: 'msa',
    clientId: 'fixture',
  });
  await service.command({ type: 'login' });
  expect(service.snapshot().account).not.toBeNull();
  vi.mocked(launchDeployment).mockImplementation(async (options) => {
    await options.authenticate();
    throw new Error('unreachable');
  });
  vi.mocked(host.auth.refresh).mockRejectedValue(
    Object.assign(new Error('reauth'), { code: 'reauthentication_required' }),
  );
  expect(await service.command({ type: 'launch' })).toMatchObject({
    ok: false,
    error: 'reauthentication_required',
  });
  expect(service.snapshot().account).toBeNull();
});

it('separates launcher and sanitized game log sources and leaves no account data after logout', async () => {
  const { service, host } = await setup();
  vi.mocked(host.auth.login).mockResolvedValue({
    accessToken: 'never-leak-this-token',
    expiresAt: Date.now() + 100000,
    profile: { id: 'a'.repeat(32), name: 'FixtureUser' },
    userType: 'msa',
    clientId: 'fixture',
  });
  await service.command({ type: 'login' });
  vi.mocked(launchDeployment).mockResolvedValue(
    fakeGame(['fetch https://private.example/x ok\u001b[31m', 'plain']),
  );
  await service.command({ type: 'launch' });
  const logs = service.snapshot().logs;
  expect(logs.filter((l) => l.source === 'game').map((l) => l.text)).toEqual([
    'fetch [URL] ok[31m',
    'plain',
  ]);
  expect(logs.some((l) => l.source === 'launcher')).toBe(true);
  await service.command({ type: 'logout' });
  expect(host.auth.logout).toHaveBeenCalledOnce();
  expect(service.snapshot().account).toBeNull();
  expect(JSON.stringify(service.snapshot())).not.toMatch(
    /never-leak|accessToken|FixtureUser|private\.example/,
  );
});
