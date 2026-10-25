import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { metadata, transport } from '../../../../../packages/core/src/releases/fixtures/release.js';
import { createLauncherUpdater } from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(currentVersion = '1.9.0') {
  const cacheDir = await mkdtemp(join(tmpdir(), 'launcher-update-'));
  roots.push(cacheDir);
  const fetch = transport();
  return {
    fetch,
    updater: createLauncherUpdater({
      cacheDir,
      fetch,
      currentVersion,
      platform: 'win32',
      arch: 'x64',
    }),
  };
}
it('checks numeric stable versions, downloads on explicit request and exposes only staged status', async () => {
  const h = await setup();
  expect(await h.updater.check()).toMatchObject({ phase: 'available', version: '1.10.0' });
  expect(h.fetch).toHaveBeenCalledTimes(1);
  const artifact = await h.updater.download();
  expect(artifact.path).toMatch(/\.exe$/);
  expect(h.updater.snapshot()).toEqual({
    phase: 'downloaded',
    version: '1.10.0',
    size: artifact.size,
  });
  expect(h.fetch).toHaveBeenCalledTimes(3);
});
it.each(['1.10.0', '2.0.0'])(
  'does not download when current %s is equal or newer',
  async (current) => {
    const h = await setup(current);
    expect(await h.updater.check()).toEqual({ phase: 'current' });
    await expect(h.updater.download()).rejects.toMatchObject({ code: 'NO_UPDATE' });
    expect(h.updater.snapshot()).toEqual({ phase: 'current' });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  },
);
it('refuses a latest rollback after an available check', async () => {
  const h = await setup();
  await h.updater.check();
  h.fetch.mockResolvedValue(Response.json(metadata('1.8.0')));
  await expect(h.updater.download()).rejects.toMatchObject({ code: 'NO_UPDATE' });
  expect(h.fetch).toHaveBeenCalledTimes(2);
});
it('never offers cached bytes as an offline update', async () => {
  const h = await setup();
  await h.updater.download();
  h.fetch.mockRejectedValue(new TypeError('offline'));
  await expect(h.updater.download()).rejects.toMatchObject({ code: 'LAUNCHER_OFFLINE' });
  expect(h.updater.snapshot()).toEqual({ phase: 'error', code: 'LAUNCHER_OFFLINE' });
});
it('ignores stale operations and preserves a newer operation state', async () => {
  const h = await setup();
  let complete!: (response: Response) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const stale = h.updater.check();
  const rejection = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
  expect(await h.updater.check()).toMatchObject({ phase: 'available' });
  complete(Response.json(metadata('9.0.0')));
  await rejection;
  expect(h.updater.snapshot()).toMatchObject({ phase: 'available', version: '1.10.0' });
});
it('cancels an in-progress body without leaving a downloaded state', async () => {
  const h = await setup();
  h.fetch.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
  const pending = h.updater.download();
  await Promise.resolve();
  h.updater.cancel();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.updater.snapshot()).toEqual({ phase: 'cancelled' });
});
