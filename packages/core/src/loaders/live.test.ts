import { writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFullDownloader } from '../download/full';
import { installMinecraft } from '../minecraft/installer';
import { installLoader } from './installer';

it.skipIf(!process.env.TORCH_LOADER_LIVE_ROOT).each([
  { kind: 'neoforge' as const, version: '21.1.264' },
  { kind: 'fabric' as const, version: process.env.TORCH_LOADER_LIVE_FABRIC ?? '0.16.14' },
])(
  'installs official $kind $version without authentication or game launch',
  async (selection) => {
    const root = process.env.TORCH_LOADER_LIVE_ROOT;
    if (!root || process.platform !== 'linux' || process.arch !== 'x64')
      throw new Error('Explicit Linux x64 validation root required');
    let receivedBytes = 0;
    const download = createFullDownloader({
      onBytes: (count) => {
        receivedBytes += count;
      },
    });
    const base = await installMinecraft({
      root,
      platform: { os: 'linux', arch: 'x64', version: release() },
      download,
    });
    const started = Date.now();
    const installed = await installLoader(base, { selection, download });
    expect(installed.loader).toEqual({ ...selection, minecraftVersion: '1.21.1' });
    const receipt = {
      at: new Date().toISOString(),
      platform: 'linux/x64',
      selection,
      minecraft: '1.21.1',
      elapsedMs: Date.now() - started,
      receivedBytes,
      classpathEntries: installed.classpath.length,
      mainClass: installed.version.mainClass,
      authenticatedConnection: false,
    };
    await writeFile(
      join(root, `loader-${selection.kind}-receipt.json`),
      JSON.stringify(receipt, null, 2),
    );
  },
  1800000,
);
