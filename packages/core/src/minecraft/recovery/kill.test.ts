import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemProcessProbe } from '../identity';
import { INSTALL_LOCK_DIRECTORY, type InstallOperation } from '../install-transaction';
import { SERVER_LOCK_DIRECTORY } from '../lock';
import { inspectServerEnvironment, recoverServerEnvironment } from './index';

/**
 * Real process-kill scenarios (Linux and Windows). A synthetic host runs the production lock and
 * install-transaction modules through Node type stripping and is force-killed (SIGKILL on Linux,
 * TerminateProcess on Windows; the exit signal is platform dependent, so it is judged by outcome).
 */
const SOURCE = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = `
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({
  resolve(specifier, context, next) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier))
      return next(specifier + '.ts', context);
    return next(specifier, context);
  },
});
const [mode, root, src, extra] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(join(src, path)).href);
const lock = await load('lock.ts');
const { systemProcessProbe } = await load('identity.ts');
const tx = await load('install-transaction.ts');
const say = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const die = () => {
  process.kill(process.pid, 'SIGKILL');
  // Only reached if the platform did not terminate us synchronously.
  process.exit(137);
};
if (mode === 'game') {
  const lease = await lock.acquireServerDataLock(root, 'game');
  await lease.recordChild({ state: 'starting' });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  detached: extra === 'detached',
});
if (extra === 'detached') child.unref();
  await new Promise((resolve) => child.once('spawn', resolve));
  const state = await systemProcessProbe().process(child.pid);
  await lease.recordChild({ state: 'running', pid: child.pid, start: state.start ?? null });
  say({ child: child.pid });
  setInterval(() => {}, 1000);
} else if (mode === 'install') {
  const plan = JSON.parse(readFileSync(extra, 'utf8'));
  await lock.acquireServerDataLock(root, 'install');
  const dir = join(root, tx.INSTALL_LOCK_DIRECTORY);
  await tx.writeInstallJournal(dir, root, plan.operations);
  let renames = 0;
  await tx.publishInstallOperations(dir, plan.operations, {
    afterRename: () => { if (++renames === plan.killAfter) die(); },
  });
  say({ finished: true });
} else if (mode === 'recover') {
  const { snapshotServerLock } = await load('recovery/lock-assessment.ts');
  const { recoverInstallTransaction } = await load('recovery/install.ts');
  const probe = systemProcessProbe();
  const snapshot = await snapshotServerLock(root, probe);
  if (snapshot.assessment.state !== 'stale-verified') throw new Error('not stale');
  await lock.reclaimServerDataLock(root, snapshot.ownerText, { probe });
  let steps = 0;
  await recoverInstallTransaction(root, { afterStep: () => { if (++steps === Number(extra)) die(); } });
  say({ finished: true });
}
`;

