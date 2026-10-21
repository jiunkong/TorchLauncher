import { spawn } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Installation } from '../../../../../packages/core/src/minecraft/installer';
import { startJavaDiagnostic } from '../../../../../packages/core/src/minecraft/process';
import { watchCancellation } from './control';

it('cooperatively cancels and reaps the child before releasing its lease, without terminating the owner', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-game-control-'));
  const controller = new AbortController();
  const path = join(root, 'cancel');
  const stop = watchCancellation(path, () => controller.abort(), 5);
  let game: Awaited<ReturnType<typeof startJavaDiagnostic>> | undefined;
  try {
    game = await startJavaDiagnostic({ root, javaPath: process.execPath } as Installation, {
      signal: controller.signal,
      spawn: (_file, _args, options) =>
        spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options),
    });
    expect(await readdir(root)).toContain('.torchlauncher-server-lock');
    await writeFile(path, 'cancel', { flag: 'wx' });
    expect((await game.finished).reason).toBe('cancelled');
    expect(await readdir(root)).not.toContain('.torchlauncher-server-lock');
    expect(process.pid).toBeGreaterThan(0);
  } finally {
    stop();
    await game?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
