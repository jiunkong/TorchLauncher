import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { PublicJavaAuthenticator } from './public-java';
import type { JavaCacheStore } from './public-java-cache';
import type { JavaCacheSnapshot } from './public-java-protocol';

class Worker extends EventEmitter {
  connected = true;
  messages: unknown[] = [];
  kill = vi.fn(() => {
    this.connected = false;
    queueMicrotask(() => this.emit('close', 0));
    return true;
  });
  send(message: unknown, callback: (error: Error | null) => void) {
    this.messages.push(message);
    callback(null);
    return true;
  }
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const worker = new Worker();
  let saved: JavaCacheSnapshot | null = {
    version: 1,
    caches: { sisu: { token: { refresh_token: 'synthetic-refresh' } } },
  };
  const store: JavaCacheStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => {
      saved = value;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  const spawn = vi.fn(() => worker as unknown as ChildProcess);
  const showCode = vi.fn<(code: string, signal: AbortSignal) => Promise<void>>(async () => {});
  const auth = new PublicJavaAuthenticator({
    store,
    spawn,
    workerPath: '/synthetic-worker.cjs',
    showCode,
    timeoutMs: 1000,
  });
  const started = () =>
    vi.waitFor(() => expect(worker.messages[0]).toMatchObject({ type: 'start' }));
  const result = () =>
    worker.emit('message', {
      type: 'result',
      value: {
        accessToken: 'synthetic-minecraft',
        expiresAt: Date.now() + 3_600_000,
        profile: { id: '0123456789abcdef0123456789abcdef', name: 'TorchPlayer' },
      },
    });
  return { worker, store, spawn, showCode, auth, started, result, saved: () => saved };
}

describe('public Java worker lifecycle', () => {
  it('waits for encrypted cache writes before returning a validated account and reaps the child', async () => {
    const ctx = setup();
    const write = deferred();
    vi.mocked(ctx.store.write).mockImplementation(async () => write.promise);
    const pending = ctx.auth.login();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await ctx.started();
    ctx.worker.emit('message', {
      type: 'cache',
      id: 1,
      name: 'sisu',
      value: { token: 'synthetic' },
    });
    await vi.waitFor(() => expect(ctx.store.write).toHaveBeenCalledOnce());
    ctx.result();
    await Promise.resolve();
    expect(settled).toBe(false);
    write.resolve();
    await expect(pending).resolves.toMatchObject({ clientId: '00000000402b5328', userType: 'msa' });
    expect(ctx.worker.kill).toHaveBeenCalled();
  });

  it('closes the write gate, kills the worker, drains prior writes, then clears on logout', async () => {
    const ctx = setup();
    const write = deferred();
    vi.mocked(ctx.store.write).mockImplementation(async () => write.promise);
    const task = ctx.auth.login().catch((error: unknown) => error);
    await ctx.started();
    ctx.worker.emit('message', {
      type: 'cache',
      id: 1,
      name: 'sisu',
      value: { token: 'before-logout' },
    });
    await vi.waitFor(() => expect(ctx.store.write).toHaveBeenCalledOnce());
    const logout = ctx.auth.logout();
    ctx.worker.emit('message', { type: 'cache', id: 2, name: 'mca', value: { token: 'late' } });
    expect(ctx.store.clear).not.toHaveBeenCalled();
    write.resolve();
    await logout;
    expect(await task).toMatchObject({ code: 'cancelled' });
    expect(ctx.store.clear).toHaveBeenCalledOnce();
    expect(ctx.store.write).toHaveBeenCalledOnce();
    expect(ctx.saved()).toBeNull();
    ctx.worker.emit('message', {
      type: 'cache',
      id: 3,
      name: 'mca',
      value: { token: 'after-clear' },
    });
    expect(ctx.store.write).toHaveBeenCalledOnce();
  });

  it('reports storage failure without retaining the provider error and terminates the child', async () => {
    const ctx = setup();
    vi.mocked(ctx.store.write).mockRejectedValue(new Error('private-storage-path-and-token'));
    const task = ctx.auth.login().catch((error: unknown) => error);
    await ctx.started();
    ctx.worker.emit('message', { type: 'cache', id: 1, name: 'sisu', value: {} });
    const error = await task;
    expect(error).toMatchObject({ code: 'storage_failed', stage: 'storage' });
    expect(String(error)).not.toContain('private-storage-path-and-token');
    expect(ctx.worker.kill).toHaveBeenCalled();
  });

  it('does not spawn for a cancelled or missing refresh session', async () => {
    const ctx = setup();
    await expect(ctx.auth.login(AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' });
    vi.mocked(ctx.store.read).mockResolvedValue(null);
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'no_session' });
    expect(ctx.spawn).not.toHaveBeenCalled();
  });

  it('bounds a worker that never replies and rejects concurrent operations', async () => {
    const ctx = setup();
    const auth = new PublicJavaAuthenticator({
      store: ctx.store,
      spawn: ctx.spawn,
      workerPath: '/worker',
      showCode: ctx.showCode,
      timeoutMs: 25,
    });
    const task = auth.login();
    await expect(auth.login()).rejects.toMatchObject({ code: 'busy' });
    await expect(task).rejects.toMatchObject({ code: 'timeout' });
    expect(ctx.worker.kill).toHaveBeenCalled();
  });

  it('keeps device codes local and removes all raw worker error fields', async () => {
    const ctx = setup();
    const code = randomBytes(4).toString('hex').toUpperCase();
    const task = ctx.auth.login().catch((error: unknown) => error);
    await ctx.started();
    ctx.worker.emit('message', { type: 'device', code, expiresIn: 300 });
    expect(ctx.showCode).toHaveBeenCalledWith(code, expect.any(AbortSignal));
    ctx.worker.emit('message', {
      type: 'failure',
      code: 'http_failed',
      stage: 'minecraft',
      status: 403,
      body: code,
      token: 'provider-secret',
    });
    const error = await task;
    expect(error).toMatchObject({ code: 'http_failed', status: 403 });
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(code);
    expect(JSON.stringify(error)).not.toContain('provider-secret');
    expect(ctx.showCode.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it('does not open a device prompt during refresh', async () => {
    const ctx = setup();
    const task = ctx.auth.refresh().catch((error: unknown) => error);
    await ctx.started();
    ctx.worker.emit('message', {
      type: 'device',
      code: randomBytes(4).toString('hex').toUpperCase(),
      expiresIn: 300,
    });
    expect(await task).toMatchObject({ code: 'reauthentication_required' });
    expect(ctx.showCode).not.toHaveBeenCalled();
  });
});
