import { fork } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('bundles a standalone Studio consumer and pinned private worker without Electron or node_modules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-auth-consumer-'));
  try {
    const output = join(directory, 'build');
    await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      build: {
        ssr: true,
        outDir: output,
        rollupOptions: {
          input: {
            studio: fileURLToPath(new URL('../examples/studio-main.ts', import.meta.url)),
            'public-java-worker': fileURLToPath(
              import.meta.resolve('@torchlauncher/desktop-auth/worker'),
            ),
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
            chunkFileNames: 'chunks/[name]-[hash].cjs',
          },
        },
      },
    });
    const standalone = join(directory, 'standalone');
    await cp(output, standalone, { recursive: true });
    const consumer = createRequire(import.meta.url)(join(standalone, 'studio.cjs')) as {
      createStudioAuthentication: (host: unknown) => { refresh(): Promise<unknown> };
    };
    const auth = consumer.createStudioAuthentication({
      userData: join(directory, 'studio-user-data'),
      mainDirectory: standalone,
      safeStorage: {
        isEncryptionAvailable: () => false,
        getSelectedStorageBackend: () => 'basic_text',
      },
      showCode: async () => {},
    });
    await expect(auth.refresh()).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
    const worker = fork(join(standalone, 'public-java-worker.cjs'), [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, DEBUG: '', NODE_OPTIONS: '' },
    });
    const closed = new Promise<void>((resolve) => worker.once('close', () => resolve()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = new Promise<unknown>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Worker self-check timed out')), 10_000);
        worker.once('message', resolve);
        worker.once('error', () => reject(new Error('Worker self-check failed')));
        worker.once('close', () => reject(new Error('Worker closed before self-check')));
      });
      worker.send({ type: 'self-check' });
      await expect(result).resolves.toEqual({
        type: 'self-check',
        ok: true,
        libraryVersion: '3.1.1',
      });
    } finally {
      clearTimeout(timer);
      worker.kill('SIGKILL');
      await closed;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
