import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { systemProcessProbe } from '../identity';
import { acquireServerDataLock } from '../lock';
import { inspectServerEnvironment, recoverExitedGameLock } from './environment';

// Account-free real host lifecycle through production process.ts; only our temporary child is killed.
const HOST = `
import { registerHooks } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
  return next(specifier, context);
}});
const [root, src, mode] = process.argv.slice(2);
const { startJavaDiagnostic } = await import(pathToFileURL(join(src, 'process.ts')).href);
const game = await startJavaDiagnostic({ root, javaPath: process.execPath }, {
  detachable: true,
  spawn: (_, __, options) => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options),
});
await writeFile(join(root, 'fixture-child-pid'), String(game.pid));
if (mode !== 'crash') { try { await game.detach(); } catch (error) { await game.stop(); throw error; } }
process.stdout.write(JSON.stringify({ pid: game.pid }) + '\\n');
if (mode === 'crash') process.kill(process.pid, 'SIGKILL');
`;
for (const mode of ['quit', 'crash'])
  it(`keeps child alive and locked after real host ${mode}, then reclaims only after child exits`, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'torch-detach-host-')));
    const script = join(root, 'host.mjs');
    await writeFile(script, HOST);
    const source = dirname(dirname(fileURLToPath(import.meta.url)));
    const host = spawn(
      process.execPath,
      ['--experimental-transform-types', script, root, source, mode],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let pid = 0;
    let childEnded = false;
    let stderr = '';
    host.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => host.once('exit', resolve));
    try {
      const message = await new Promise<{ pid: number }>((resolve, reject) => {
        let output = '';
        host.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0] ?? ''));
        });
        void exited.then(() => reject(new Error(stderr)));
      });
      pid = message.pid;
      if (mode === 'quit') expect(await exited).toBe(0);
      else await exited;
      expect((await systemProcessProbe().process(pid)).state).toBe('running');
      const owner = await readFile(join(root, '.torchlauncher-server-lock/owner.json'), 'utf8');
      const environment = await inspectServerEnvironment(root);
      expect(environment.serverLock).toMatchObject({ state: 'held-live', childAlive: true });
      expect(await recoverExitedGameLock(root)).toBe(false);
      await expect(acquireServerDataLock(root, 'install')).rejects.toThrow();
      expect(await readFile(join(root, '.torchlauncher-server-lock/owner.json'), 'utf8')).toBe(
        owner,
      );
      process.kill(pid, 'SIGKILL');
      await vi.waitFor(
        async () =>
          expect((await inspectServerEnvironment(root)).serverLock.state).toBe('stale-verified'),
        { timeout: 15000 },
      );
      childEnded = true;
      expect(await recoverExitedGameLock(root)).toBe(true);
      expect((await inspectServerEnvironment(root)).serverLock.state).toBe('free');
      const lease = await acquireServerDataLock(root, 'game');
      await lease.release();
    } finally {
      if (!pid && !childEnded)
        pid = Number(await readFile(join(root, 'fixture-child-pid'), 'utf8').catch(() => '0'));
      if (pid && !childEnded) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);
