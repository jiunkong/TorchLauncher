import { type ChildProcess, fork } from 'node:child_process';
import {
  type AuthErrorCode,
  AuthenticationError,
  type AuthStage,
  type MinecraftAuthResult,
} from '@torchlauncher/core/auth';
import { HostAuthenticationError } from './errors';
import type { JavaCacheStore } from './public-java-cache';
import {
  authResult,
  cacheName,
  type JavaCacheSnapshot,
  record,
  snapshot,
} from './public-java-protocol';

export interface PublicJavaOptions {
  store: JavaCacheStore;
  workerPath: string;
  showCode(code: string, signal: AbortSignal): Promise<void>;
  timeoutMs?: number;
  spawn?: () => ChildProcess;
}

const failureCodes = new Set([
  'invalid_response',
  'http_failed',
  'network_failed',
  'storage_failed',
  'game_not_owned',
  'profile_required',
  'reauthentication_required',
  'cancelled',
]);
const failureStages = new Set([
  'oauth',
  'xbox',
  'xsts',
  'minecraft',
  'entitlements',
  'profile',
  'storage',
  'browser',
]);

/** Main-only broker. The Node child has no disk cache and cannot write after its gate closes. */
export class PublicJavaAuthenticator {
  private operation: Promise<MinecraftAuthResult> | undefined;
  private controller: AbortController | undefined;
  private loggingOut: Promise<void> | undefined;

