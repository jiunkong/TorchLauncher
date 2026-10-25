import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bytes,
  metadata,
  transport,
} from '../../../../../packages/core/src/releases/fixtures/release';
import { createUpdateService } from './service';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const cacheDir = await mkdtemp(join(tmpdir(), 'updates-service-'));
  roots.push(cacheDir);
  const fetch = transport();
  fetch.mockImplementation(async (url) =>
    String(url).includes('/latest')
      ? Response.json(metadata('1.10.0', 'studio'))
      : new Response(bytes),
  );
  const service = createUpdateService({
    cacheDir,
    fetch,
    currentVersion: '1.0.0',
    platform: 'win32',
    arch: 'x64',
  });
  return { cacheDir, fetch, service };
}
it('does no network work on construction/state, gates downloads and returns only safe snapshots', async () => {
  const h = await setup();
  expect(h.service.snapshot()).toEqual({ phase: 'idle' });
  expect(h.fetch).not.toHaveBeenCalled();
  expect(await h.service.command({ action: 'download' })).toEqual({ phase: 'idle' });
  expect(h.fetch).not.toHaveBeenCalled();
  const listener = vi.fn();
  const unsubscribe = h.service.subscribe(listener);
  await h.service.command({ action: 'check' });
  const result = await h.service.command({ action: 'download' });
  expect(result).toEqual({ phase: 'downloaded', version: '1.10.0', size: bytes.length });
  expect(JSON.stringify([result, ...listener.mock.calls])).not.toMatch(
    /https:|sha256|\.exe|cacheDir|path/,
  );
  unsubscribe();
  await h.service.close();
});
it.each([
  [404, 'LAUNCHER_NO_RELEASE'],
  [503, 'LAUNCHER_RELEASE_FAILED'],
] as const)('reports safe HTTP %s state', async (status, code) => {
  const h = await setup();
  h.fetch.mockResolvedValue(new Response('secret', { status }));
  expect(await h.service.command({ action: 'check' })).toEqual({ phase: 'error', code });
});
it('isolates listeners, blocks duplicate operations, cancels and awaits asset staging cleanup on close', async () => {
  const h = await setup();
  await h.service.command({ action: 'check' });
  h.service.subscribe(() => {
    throw new Error('window closed');
  });
  let started!: () => void;
  const receiving = new Promise<void>((resolve) => {
    started = resolve;
  });
  h.service.subscribe((state) => {
    if (state.phase === 'downloading' && state.received > 0) started();
  });
  h.fetch.mockImplementation(async (url) =>
    String(url).includes('/latest')
      ? Response.json(metadata('1.10.0', 'studio'))
      : new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 4));
            },
          }),
        ),
  );
  const download = h.service.command({ action: 'download' });
  await receiving;
  expect(await h.service.command({ action: 'check' })).toEqual({
    phase: 'downloading',
    received: 4,
  });
  expect(h.fetch).toHaveBeenCalledTimes(3);
  await h.service.close();
  await download;
  expect(h.service.snapshot()).toEqual({ phase: 'cancelled' });
  expect(await readdir(join(h.cacheDir, 'windows'))).toEqual([]);
  await h.service.command({ action: 'check' });
  expect(h.fetch).toHaveBeenCalledTimes(3);
});
it('keeps unsupported platforms/configuration safe without network calls', async () => {
  const fetch = transport();
  const unsupported = createUpdateService({
    cacheDir: '/unused',
    currentVersion: '1.0.0',
    platform: 'darwin',
    arch: 'x64',
    fetch,
  });
  expect(await unsupported.command({ action: 'check' })).toEqual({
    phase: 'error',
    code: 'UNSUPPORTED_TARGET',
  });
  const invalid = createUpdateService({
    cacheDir: '/unused',
    currentVersion: 'bad',
    platform: 'linux',
    arch: 'x64',
    fetch,
  });
  expect(invalid.snapshot()).toEqual({ phase: 'error', code: 'LAUNCHER_VERIFY' });
  expect(fetch).not.toHaveBeenCalled();
});
it('converts connection failure to a safe state and permits a fresh retry', async () => {
  const h = await setup();
  h.fetch.mockRejectedValueOnce(new Error('/private/path https://token.invalid'));
  expect(await h.service.command({ action: 'check' })).toEqual({
    phase: 'error',
    code: 'LAUNCHER_OFFLINE',
  });
  expect(await h.service.command({ action: 'check' })).toMatchObject({ phase: 'available' });
});
