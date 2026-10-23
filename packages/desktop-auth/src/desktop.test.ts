import type { ChildProcess } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopPublicJavaAuthenticator, type SafeStorageBoundary } from './index';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

class Worker extends EventEmitter {
  connected = true;
  started: unknown;
  send(message: unknown, callback: (error: Error | null) => void) {
    this.started = message;
    callback(null);
  }
  kill() {
    this.connected = false;
    queueMicrotask(() => this.emit('close', 0));
    return true;
  }
}

it('isolates launcher and Studio sessions even with the same OS encryption boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-auth-isolation-'));
  directories.push(directory);
  const key = randomBytes(32);
  // Synthetic encryption only; does not claim a real OS keyring or account login.
  const safeStorage: SafeStorageBoundary = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
  const workers: Worker[] = [];
  const create = (name: string) =>
    createDesktopPublicJavaAuthenticator({
      cacheDirectory: join(directory, name, 'public-java'),
      workerPath: join(directory, name, 'public-java-worker.cjs'),
      safeStorage,
      showCode: async () => {},
      spawn: () => {
        const worker = new Worker();
        workers.push(worker);
        return worker as unknown as ChildProcess;
      },
    });
  for (const name of ['launcher', 'studio']) {
    const count = workers.length + 1;
    const pending = create(name).login();
    await vi.waitFor(() => {
      expect(workers).toHaveLength(count);
      expect(workers.at(-1)?.started).toBeDefined();
    });
    const worker = workers.at(-1);
    worker?.emit('message', {
      type: 'cache',
      id: 1,
      name: 'sisu',
      value: { token: `synthetic-${name}` },
    });
    worker?.emit('message', {
      type: 'result',
      value: {
        accessToken: 'synthetic-minecraft',
        expiresAt: Date.now() + 3_600_000,
        profile: { id: '0123456789abcdef0123456789abcdef', name: 'TorchPlayer' },
      },
    });
    await pending;
  }
  await create('launcher').logout();
  await expect(create('launcher').refresh()).rejects.toMatchObject({ code: 'no_session' });
  const refresh = create('studio').refresh();
  await vi.waitFor(() => expect(workers).toHaveLength(3));
  const studio = workers.at(-1);
  expect(studio?.started).toMatchObject({
    type: 'start',
    mode: 'refresh',
    snapshot: { caches: { sisu: { token: 'synthetic-studio' } } },
  });
  studio?.emit('message', { type: 'failure', code: 'network_failed', stage: 'oauth' });
  await expect(refresh).rejects.toMatchObject({ code: 'network_failed' });
});
