import { spawn as spawnProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectServerDataLock } from '../../instance/data/marker';
import realVersion from '../fixtures/1.21.1.json';
import type { ProcessProbe, ProcessState } from '../identity';
import {
  INSTALL_LOCK_DIRECTORY,
  type InstallOperation,
  writeInstallJournal,
} from '../install-transaction';
import {
  acquireServerDataLock,
  type LockOwnerV2,
  reclaimServerDataLock,
  SERVER_LOCK_DIRECTORY,
  ServerDataLockedError,
} from '../lock';
import { parseVersion } from '../metadata';
import { startJavaDiagnostic } from '../process';
import { recoverExitedGameLock } from './environment';
import { inspectServerEnvironment, recoverServerEnvironment } from './index';
import { inspectInstallTransaction, recoverInstallTransaction } from './install';

/** Creating symlinks needs Developer Mode or elevation on Windows; such tests are skipped without it. */
const canSymlink = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'torch-symlink-probe-'));
  try {
    await writeFile(join(dir, 'target'), '');
    await symlink(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();

const MACHINE = 'a'.repeat(64);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-recovery-'));
  roots.push(root);
  return root;
}
/** Fake probe: `table` maps pid to state; the current process is always running as `self`. */
function fakeProbe(table: Record<number, ProcessState> = {}, machine: string | null = MACHINE) {
  const probe: ProcessProbe = {
    host: async () => ({ machine }),
    process: async (pid) =>
      pid === process.pid
        ? { state: 'running', start: 'self' }
        : (table[pid] ?? { state: 'absent' }),
  };
  return probe;
}
async function writeOwner(root: string, owner: unknown): Promise<void> {
  await mkdir(join(root, SERVER_LOCK_DIRECTORY));
  await writeFile(join(root, SERVER_LOCK_DIRECTORY, 'owner.json'), JSON.stringify(owner));
}
function v2(overrides: Partial<LockOwnerV2> = {}): LockOwnerV2 {
  return {
    version: 2,
    id: '6f1c2b0a-1d2e-4f3a-8b9c-0d1e2f3a4b5c',
    pid: 4242,
    purpose: 'game',
    start: 'linux:boot:100',
    host: { machine: MACHINE },
    child: null,
    ...overrides,
  };
}

describe('server lock owner v2', () => {
  it('records identity and the game child atomically; stays compatible with USER-03', async () => {
    const root = await tempRoot();
    const probe = fakeProbe({ 77: { state: 'running', start: 'child-start' } });
    const lease = await acquireServerDataLock(root, 'game', { probe });
    const read = async () =>
      JSON.parse(await readFile(join(root, SERVER_LOCK_DIRECTORY, 'owner.json'), 'utf8'));
    expect(await read()).toMatchObject({
      version: 2,
      pid: process.pid,
      purpose: 'game',
      start: 'self',
      host: { machine: MACHINE },
      child: null,
    });
    await lease.recordChild?.({ state: 'starting' });
    await lease.recordChild?.({ state: 'running', pid: 77, start: 'child-start' });
    expect((await read()).child).toEqual({ state: 'running', pid: 77, start: 'child-start' });
    expect(await readdir(join(root, SERVER_LOCK_DIRECTORY))).toEqual(['owner.json']);
    expect(await inspectServerDataLock(root)).toEqual({
      state: 'locked',
      purpose: 'game',
      pid: process.pid,
    });
    const env = await inspectServerEnvironment(root, { probe });
    expect(env.serverLock).toMatchObject({ state: 'held-live', childAlive: true });
    await expect(acquireServerDataLock(root, 'install', { probe })).rejects.toMatchObject({
      code: 'locked',
      recovery: 'inspect-server-environment',
      root,
    });
    await lease.release();
    expect(await inspectServerDataLock(root)).toEqual({ state: 'unlocked' });
  });

  it('records unknown identity without failing acquisition', async () => {
    const root = await tempRoot();
    const probe: ProcessProbe = {
      host: async () => {
        throw new Error('no host');
      },
      process: async () => ({ state: 'unknown' }),
    };
    const lease = await acquireServerDataLock(root, 'install', { probe });
    expect(
      JSON.parse(await readFile(join(root, SERVER_LOCK_DIRECTORY, 'owner.json'), 'utf8')),
    ).toMatchObject({ start: null, host: { machine: null } });
    // Own process with unknown identity: reported live, never confirmable.
    expect((await inspectServerEnvironment(root, { probe })).serverLock).toMatchObject({
      state: 'held-live',
      confirmable: false,
    });
    await lease.release();
  });
});

describe('managed game process', () => {
  it('records the spawned Java child in the game lease and releases on exit', async () => {
    const root = await tempRoot();
    const probe: ProcessProbe = {
      host: async () => ({ machine: MACHINE }),
      process: async (pid) => ({ state: 'running', start: `start-${pid}` }),
    };
    const game = await startJavaDiagnostic(
      {
        root,
        platform: { os: 'linux', arch: 'x64', version: '6.1' },
        javaPath: process.execPath,
        version: parseVersion(realVersion),
        classpath: [],
        nativesDirectory: root,
        assetsDirectory: root,
      },
      {
        processProbe: probe,
        terminationGraceMs: 100,
        spawn: (file, _args, options) =>
          spawnProcess(file, ['-e', 'setInterval(() => {}, 1000)'], options),
      },
    );
    const owner = JSON.parse(
      await readFile(join(root, SERVER_LOCK_DIRECTORY, 'owner.json'), 'utf8'),
    ) as LockOwnerV2;
    expect(owner.child).toEqual({ state: 'running', pid: game.pid, start: `start-${game.pid}` });
    expect(owner.purpose).toBe('game');
    await game.stop();
    expect(await inspectServerDataLock(root)).toEqual({ state: 'unlocked' });
  });
});

describe('lock classification', () => {
  const cases: {
    name: string;
    owner: unknown;
    table?: Record<number, ProcessState>;
    machine?: string | null;
    state: string;
    evidence: string[];
  }[] = [
    {
      name: 'v1 owner is uncertain',
      owner: { version: 1, id: v2().id, pid: 4242, purpose: 'install' },
      state: 'uncertain',
      evidence: ['owner-v1'],
    },
    {
      name: 'live owner',
      owner: v2(),
      table: { 4242: { state: 'running', start: 'linux:boot:100' } },
      state: 'held-live',
      evidence: ['owner-alive'],
    },
    {
      name: 'exited owner, no child',
      owner: v2(),
      state: 'stale-verified',
      evidence: ['owner-exited'],
    },
    {
      name: 'reused owner pid',
      owner: v2(),
      table: { 4242: { state: 'running', start: 'linux:boot:999' } },
      state: 'stale-verified',
      evidence: ['owner-pid-reused'],
    },
    {
      name: 'dead owner, live child',
      owner: v2({ child: { state: 'running', pid: 5000, start: 'c' } }),
      table: { 5000: { state: 'running', start: 'c' } },
      state: 'held-live',
      evidence: ['owner-exited', 'child-alive'],
    },
    {
      name: 'dead owner, reused child pid',
      owner: v2({ child: { state: 'running', pid: 5000, start: 'c' } }),
      table: { 5000: { state: 'running', start: 'other' } },
      state: 'stale-verified',
      evidence: ['owner-exited', 'child-pid-reused'],
    },
    {
      name: 'crash during spawn window',
      owner: v2({ child: { state: 'starting' } }),
      state: 'uncertain',
      evidence: ['owner-exited', 'child-unrecorded'],
    },
    {
      name: 'child start unknown',
      owner: v2({ child: { state: 'running', pid: 5000, start: null } }),
      table: { 5000: { state: 'running', start: 'c' } },
      state: 'uncertain',
      evidence: ['owner-exited', 'child-state-unknown'],
    },
    {
      name: 'probe cannot tell',
      owner: v2(),
      table: { 4242: { state: 'unknown' } },
      state: 'uncertain',
      evidence: ['owner-state-unknown'],
    },
    {
      name: 'other machine',
      owner: v2(),
      machine: 'b'.repeat(64),
      state: 'uncertain',
      evidence: ['host-different'],
    },
    {
      name: 'unknown machine',
      owner: v2(),
      machine: null,
      state: 'uncertain',
      evidence: ['host-unknown'],
    },
    {
      name: 'malformed owner',
      owner: { version: 2, pid: 1 },
      state: 'uncertain',
      evidence: ['owner-invalid'],
    },
  ];
  for (const testCase of cases)
    it(testCase.name, async () => {
      const root = await tempRoot();
      await writeOwner(root, testCase.owner);
      const env = await inspectServerEnvironment(root, {
        probe: fakeProbe(
          testCase.table,
          testCase.machine === undefined ? MACHINE : testCase.machine,
        ),
      });
      expect(env.serverLock.state).toBe(testCase.state);
      expect(env.serverLock.evidence).toEqual(testCase.evidence);
      expect(env.needsRecovery).toBe(testCase.state !== 'held-live');
    });

  it('reports missing owner and unsafe lock entries', async () => {
    const root = await tempRoot();
    await mkdir(join(root, SERVER_LOCK_DIRECTORY));
    expect((await inspectServerEnvironment(root, { probe: fakeProbe() })).serverLock).toMatchObject(
      { state: 'uncertain', evidence: ['owner-missing'], confirmable: true },
    );
  });

  it.skipIf(!canSymlink)(
    'reports a symlinked lock entry as unsafe (needs symlink permission)',
    async () => {
      const other = await tempRoot();
      const target = await tempRoot();
      await symlink(target, join(other, SERVER_LOCK_DIRECTORY));
      expect(
        (await inspectServerEnvironment(other, { probe: fakeProbe() })).serverLock,
      ).toMatchObject({ state: 'uncertain', evidence: ['lock-unsafe'], confirmable: false });
      const report = await recoverServerEnvironment(other, {
        probe: fakeProbe(),
        acceptUncertain: true,
      });
      expect(report).toMatchObject({ status: 'blocked', issues: [{ code: 'lock-unsafe' }] });
    },
  );
});

describe('recoverServerEnvironment lock handling', () => {
  it('reclaims a verified stale lock and leaves the root unlocked', async () => {
    const root = await tempRoot();
    await writeOwner(root, v2());
    const report = await recoverServerEnvironment(root, { probe: fakeProbe() });
    expect(report.status).toBe('recovered');
    expect(report.actions).toEqual([{ kind: 'server-lock-reclaimed', basis: 'verified' }]);
    expect(report.environment.serverLock.state).toBe('free');
    expect(report.environment.needsRecovery).toBe(false);
    expect((await recoverServerEnvironment(root, { probe: fakeProbe() })).status).toBe('clean');
  });

  it('refuses live locks and uncertain locks without confirmation', async () => {
    const root = await tempRoot();
    await writeOwner(root, { version: 1, id: v2().id, pid: 4242, purpose: 'game' });
    const refused = await recoverServerEnvironment(root, { probe: fakeProbe() });
    expect(refused).toMatchObject({ status: 'blocked', issues: [{ code: 'lock-uncertain' }] });
    expect(await inspectServerDataLock(root)).toMatchObject({ state: 'locked' });
    const accepted = await recoverServerEnvironment(root, {
      probe: fakeProbe(),
      acceptUncertain: true,
    });
    expect(accepted.actions).toEqual([{ kind: 'server-lock-reclaimed', basis: 'user-confirmed' }]);
    expect(accepted.environment.serverLock.state).toBe('free');

    const live = await tempRoot();
    const lease = await acquireServerDataLock(live, 'game', { probe: fakeProbe() });
    expect(
      await recoverServerEnvironment(live, { probe: fakeProbe(), acceptUncertain: true }),
    ).toMatchObject({ status: 'blocked', issues: [{ code: 'lock-held-live' }] });
    await lease.release();
  });

  it('never releases a lock whose recorded child is alive, even when confirmed', async () => {
    const root = await tempRoot();
    await writeOwner(root, v2({ child: { state: 'running', pid: 5000, start: 'c' } }));
    const probe = fakeProbe({ 4242: { state: 'unknown' }, 5000: { state: 'running', start: 'c' } });
    const report = await recoverServerEnvironment(root, { probe, acceptUncertain: true });
    expect(report.status).toBe('blocked');
    expect(report.environment.serverLock).toMatchObject({ state: 'held-live', childAlive: true });
  });

  it('checks loader staging locks before treating an install lock as stale', async () => {
    const root = await tempRoot();
    await writeOwner(root, v2({ purpose: 'install' }));
    const stage = join(root, '.torchlauncher-loaders', '.stage-1');
    await mkdir(stage, { recursive: true });
    await writeOwner(stage, v2({ child: { state: 'running', pid: 6000, start: 'installer' } }));
    const alive = fakeProbe({ 6000: { state: 'running', start: 'installer' } });
    expect((await inspectServerEnvironment(root, { probe: alive })).serverLock).toMatchObject({
      state: 'held-live',
      evidence: ['owner-exited', 'loader-installer-alive'],
      childAlive: true,
    });
    expect(
      await recoverServerEnvironment(root, { probe: alive, acceptUncertain: true }),
    ).toMatchObject({ status: 'blocked', issues: [{ code: 'lock-held-live' }] });
    const unknown = fakeProbe({ 6000: { state: 'unknown' } });
    expect((await inspectServerEnvironment(root, { probe: unknown })).serverLock).toMatchObject({
      state: 'uncertain',
      evidence: ['owner-exited', 'loader-installer-unverified'],
    });
    const report = await recoverServerEnvironment(root, { probe: fakeProbe() });
    expect(report.status).toBe('recovered');
  });

  it('reclaim is compare-and-swap on the inspected owner record', async () => {
    const root = await tempRoot();
    await writeOwner(root, v2());
    await expect(
      reclaimServerDataLock(root, 'not the owner', { probe: fakeProbe() }),
    ).rejects.toBeInstanceOf(ServerDataLockedError);
    // The original owner record is restored, not lost.
    expect(
      JSON.parse(await readFile(join(root, SERVER_LOCK_DIRECTORY, 'owner.json'), 'utf8')),
    ).toEqual(v2());
    expect(await readdir(join(root, SERVER_LOCK_DIRECTORY))).toEqual(['owner.json']);
  });
});

async function installScenario(root: string) {
  const lock = join(root, INSTALL_LOCK_DIRECTORY);
  const staging = join(lock, 'staging');
  const backups = join(lock, 'backups');
  await mkdir(staging, { recursive: true });
  await mkdir(backups);
  await mkdir(join(root, 'versions'), { recursive: true });
  await mkdir(join(root, 'runtime', 'java'), { recursive: true });
  await writeFile(join(root, 'versions', 'a.jar'), 'old-a');
  await writeFile(join(root, 'runtime', 'java', 'bin'), 'old-runtime');
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ] as const;
  await writeFile(join(staging, ids[0]), 'new-a');
  await writeFile(join(staging, ids[1]), 'new-b');
  await mkdir(join(staging, 'runtime'));
  await writeFile(join(staging, 'runtime', 'bin'), 'new-runtime');
  const operations: InstallOperation[] = [
    {
      target: join(root, 'versions', 'a.jar'),
      staged: join(staging, ids[0]),
      backup: join(backups, ids[2]),
    },
    { target: join(root, 'libraries', 'b.jar'), staged: join(staging, ids[1]) },
    {
      target: join(root, 'runtime', 'java'),
      staged: join(staging, 'runtime'),
      backup: join(backups, ids[3]),
    },
  ];
  await mkdir(join(root, 'libraries'));
  return { lock, operations };
}
async function snapshot(root: string) {
  return {
    a: await readFile(join(root, 'versions', 'a.jar'), 'utf8'),
    b: await readFile(join(root, 'libraries', 'b.jar'), 'utf8').catch(() => null),
    runtime: await readFile(join(root, 'runtime', 'java', 'bin'), 'utf8'),
  };
}

