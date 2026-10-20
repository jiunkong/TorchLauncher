/** Opt-in network validation: TORCH_GAME_LIVE_ROOT=/absolute/temp/root pnpm exec vitest run packages/core/src/minecraft/live-install.test.ts */
import { mkdir, opendir, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFullDownloader } from '../download/full';
import { installMinecraft } from './installer';
import { startJavaDiagnostic } from './process';

it.skipIf(!process.env.TORCH_GAME_LIVE_ROOT)(
  'installs real Minecraft 1.21.1 and executes its Java 21 runtime (no account or game launch)',
  async () => {
    const requestedRoot = process.env.TORCH_GAME_LIVE_ROOT;
    if (!requestedRoot) throw new Error('Explicit live root required');
    const os =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    if (
      !['win32', 'darwin', 'linux'].includes(process.platform) ||
      (process.arch !== 'x64' && process.arch !== 'arm64')
    )
      throw new Error('Unsupported live host');
    await mkdir(requestedRoot, { recursive: true });
    const root = await realpath(requestedRoot);
    const began = Date.now();
    let receivedBytes = 0;
    let completedRequests = 0;
    const transfer = createFullDownloader({
      onBytes: (bytes) => {
        receivedBytes += bytes;
      },
    });
    const installation = await installMinecraft({
      root,
      version: '1.21.1',
      platform: { os, arch: process.arch, version: (await import('node:os')).release() },
      download: async (url, options) => {
        const result = await transfer(url, options);
        completedRequests++;
        return result;
      },
      onProgress: (event) => {
        if (event.completed % 250 === 0 || event.completed === event.total)
          console.log(
            `Verified files ${event.completed}/${event.total}; received ${receivedBytes} bytes`,
          );
      },
    });
    const installationMs = Date.now() - began;
    const java = await startJavaDiagnostic(installation);
    const result = await java.finished;
    expect(result.reason).toBe('exited');
    expect(result.code).toBe(0);
    const versionOutput = result.logs.entries.map((entry) => entry.text).join('\n');
    expect(versionOutput).toMatch(/(?:openjdk|java) version "21\./);
    let installedBytes = 0;
    let installedFiles = 0;
    async function size(path: string): Promise<void> {
      for await (const entry of await opendir(path)) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await size(child);
        else if (entry.isFile()) {
          installedBytes += (await stat(child)).size;
          installedFiles++;
        }
      }
    }
    await size(root);
    const receipt = {
      checkedAt: new Date().toISOString(),
      node: process.version,
      host: `${process.platform}/${process.arch}`,
      minecraft: installation.version.id,
      receivedBytes,
      completedRequests,
      installedBytes,
      installedFiles,
      installationMs,
      javaExit: result,
      authenticatedGameLaunch: false,
    };
    await writeFile(join(root, 'validation-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt));
  },
  60 * 60 * 1000,
);
