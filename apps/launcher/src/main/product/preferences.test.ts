import { link, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readPreferences, writePreferences } from './preferences';

const roots: string[] = [];
async function base() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'launcher-prefs-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('defaults off and persists exact personal preferences across reads', async () => {
  const root = await base();
  expect(await readPreferences(root)).toEqual({ closeOnLaunch: false });
  await writePreferences(root, { closeOnLaunch: true });
  expect(await readPreferences(root)).toEqual({ closeOnLaunch: true });
  await writePreferences(root, { closeOnLaunch: false });
  expect(await readPreferences(root)).toEqual({ closeOnLaunch: false });
});
it('reads close-only preferences and normalizes optional memory values', async () => {
  const root = await base();
  await writeFile(join(root, 'launcher-preferences.json'), '{"closeOnLaunch":true}');
  expect(await readPreferences(root)).toEqual({ closeOnLaunch: true });
  await writePreferences(root, { closeOnLaunch: true, maxMemoryMiB: 4096, initialMemoryMiB: 1024 });
  expect(await readPreferences(root)).toEqual({
    closeOnLaunch: true,
    maxMemoryMiB: 4096,
    initialMemoryMiB: 1024,
  });
  for (const preferences of [
    { closeOnLaunch: false, maxMemoryMiB: 511 },
    { closeOnLaunch: false, maxMemoryMiB: 512, initialMemoryMiB: 255 },
    { closeOnLaunch: false, initialMemoryMiB: 4096 },
  ])
    await expect(writePreferences(root, preferences as never)).rejects.toThrow(
      'preferences-failed',
    );
});
it('rejects malformed/oversized values and hard links without modifying another file', async () => {
  const root = await base();
  const path = join(root, 'launcher-preferences.json');
  for (const text of [
    '{}',
    '{"closeOnLaunch":"true"}',
    '{"closeOnLaunch":true,"other":1}',
    ' '.repeat(1025),
  ]) {
    await writeFile(path, text);
    await expect(readPreferences(root)).rejects.toThrow();
  }
  await rm(path);
  const target = join(root, 'target');
  await writeFile(target, '{"closeOnLaunch":false}');
  await link(target, path);
  await expect(readPreferences(root)).rejects.toThrow();
  await expect(writePreferences(root, { closeOnLaunch: true })).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('{"closeOnLaunch":false}');
});

for (const operation of ['writeFile', 'sync'] as const)
  it(`preserves previous settings and cleans temporary file after ${operation} failure`, async () => {
    const root = await base();
    await writePreferences(root, { closeOnLaunch: false });
    const handle = await open(join(root, 'probe'), 'wx');
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const fault = vi
      .spyOn(prototype, operation)
      .mockRejectedValueOnce(new Error('injected-I/O-failure'));
    try {
      await expect(writePreferences(root, { closeOnLaunch: true })).rejects.toThrow(
        'injected-I/O-failure',
      );
    } finally {
      fault.mockRestore();
    }
    expect(await readPreferences(root)).toEqual({ closeOnLaunch: false });
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