  constructor(private readonly options: PublicJavaOptions) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs <= 0 ||
        options.timeoutMs > 600_000)
    )
      throw new AuthenticationError('invalid_configuration', 'configuration');
  }

  login(signal?: AbortSignal) {
    return this.run('login', signal);
  }
  refresh(signal?: AbortSignal) {
    return this.run('refresh', signal);
  }

  logout(): Promise<void> {
    if (this.loggingOut) return this.loggingOut;
    this.controller?.abort();
    const task = (async () => {
      await this.operation?.catch(() => {});
      try {
        await this.options.store.clear();
      } catch (error) {
        if (error instanceof HostAuthenticationError) throw error;
        throw new AuthenticationError('storage_failed', 'storage');
      }
    })();
    this.loggingOut = task;
    void task
      .finally(() => {
        this.loggingOut = undefined;
      })
      .catch(() => {});
    return task;
  }

  private run(mode: 'login' | 'refresh', external?: AbortSignal): Promise<MinecraftAuthResult> {
    if (this.operation || this.loggingOut)
      return Promise.reject(new AuthenticationError('busy', 'configuration'));
    const controller = new AbortController();
    this.controller = controller;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 300_000);
    const signal = AbortSignal.any([controller.signal, timeout, ...(external ? [external] : [])]);
    const task = this.execute(mode, signal, timeout).finally(() => {
      this.operation = undefined;
      this.controller = undefined;
    });
    this.operation = task;
    return task;
  }

  private async execute(mode: 'login' | 'refresh', signal: AbortSignal, timeout: AbortSignal) {
    const cancelled = () =>
      new AuthenticationError(timeout.aborted ? 'timeout' : 'cancelled', 'browser');
    let current: JavaCacheSnapshot | null;
    let abortRead: () => void = () => {};
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        abortRead = () => reject(cancelled());
        if (signal.aborted) abortRead();
        else signal.addEventListener('abort', abortRead, { once: true });
      });
      const stored = await Promise.race([this.options.store.read(), aborted]);
      current = stored === null ? null : snapshot(stored);
    } catch (error) {
      if (signal.aborted) throw cancelled();
      if (error instanceof HostAuthenticationError) throw error;
      throw new AuthenticationError('storage_failed', 'storage');
    } finally {
      signal.removeEventListener('abort', abortRead);
    }
    if (signal.aborted) throw cancelled();
    if (mode === 'refresh' && !current?.caches.sisu)
      throw new AuthenticationError('no_session', 'storage');
    let state = current ?? { version: 1 as const, caches: {} };
    const environment: NodeJS.ProcessEnv = { ...process.env, DEBUG: '', ELECTRON_RUN_AS_NODE: '1' };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    let child: ChildProcess;
    try {
      child =
        this.options.spawn?.() ??
        fork(this.options.workerPath, [], {
          env: environment,
          execArgv: [],
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
    } catch {
      throw new AuthenticationError('network_failed', 'oauth');
    }
    let closed = false;
    const close = new Promise<void>((resolve) =>
      child.once('close', () => {
        closed = true;
        resolve();
      }),
    );
    const ui = new AbortController();
    let gate = true;
    let accepting = true;
    let completing = false;
    let pending: Promise<void> = Promise.resolve();
    let showCode = false;
    let lastCacheId = 0;
    let onAbort: () => void = () => {};
    try {
      return await new Promise<MinecraftAuthResult>((resolve, reject) => {
        const fail = (error: AuthenticationError) => {
          gate = false;
          accepting = false;
          reject(error);
        };
        onAbort = () => fail(cancelled());
        signal.addEventListener('abort', onAbort, { once: true });
        child.once('error', () => fail(new AuthenticationError('network_failed', 'oauth')));
        child.once('close', () => {
          if (!completing) fail(new AuthenticationError('network_failed', 'oauth'));
        });
        const send = (message: unknown) => {
          if (!gate || !child.connected) return;
          try {
            child.send(message as object, (error) => {
              if (error) fail(new AuthenticationError('network_failed', 'oauth'));
            });
          } catch {
            fail(new AuthenticationError('network_failed', 'oauth'));
          }
        };
        child.on('message', (raw) => {
          if (!accepting || !gate) return;
          try {
            const message = record(raw);
            if (message.type === 'cache') {
              if (message.id !== lastCacheId + 1 || lastCacheId >= 128)
                throw new AuthenticationError('invalid_response', 'storage');
              lastCacheId++;
              const name = cacheName(message.name);
              state = snapshot({
                version: 1,
                caches: { ...state.caches, [name]: record(message.value) },
              });
              const next = state;
              pending = pending
                .then(async () => {
                  if (!gate) return;
                  await this.options.store.write(next);
                  send({ type: 'ack', id: message.id, ok: true });
                })
                .catch(() => fail(new AuthenticationError('storage_failed', 'storage')));
            } else if (message.type === 'device') {
              if (mode === 'refresh')
                throw new AuthenticationError('reauthentication_required', 'oauth');
              if (
                showCode ||
                typeof message.code !== 'string' ||
                !/^[A-Z0-9-]{4,16}$/.test(message.code) ||
                typeof message.expiresIn !== 'number' ||
                message.expiresIn <= 0 ||
                message.expiresIn > 3600
              )
                throw new AuthenticationError('invalid_response', 'browser');
              showCode = true;
              void this.options.showCode(message.code, ui.signal).catch((error: unknown) => {
                if (!ui.signal.aborted)
                  fail(
                    new AuthenticationError(
                      error instanceof HostAuthenticationError && error.code === 'cancelled'
                        ? 'cancelled'
                        : 'browser_failed',
                      'browser',
                    ),
                  );
              });
            } else if (message.type === 'result') {
              const result = authResult(message.value);
              accepting = false;
              completing = true;
              void pending.then(() => {
                if (gate) {
                  gate = false;
                  resolve(result);
                }
              });
            } else if (message.type === 'failure') {
              if (
                !failureCodes.has(String(message.code)) ||
                !failureStages.has(String(message.stage)) ||
                (message.status !== undefined &&
                  (!Number.isSafeInteger(message.status) ||
                    Number(message.status) < 100 ||
                    Number(message.status) > 599))
              )
                throw new AuthenticationError('invalid_response', 'minecraft');
              fail(
                new AuthenticationError(
                  message.code as AuthErrorCode,
                  message.stage as AuthStage,
                  message.status as number | undefined,
                ),
              );
            } else throw new AuthenticationError('invalid_response', 'minecraft');
          } catch (error) {
            fail(
              error instanceof AuthenticationError
                ? error
                : new AuthenticationError('invalid_response', 'minecraft'),
            );
          }
        });
        if (signal.aborted) onAbort();
        else send({ type: 'start', mode, snapshot: state });
      });
    } finally {
      gate = false;
      accepting = false;
      ui.abort();
      signal.removeEventListener('abort', onAbort);
      if (!closed) child.kill('SIGTERM');
      const kill = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 1000);
      kill.unref();
      await close;
      clearTimeout(kill);
      await pending;
      child.removeAllListeners();
    }
  }
}
