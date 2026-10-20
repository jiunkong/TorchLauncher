import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';
import { stat } from './filesystem';
import type { Installation } from './installer';
import { buildLaunchCommand, type LaunchCommand, type LaunchOptions } from './launch';
import { acquireServerDataLock } from './lock';
import { type GameLogLimits, type GameLogSnapshot, GameLogs } from './logs';

export type ProcessSpawner = (file: string, args: string[], options: SpawnOptions) => ChildProcess;
export interface GameProcessOptions {
  signal?: AbortSignal;
  terminationGraceMs?: number;
  logs?: GameLogLimits;
  /** Host/test boundary; the production default uses node:child_process.spawn. */
  spawn?: ProcessSpawner;
}
export interface GameExit {
  reason: 'exited' | 'stopped' | 'cancelled' | 'process-error' | 'lock-error';
  code: number | null;
  signal: NodeJS.Signals | null;
  errorCode?: string;
  logs: GameLogSnapshot;
}
export interface RunningGame {
  pid: number;
  finished: Promise<GameExit>;
  stop(): Promise<GameExit>;
  getLogs(): GameLogSnapshot;
}
export class GameStartError extends Error {
  constructor(readonly code: string) {
    super(`Java process could not start (${code})`);
    this.name = 'GameStartError';
  }
}
function safeErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' && /^E[A-Z0-9_]{1,40}$/.test(code) ? code : 'UNKNOWN';
}
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Game launch was aborted', 'AbortError');
}
async function start(
  command: LaunchCommand,
  secrets: string[],
  options: GameProcessOptions,
): Promise<RunningGame> {
  const grace = options.terminationGraceMs ?? 5000;
  if (!Number.isSafeInteger(grace) || grace < 0 || grace > 60_000)
    throw new Error('Invalid game termination grace period');
  const logs = new GameLogs(secrets, options.logs);
  aborted(options.signal);
  const lease = await acquireServerDataLock(command.cwd, 'game');
  let child: ChildProcess;
  try {
    aborted(options.signal);
    if (await stat(join(lease.root, '.torchlauncher-install-lock')))
      throw new GameStartError('EINSTALLRECOVERY');
    aborted(options.signal);
    child = (options.spawn ?? nodeSpawn)(command.executable, command.args, {
      cwd: lease.root,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    await lease.release();
    if (error instanceof GameStartError || (error instanceof Error && error.name === 'AbortError'))
      throw error;
    throw new GameStartError(safeErrorCode(error));
  }
  let reason: GameExit['reason'] = 'exited';
  let errorCode: string | undefined;
  let closed = false;
  let started = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveFinished: (result: GameExit) => void = () => {};
  const finished = new Promise<GameExit>((resolve) => {
    resolveFinished = resolve;
  });
  let resolveStarted: () => void = () => {};
  let rejectStarted: (error: Error) => void = () => {};
  const spawnResult = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const terminate = (requested: 'stopped' | 'cancelled') => {
    if (closed || reason === 'stopped' || reason === 'cancelled') return;
    reason = requested;
    try {
      child.kill('SIGTERM');
    } catch {
      errorCode = 'EKILL';
    }
    killTimer = setTimeout(() => {
      if (!closed) {
        try {
          child.kill('SIGKILL');
        } catch {
          errorCode = 'EKILL';
        }
      }
    }, grace);
    killTimer.unref();
  };
  const cancel = () => terminate('cancelled');
  const streamError = () => {
    errorCode = 'ELOGSTREAM';
    if (reason === 'exited') reason = 'process-error';
  };
  child.stdout?.on('error', streamError);
  child.stderr?.on('error', streamError);
  child.stdout?.on('data', (chunk: Buffer) => logs.write('stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => logs.write('stderr', chunk));
  child.on('error', (error) => {
    errorCode = safeErrorCode(error);
    if (!started) rejectStarted(new GameStartError(errorCode));
    else if (reason === 'exited') reason = 'process-error';
  });
  child.once('spawn', () => {
    started = true;
    resolveStarted();
  });
  child.once('close', (code, signal) => {
    closed = true;
    if (killTimer) clearTimeout(killTimer);
    options.signal?.removeEventListener('abort', cancel);
    logs.finish('stdout');
    logs.finish('stderr');
    // 'close' follows stream closure. Keep the server lease through all process/output activity.
    void lease
      .release()
      .catch(() => {
        reason = 'lock-error';
        errorCode = 'ELOCKRELEASE';
      })
      .then(() => {
        resolveFinished({
          reason,
          code,
          signal,
          ...(errorCode ? { errorCode } : {}),
          logs: logs.snapshot(),
        });
      });
  });
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    await spawnResult;
  } catch (error) {
    await finished;
    throw error;
  }
  return {
    pid: child.pid ?? 0,
    finished,
    stop: () => {
      terminate('stopped');
      return finished;
    },
    getLogs: () => logs.snapshot(),
  };
}
/** Authenticated game process. Never exposes original argv or a raw ChildProcess/Error object. */
export async function launchMinecraft(
  installation: Installation,
  launch: LaunchOptions,
  options: GameProcessOptions = {},
): Promise<RunningGame> {
  const auth = launch.auth;
  return start(
    buildLaunchCommand(installation, launch),
    [auth.accessToken, auth.profile.id, auth.profile.name, auth.xuid ?? '', auth.clientId],
    options,
  );
}
/** Account-free Java probe using the same lifecycle and server-data lock as game launch. */
export async function startJavaDiagnostic(
  installation: Installation,
  options: GameProcessOptions = {},
): Promise<RunningGame> {
  return start(
    {
      executable: installation.javaPath,
      args: ['-version'],
      cwd: installation.root,
      shell: false,
      redactedArgs: ['-version'],
    },
    [],
    options,
  );
}