describe('install transaction recovery', () => {
  it('rolls back a partially published journal in reverse order', async () => {
    const root = await tempRoot();
    const { lock, operations } = await installScenario(root);
    await writeInstallJournal(lock, root, operations);
    const { rename } = await import('node:fs/promises');
    const [first, second] = operations;
    if (!first?.backup || !second) throw new Error('fixture');
    await rename(first.target, first.backup);
    await rename(first.staged, first.target);
    await rename(second.staged, second.target);
    expect(await inspectInstallTransaction(root)).toEqual({
      state: 'rollback-needed',
      phase: 'publishing',
      operations: 3,
    });
    const report = await recoverServerEnvironment(root, { probe: fakeProbe() });
    expect(report.actions).toEqual([{ kind: 'install-rolled-back', operations: 3 }]);
    expect(await snapshot(root)).toEqual({ a: 'old-a', b: null, runtime: 'old-runtime' });
    expect(await readdir(root)).not.toContain(INSTALL_LOCK_DIRECTORY);
  });

  it('completes a fully published journal by discarding backups', async () => {
    const root = await tempRoot();
    const { lock, operations } = await installScenario(root);
    await writeInstallJournal(lock, root, operations);
    const { rename } = await import('node:fs/promises');
    for (const op of operations) {
      if (op.backup) await rename(op.target, op.backup);
      await rename(op.staged, op.target);
    }
    expect((await inspectInstallTransaction(root)).state).toBe('complete-needed');
    expect((await recoverInstallTransaction(root)).action).toEqual({
      kind: 'install-completed',
      operations: 3,
    });
    expect(await snapshot(root)).toEqual({ a: 'new-a', b: 'new-b', runtime: 'new-runtime' });
    expect(await readdir(root)).not.toContain(INSTALL_LOCK_DIRECTORY);
  });

  it('discards staging when interrupted before the journal was written', async () => {
    const root = await tempRoot();
    await installScenario(root);
    expect(await inspectInstallTransaction(root)).toEqual({
      state: 'rollback-needed',
      phase: 'staging',
      operations: 0,
    });
    expect((await recoverInstallTransaction(root)).action).toEqual({
      kind: 'install-staging-discarded',
    });
    expect(await snapshot(root)).toEqual({ a: 'old-a', b: null, runtime: 'old-runtime' });
  });

  it('leaves invalid journals and unexpected entries untouched', async () => {
    const outside = await tempRoot();
    await writeFile(join(outside, 'victim'), 'keep');
    const variants: [string, (root: string, ops: InstallOperation[]) => InstallOperation[]][] = [
      [
        'escaping target',
        (_r, ops) => [{ ...ops[1], target: join(outside, 'victim') } as InstallOperation],
      ],
      [
        'reserved target',
        (r, ops) => [
          { ...ops[1], target: join(r, '.torchlauncher-sync', 'x') } as InstallOperation,
        ],
      ],
      [
        'foreign staged',
        (_r, ops) => [{ ...ops[1], staged: join(outside, 'victim') } as InstallOperation],
      ],
      [
        'foreign backup',
        (_r, ops) => [{ ...ops[0], backup: join(outside, 'victim') } as InstallOperation],
      ],
    ];
    for (const [, mutate] of variants) {
      const root = await tempRoot();
      const { lock, operations } = await installScenario(root);
      await writeInstallJournal(lock, root, mutate(root, operations));
      const inspection = await inspectInstallTransaction(root);
      expect(inspection.state).toBe('invalid');
      const report = await recoverServerEnvironment(root, { probe: fakeProbe() });
      expect(report.status).toBe('incomplete');
      expect(report.issues[0]?.code).toBe('install-invalid');
      expect(await readdir(lock)).toContain('journal.json');
      expect(await readFile(join(outside, 'victim'), 'utf8')).toBe('keep');
      expect(await snapshot(root)).toEqual({ a: 'old-a', b: null, runtime: 'old-runtime' });
    }
    const root = await tempRoot();
    const { lock, operations } = await installScenario(root);
    await writeInstallJournal(lock, root, operations);
    await writeFile(join(lock, 'staging', 'unexpected'), 'x');
    expect(await inspectInstallTransaction(root)).toEqual({
      state: 'invalid',
      reason: 'unexpected-entry',
    });
    const other = await tempRoot();
    const second = await installScenario(other);
    await writeInstallJournal(second.lock, join(other, 'moved'), second.operations);
    expect(await inspectInstallTransaction(other)).toEqual({
      state: 'invalid',
      reason: 'journal-root-mismatch',
    });
  });

  it.skipIf(!canSymlink)(
    'rejects a symlinked target ancestor (needs symlink permission)',
    async () => {
      const root = await tempRoot();
      const outside = await tempRoot();
      const { lock, operations } = await installScenario(root);
      await rm(join(root, 'libraries'), { recursive: true });
      await symlink(outside, join(root, 'libraries'));
      await writeInstallJournal(lock, root, operations);
      expect(await inspectInstallTransaction(root)).toEqual({
        state: 'invalid',
        reason: 'unsafe-path',
      });
    },
  );
});