const probe = createSystemProcessProbe();
const cleanup: string[] = [];
const pids: number[] = [];
// A dead child is reported as child-exited, or child-pid-reused when the OS (notably Windows, which
// recycles PIDs very quickly) hands the PID to another process; the product treats both as dead.
const CHILD_DEAD = expect.stringMatching(/^child-(exited|pid-reused)$/);
afterEach(async () => {
  for (const pid of pids.splice(0))
    try {
      process.kill(pid, 'SIGKILL'); // TerminateProcess on Windows
    } catch {
      // Already gone.
    }
  for (const path of cleanup.splice(0))
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), prefix));
  cleanup.push(path);
  return path;
}
async function hostScript(): Promise<string> {
  const path = join(await tempDir('torch-kill-host-'), 'host.mjs');
  await writeFile(path, HOST);
  return path;
}
interface Host {
  child: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  message: Promise<Record<string, unknown>>;
  stderr: () => string;
}
function runHost(script: string, args: string[]): Host {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (child.pid) pids.push(child.pid);
  let err = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    err += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const message = new Promise<Record<string, unknown>>((resolve, reject) => {
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split('\n')[0];
      if (out.includes('\n') && line) resolve(JSON.parse(line));
    });
    void exited.then(() => reject(new Error(`host exited before reporting: ${err}`)));
  });
  message.catch(() => undefined);
  return { child, exited, message, stderr: () => err };
}
async function waitAbsent(pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await probe.process(pid)).state === 'absent') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('process did not exit');
}

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;
/** Old a.jar + old runtime tree, new b.jar; 5 renames in total when fully published. */
async function scenario(root: string): Promise<{ operations: InstallOperation[] }> {
  const staging = join(root, INSTALL_LOCK_DIRECTORY, 'staging');
  const backups = join(root, INSTALL_LOCK_DIRECTORY, 'backups');
  await mkdir(staging, { recursive: true });
  await mkdir(backups);
  await mkdir(join(root, 'versions'));
  await mkdir(join(root, 'libraries'));
  await mkdir(join(root, 'runtime', 'java'), { recursive: true });
  await writeFile(join(root, 'versions', 'a.jar'), 'old-a');
  await writeFile(join(root, 'runtime', 'java', 'bin'), 'old-runtime');
  await writeFile(join(staging, IDS[0]), 'new-a');
  await writeFile(join(staging, IDS[1]), 'new-b');
  await mkdir(join(staging, 'runtime'));
  await writeFile(join(staging, 'runtime', 'bin'), 'new-runtime');
  return {
    operations: [
      {
        target: join(root, 'versions', 'a.jar'),
        staged: join(staging, IDS[0]),
        backup: join(backups, IDS[2]),
      },
      { target: join(root, 'libraries', 'b.jar'), staged: join(staging, IDS[1]) },
      {
        target: join(root, 'runtime', 'java'),
        staged: join(staging, 'runtime'),
        backup: join(backups, IDS[3]),
      },
    ],
  };
}
async function files(root: string) {
  return {
    a: await readFile(join(root, 'versions', 'a.jar'), 'utf8'),
    b: await readFile(join(root, 'libraries', 'b.jar'), 'utf8').catch(() => null),
    runtime: await readFile(join(root, 'runtime', 'java', 'bin'), 'utf8'),
  };
}
/** A forced kill is never a clean exit: SIGKILL on Linux, a non-zero exit code on Windows. */
function wasKilled(exit: { code: number | null; signal: NodeJS.Signals | null }): boolean {
  return process.platform === 'win32' ? exit.code !== 0 : exit.signal === 'SIGKILL';
}
const OLD = { a: 'old-a', b: null, runtime: 'old-runtime' };
const NEW = { a: 'new-a', b: 'new-b', runtime: 'new-runtime' };
async function killedInstall(script: string, killAfter: number): Promise<string> {
  const root = await tempDir('torch-kill-root-');
  const plan = { ...(await scenario(root)), killAfter };
  const planPath = join(await tempDir('torch-kill-plan-'), 'plan.json');
  await writeFile(planPath, JSON.stringify(plan));
  const host = runHost(script, ['install', root, SOURCE, planPath]);
  const exit = await host.exited;
  expect(wasKilled(exit), `${JSON.stringify(exit)} ${host.stderr()}`).toBe(true);
  return root;
}

