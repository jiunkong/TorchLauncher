import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import realVersion from './fixtures/1.21.1.json';
import { fixture } from './fixtures/installation';
import { type Installation, installMinecraft } from './installer';
import type { LaunchOptions } from './launch';
import { acquireServerDataLock } from './lock';
import { parseVersion } from './metadata';
import {
  GameStartError,
  launchMinecraft,
  type ProcessSpawner,
  type RunningGame,
  startJavaDiagnostic,
} from './process';

const roots: string[] = [];
const processes: RunningGame[] = [];
async function installation(): Promise<Installation> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-game-process-'));
  roots.push(root);
  return {
    root,
    platform: { os: 'linux', arch: 'x64', version: '6.1' },
    javaPath: process.execPath,
    version: parseVersion(realVersion),
    classpath: [],
    nativesDirectory: root,
    assetsDirectory: root,
  };
}
const launch: LaunchOptions = {
  auth: {
    accessToken: 'private-test-token',
    expiresAt: 9999,
    profile: { id: '1234567890abcdef1234567890abcdef', name: 'TestPlayer' },
    userType: 'msa',
    clientId: 'public-client',
    xuid: '98765',
  },
  now: 1000,
  launcherVersion: '0.1.0',
};
function node(script: string): ProcessSpawner {
  return (_, __, options) => spawn(process.execPath, ['-e', script], options);
}
afterEach(async () => {
  await Promise.all(processes.splice(0).map((process) => process.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('managed Java lifecycle', () => {
  it('uses no shell and collects redacted stdout/stderr through nonzero exit', async () => {
    const installed = await installation();
    const adapter = vi.fn(
      node(
        `console.log('private-test-'+'token TestPlayer 1234567890abcdef1234567890abcdef'); console.error('98765 public-client'); process.exitCode=7;`,
      ),
    );
    const game = await launchMinecraft(installed, launch, { spawn: adapter });
    processes.push(game);
    const result = await game.finished;
    expect(adapter.mock.calls[0]?.[2]).toMatchObject({
      shell: false,
      cwd: installed.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toMatchObject({ reason: 'exited', code: 7 });
    const output = JSON.stringify(result);
    for (const secret of [
      launch.auth.accessToken,
      launch.auth.profile.id,
      launch.auth.profile.name,
      launch.auth.xuid,
      launch.auth.clientId,
    ])
      expect(output).not.toContain(secret);
    expect(await readdir(installed.root)).not.toContain('.torchlauncher-server-lock');
  });
  it('handles output stream errors without exposing their raw messages or crashing the host', async () => {
    const installed = await installation();
    const adapter: ProcessSpawner = (_, __, options) => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},25)'], options);
      setImmediate(() => child.stdout?.emit('error', new Error(launch.auth.accessToken)));
      return child;
    };
    const game = await launchMinecraft(installed, launch, { spawn: adapter });
    processes.push(game);
    const result = await game.finished;
    expect(result).toMatchObject({ reason: 'process-error', errorCode: 'ELOGSTREAM' });
    expect(JSON.stringify(result)).not.toContain(launch.auth.accessToken);
  });
  it('maps asynchronous spawn errors safely and releases the lease', async () => {
    const installed = await installation();
    installed.javaPath = join(installed.root, 'missing-java');
    await expect(launchMinecraft(installed, launch)).rejects.toBeInstanceOf(GameStartError);
    try {
      await launchMinecraft(installed, launch);
    } catch (error) {
      expect(String(error)).not.toContain(launch.auth.accessToken);
      expect(error).not.toHaveProperty('cause');
    }
    expect(await readdir(installed.root)).not.toContain('.torchlauncher-server-lock');
  });
  it('maps synchronous spawn exceptions without retaining argv/error causes', async () => {
    const installed = await installation();
    await expect(
      launchMinecraft(installed, launch, {
        spawn: () => {
          throw new Error(launch.auth.accessToken);
        },
      }),
    ).rejects.toThrow('UNKNOWN');
    expect(await readdir(installed.root)).not.toContain('.torchlauncher-server-lock');
  });
  it('blocks installation, maintenance and a second launch until process closure', async () => {
    const installed = await installation();
    const data = fixture();
    const game = await launchMinecraft(installed, launch, {
      spawn: node('setInterval(()=>{},1000)'),
    });
    processes.push(game);
    await expect(acquireServerDataLock(installed.root, 'maintenance')).rejects.toThrow(
      'Server data is in use',
    );
    await expect(launchMinecraft(installed, launch)).rejects.toThrow('Server data is in use');
    await expect(
      installMinecraft({
        root: installed.root,
        platform: data.platform,
        download: data.downloader,
      }),
    ).rejects.toThrow('Server data is in use');
    expect(data.requests).toEqual([]);
    const result = await game.stop();
    expect(result.reason).toBe('stopped');
    const lease = await acquireServerDataLock(installed.root, 'maintenance');
    await lease.release();
    await lease.release();
  });
  it('cancels a running process, escalates when needed, and waits for close', async () => {
    const installed = await installation();
    const controller = new AbortController();
    const game = await launchMinecraft(installed, launch, {
      spawn: node("process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"),
      signal: controller.signal,
      terminationGraceMs: 25,
    });
    processes.push(game);
    for (
      let count = 0;
      count < 100 && !game.getLogs().entries.some((entry) => entry.text === 'ready');
      count++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await game.finished;
    expect(result.reason).toBe('cancelled');
    if (process.platform !== 'win32') expect(result.signal).toBe('SIGKILL');
    expect(await readdir(installed.root)).not.toContain('.torchlauncher-server-lock');
  });
  it('never spawns for pre-cancelled requests or unresolved install recovery', async () => {
    const installed = await installation();
    const adapter = vi.fn(node(''));
    await expect(
      launchMinecraft(installed, launch, { spawn: adapter, signal: AbortSignal.abort() }),
    ).rejects.toThrow('aborted');
    await mkdir(join(installed.root, '.torchlauncher-install-lock'));
    await expect(launchMinecraft(installed, launch, { spawn: adapter })).rejects.toThrow(
      'EINSTALLRECOVERY',
    );
    expect(adapter).not.toHaveBeenCalled();
    expect(await readdir(installed.root)).not.toContain('.torchlauncher-server-lock');
  });
  it('runs an account-free Java diagnostic with the same process/lock boundary', async () => {
    const installed = await installation();
    const adapter = vi.fn(node("console.error('openjdk version 21.0.7')"));
    const game = await startJavaDiagnostic(installed, { spawn: adapter });
    processes.push(game);
    expect((await game.finished).code).toBe(0);
    expect(adapter.mock.calls[0]?.[1]).toEqual(['-version']);
  });
});