describe('environment inspection', () => {
  it('reports leftover synchronization and user-mod artifacts and requires a server ID', async () => {
    const root = await tempRoot();
    await mkdir(join(root, '.torchlauncher-sync'));
    await writeFile(join(root, '.torchlauncher-sync', 'journal.pending'), '{}');
    await mkdir(join(root, '.torchlauncher-user'));
    await writeFile(join(root, '.torchlauncher-user', 'mods-intent.json'), 'not json');
    const env = await inspectServerEnvironment(root, { probe: fakeProbe() });
    expect(env).toMatchObject({
      serverLock: { state: 'free' },
      install: { state: 'none' },
      synchronization: 'present',
      userMods: 'invalid',
      needsRecovery: true,
    });
    const report = await recoverServerEnvironment(root, { probe: fakeProbe() });
    expect(report).toMatchObject({
      status: 'incomplete',
      issues: [{ code: 'server-id-required' }],
    });
  });
});

it('automatically reclaims only an identified dead game lock with no unfinished transactions', async () => {
  for (const artifact of ['none', 'install', 'sync', 'mods', 'unknown', 'install-purpose']) {
    const root = await tempRoot();
    const probe = fakeProbe();
    await writeOwner(
      root,
      v2({
        pid: 500001,
        start: 'owner',
        purpose: artifact === 'install-purpose' ? 'install' : 'game',
        child: { state: 'running', pid: 500002, start: artifact === 'unknown' ? null : 'child' },
      }),
    );
    if (artifact === 'install') await mkdir(join(root, INSTALL_LOCK_DIRECTORY));
    if (artifact === 'sync') {
      await mkdir(join(root, '.torchlauncher-sync'));
      await writeFile(join(root, '.torchlauncher-sync/journal.json'), '{}');
    }
    if (artifact === 'mods') {
      await mkdir(join(root, '.torchlauncher-user'));
      await writeFile(join(root, '.torchlauncher-user/mods-intent.json'), '{}');
    }
    expect(await recoverExitedGameLock(root, { probe })).toBe(artifact === 'none');
    expect((await inspectServerEnvironment(root, { probe })).serverLock.state).toBe(
      artifact === 'none' ? 'free' : 'stale-verified',
    );
  }
});