describe.runIf(process.platform === 'linux' || process.platform === 'win32')(
  'forced-kill recovery (real processes, Linux and Windows)',
  { timeout: 60_000 },
  () => {
    // Linux only: the game child is reparented and survives a SIGKILLed host. On Windows a
    // force-killed host takes its child down with it (observed on Windows 11 / Node 24: the
    // child probe is `absent` right after the host exits), so the lock is correctly stale-verified;
    // that behaviour is asserted by the Windows-specific test below.
    it.runIf(process.platform === 'linux')(
      'keeps the lock while the game child outlives a killed host, then reclaims',
      async () => {
        const script = await hostScript();
        const root = await tempDir('torch-kill-root-');
        const host = runHost(script, ['game', root, SOURCE]);
        const { child } = await host.message;
        if (typeof child !== 'number') throw new Error(host.stderr());
        pids.push(child);
        host.child.kill('SIGKILL'); // TerminateProcess on Windows
        await host.exited;

        const live = await inspectServerEnvironment(root);
        expect(live.serverLock).toMatchObject({
          state: 'held-live',
          purpose: 'game',
          evidence: ['owner-exited', 'child-alive'],
          childAlive: true,
        });
        const refused = await recoverServerEnvironment(root, { acceptUncertain: true });
        expect(refused.status).toBe('blocked');
        expect(await readdir(root)).toContain(SERVER_LOCK_DIRECTORY);

        process.kill(child, 'SIGKILL');
        await waitAbsent(child);
        const stale = await inspectServerEnvironment(root);
        expect(stale.serverLock).toMatchObject({
          state: 'stale-verified',
          evidence: ['owner-exited', CHILD_DEAD],
        });
        const report = await recoverServerEnvironment(root);
        expect(report).toMatchObject({
          status: 'recovered',
          actions: [{ kind: 'server-lock-reclaimed', basis: 'verified' }],
        });
        expect(report.environment.serverLock.state).toBe('free');
      },
    );

    // Windows counterpart: the child dies with the force-killed host (job-object-like behaviour),
    // so no live child remains and the lock is stale-verified right away.
    it.runIf(process.platform === 'win32')(
      'reclaims a game lock when the killed host takes its child down (Windows)',
      async () => {
        const script = await hostScript();
        const root = await tempDir('torch-kill-root-');
        const host = runHost(script, ['game', root, SOURCE]);
        const { child } = await host.message;
        if (typeof child !== 'number') throw new Error(host.stderr());
        pids.push(child);
        host.child.kill('SIGKILL'); // TerminateProcess
        await host.exited;
        await waitAbsent(child);

        const stale = await inspectServerEnvironment(root);
        expect(stale.serverLock).toMatchObject({
          state: 'stale-verified',
          purpose: 'game',
          evidence: ['owner-exited', CHILD_DEAD],
        });
        const report = await recoverServerEnvironment(root);
        expect(report).toMatchObject({
          status: 'recovered',
          actions: [{ kind: 'server-lock-reclaimed', basis: 'verified' }],
        });
        expect(report.environment.serverLock.state).toBe('free');
      },
    );

    // Windows: a child started detached (own process group, not tied to the host) survives the
    // force-killed host, so the lock must stay held-live until that child exits.
    it.runIf(process.platform === 'win32')(
      'keeps the lock while a detached game child outlives a killed host (Windows)',
      async () => {
        const script = await hostScript();
        const root = await tempDir('torch-kill-root-');
        const host = runHost(script, ['game', root, SOURCE, 'detached']);
        const { child } = await host.message;
        if (typeof child !== 'number') throw new Error(host.stderr());
        pids.push(child);
        host.child.kill('SIGKILL'); // TerminateProcess
        await host.exited;

        const live = await inspectServerEnvironment(root);
        expect(live.serverLock).toMatchObject({
          state: 'held-live',
          purpose: 'game',
          evidence: ['owner-exited', 'child-alive'],
          childAlive: true,
        });
        const refused = await recoverServerEnvironment(root, { acceptUncertain: true });
        expect(refused.status).toBe('blocked');
        expect(await readdir(root)).toContain(SERVER_LOCK_DIRECTORY);

        process.kill(child, 'SIGKILL'); // TerminateProcess
        await waitAbsent(child);
        const stale = await inspectServerEnvironment(root);
        expect(stale.serverLock).toMatchObject({
          state: 'stale-verified',
          evidence: ['owner-exited', CHILD_DEAD],
        });
        const report = await recoverServerEnvironment(root);
        expect(report).toMatchObject({
          status: 'recovered',
          actions: [{ kind: 'server-lock-reclaimed', basis: 'verified' }],
        });
        expect(report.environment.serverLock.state).toBe('free');
      },
    );

    it('detects PID reuse through the start identifier and keeps v1 locks uncertain', async () => {
      const root = await tempDir('torch-kill-root-');
      const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (!sleeper.pid) throw new Error('spawn failed');
      pids.push(sleeper.pid);
      await new Promise((resolve) => sleeper.once('spawn', resolve));
      const real = await probe.process(sleeper.pid);
      if (real.state !== 'running') throw new Error('probe failed');
      const machine = (await probe.host()).machine;
      const owner = (start: string) => ({
        version: 2,
        id: '6f1c2b0a-1d2e-4f3a-8b9c-0d1e2f3a4b5c',
        pid: sleeper.pid,
        purpose: 'install',
        start,
        host: { machine },
        child: null,
      });
      await mkdir(join(root, SERVER_LOCK_DIRECTORY));
      const ownerPath = join(root, SERVER_LOCK_DIRECTORY, 'owner.json');
      await writeFile(ownerPath, JSON.stringify(owner(real.start)));
      expect((await inspectServerEnvironment(root)).serverLock.state).toBe(
        machine ? 'held-live' : 'uncertain',
      );
      await writeFile(ownerPath, JSON.stringify(owner(`${real.start}0`)));
      expect((await inspectServerEnvironment(root)).serverLock).toMatchObject(
        machine
          ? { state: 'stale-verified', evidence: ['owner-pid-reused'] }
          : { state: 'uncertain', evidence: ['host-unknown'] },
      );
      await writeFile(
        ownerPath,
        JSON.stringify({ version: 1, id: owner('x').id, pid: sleeper.pid, purpose: 'game' }),
      );
      expect((await inspectServerEnvironment(root)).serverLock).toMatchObject({
        state: 'uncertain',
        evidence: ['owner-v1'],
      });
      expect((await recoverServerEnvironment(root)).status).toBe('blocked');
    });

    it('rolls back an install killed mid-publication and completes one killed after it', async () => {
      const script = await hostScript();
      for (const killAfter of [1, 2, 3, 4]) {
        const root = await killedInstall(script, killAfter);
        const env = await inspectServerEnvironment(root);
        expect(env.serverLock.state).toBe('stale-verified');
        expect(env.install).toMatchObject({ state: 'rollback-needed', phase: 'publishing' });
        const report = await recoverServerEnvironment(root);
        expect(report.status).toBe('recovered');
        expect(report.actions.map((action) => action.kind)).toEqual([
          'server-lock-reclaimed',
          'install-rolled-back',
        ]);
        expect(await files(root)).toEqual(OLD);
        expect(await readdir(root)).not.toContain(INSTALL_LOCK_DIRECTORY);
        expect(await readdir(root)).not.toContain(SERVER_LOCK_DIRECTORY);
      }
      const root = await killedInstall(script, 5);
      expect((await inspectServerEnvironment(root)).install.state).toBe('complete-needed');
      const report = await recoverServerEnvironment(root);
      expect(report.actions.map((action) => action.kind)).toContain('install-completed');
      expect(await files(root)).toEqual(NEW);
      expect(await readdir(root)).not.toContain(INSTALL_LOCK_DIRECTORY);
    });

    it('resumes a recovery that was itself killed at every step (idempotent)', async () => {
      const script = await hostScript();
      for (let step = 1; step <= 9; step++) {
        const root = await killedInstall(script, 3);
        const recover = runHost(script, ['recover', root, SOURCE, String(step)]);
        const exit = await recover.exited;
        if (!wasKilled(exit)) {
          // Fewer steps than `step`: the recovery finished normally.
          expect(exit.code, recover.stderr()).toBe(0);
          expect(await files(root)).toEqual(OLD);
          break;
        }
        const env = await inspectServerEnvironment(root);
        expect(env.serverLock.state).toBe('stale-verified');
        expect(env.install.state).not.toBe('invalid');
        const report = await recoverServerEnvironment(root);
        expect(report.status, JSON.stringify(report.issues)).toBe('recovered');
        expect(await files(root)).toEqual(OLD);
        expect(await readdir(root)).not.toContain(INSTALL_LOCK_DIRECTORY);
        expect(report.environment.needsRecovery).toBe(false);
      }
    });
  },
);
