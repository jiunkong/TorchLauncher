import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { DeploymentHeader, DeploymentIndex } from '../../deployment/contracts/index.js';
import { openDeploymentReader } from '../../deployment/reader/index.js';
import { createDownloadSource } from '../../download/source/index.js';
import { synchronizeDeployment } from './index.js';
import { readLocalFile } from './safety.js';

const liveUrl = process.env.TORCHLAUNCHER_SYNC_LIVE_URL;
const manifestPath = process.env.TORCHLAUNCHER_SYNC_LIVE_MANIFEST;
const waitMs = 30 * 60 * 1000;
const armPath = '/tmp/torchlauncher-sync-live-arm.json';
const receiptDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface Manifest {
  serverId: string;
  deployments: Array<{ header: DeploymentHeader; index: DeploymentIndex }>;
}

it.skipIf(!liveUrl || !manifestPath)(
  'validates real public Drive v1 sync, waits for replacement confirmation, then syncs v2',
  async () => {
    const manifestInfo = await stat(manifestPath as string);
    expect(manifestInfo.size).toBeLessThan(1024 ** 2);
    const manifest = JSON.parse(await readFile(manifestPath as string, 'utf8')) as Manifest;
    const v1 = manifest.deployments[0];
    const v2 = manifest.deployments[1];
    if (!v1 || !v2) throw new Error('Missing local fixture metadata');
    expect(v1.header.totalLength).toBeLessThan(1024 ** 2);
    expect(v2.header.totalLength).toBeLessThan(1024 ** 2);
    const observed: Array<{ start: number; end: number; status: number }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      let response: Response;
      try {
        response = await globalThis.fetch(input, init);
      } catch (error) {
        throw new Error(
          `Live transport failed (${error instanceof Error ? error.name : 'UnknownError'})`,
        );
      }
      const range = /^bytes=([0-9]+)-([0-9]+)$/u.exec(
        new Headers(init?.headers).get('Range') ?? '',
      );
      if (range)
        observed.push({ start: Number(range[1]), end: Number(range[2]), status: response.status });
      return response;
    };
    const source = createDownloadSource(liveUrl as string, { fetch: fetcher });
    const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-sync-live-'));
    const controller = new AbortController();
    try {
      const reader = await openDeploymentReader(source, {
        expectedServerId: manifest.serverId,
        signal: controller.signal,
      });
      expect(reader.header).toEqual(v1.header);
      expect(reader.index).toEqual(v1.index);
      const first = await synchronizeDeployment({
        root,
        expectedServerId: manifest.serverId,
        reader,
        signal: controller.signal,
      });
      expect(first).toMatchObject({ downloaded: 5, reused: 0, preserved: 0, deleted: 0 });
      for (const file of v1.index.files) {
        expect(await readLocalFile(join(root, file.path))).toMatchObject({
          sha256: file.sha256,
          length: file.originalLength,
        });
      }
      const repeatStart = observed.length;
      const repeat = await synchronizeDeployment({
        root,
        expectedServerId: manifest.serverId,
        reader,
        signal: controller.signal,
      });
      expect(repeat).toMatchObject({ downloaded: 0, reused: 4, preserved: 1, deleted: 0 });
      expect(observed.length - repeatStart).toBe(0);
      await writeFile(join(root, 'options.txt'), 'synthetic local user settings\n');
      const personal = await readLocalFile(join(root, 'options.txt'));
      if (!personal) throw new Error('Missing local settings fixture');
      await mkdir(receiptDirectory, { recursive: true });
      await writeFile(
        join(receiptDirectory, 'sync-live-v1.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            checkedAt: new Date().toISOString(),
            totalLength: reader.header.totalLength,
            indexSha256: reader.header.indexSha256,
            first,
            repeat,
            repeatNetworkRangeCount: observed.length - repeatStart,
            fileHashes: v1.index.files.map((file) => ({
              path: file.path,
              sha256: file.sha256,
              length: file.originalLength,
            })),
          },
          null,
          2,
        )}\n`,
        { mode: 0o644 },
      );
      const nonce = randomUUID();
      const confirmationPath = `/tmp/torchlauncher-sync-live-confirm-${nonce}.json`;
      await writeFile(
        armPath,
        `${JSON.stringify(
          {
            armedAt: new Date().toISOString(),
            processId: process.pid,
            nonce,
            confirmationPath,
            deadline: new Date(Date.now() + waitMs).toISOString(),
            v1Length: reader.header.totalLength,
            sourceGeneration: reader.sourceGeneration,
          },
          null,
          2,
        )}\n`,
      );
      await waitForConfirmation(confirmationPath, nonce);

      let retainedOutcome = 'still-serving-v1';
      const retainedScratch = join(root, '.retained-reader-probe');
      try {
        await reader.stageFile('config/required.txt', retainedScratch, {
          signal: controller.signal,
        });
        const oldEntry = v1.index.files.find((file) => file.path === 'config/required.txt');
        expect(await readLocalFile(retainedScratch)).toMatchObject({ sha256: oldEntry?.sha256 });
      } catch (error) {
        if (error instanceof Error && error.name === 'AssertionError') throw error;
        retainedOutcome =
          error instanceof Error && 'code' in error
            ? String(error.code)
            : error instanceof Error
              ? error.name
              : 'UnknownError';
      } finally {
        await rm(retainedScratch, { force: true });
      }
      source.reset();
      const secondReader = await openDeploymentReader(source, {
        expectedServerId: manifest.serverId,
        signal: controller.signal,
      });
      expect(secondReader.header).toEqual(v2.header);
      expect(secondReader.index).toEqual(v2.index);
      const secondStart = observed.length;
      const second = await synchronizeDeployment({
        root,
        expectedServerId: manifest.serverId,
        reader: secondReader,
        signal: controller.signal,
      });
      expect(second).toMatchObject({ downloaded: 2, reused: 2, preserved: 1, deleted: 1 });
      const payloadRanges = observed.slice(secondStart);
      const expectedPaths = ['config/required.txt', 'custom-data/added.bin'];
      const fetchedPaths = new Set<string>();
      for (const range of payloadRanges) {
        expect(range.status).toBe(206);
        const file = v2.index.files.find(
          (entry) =>
            range.start >= 128 + v2.header.indexLength + entry.offset &&
            range.end < 128 + v2.header.indexLength + entry.offset + entry.storedLength,
        );
        expect(expectedPaths).toContain(file?.path);
        if (file) fetchedPaths.add(file.path);
      }
      expect([...fetchedPaths].sort()).toEqual(expectedPaths.sort());
      const finalHashes = [];
      for (const file of v2.index.files) {
        const local = await readLocalFile(join(root, file.path));
        const expected =
          file.policy === 'initial-only'
            ? personal
            : { sha256: file.sha256, length: file.originalLength };
        expect(local).toMatchObject({ sha256: expected.sha256, length: expected.length });
        finalHashes.push({ path: file.path, sha256: local?.sha256, length: local?.length });
      }
      expect(await readLocalFile(join(root, 'custom-data/removed.bin'))).toBeNull();
      await writeFile(
        join(receiptDirectory, 'sync-live-v2.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            checkedAt: new Date().toISOString(),
            v1TotalLength: v1.header.totalLength,
            v2TotalLength: secondReader.header.totalLength,
            retainedOutcome,
            sourceGenerationAfterReset: source.generation,
            indexSha256: secondReader.header.indexSha256,
            second,
            payloadRanges,
            finalHashes,
            initialOnlyPreserved: true,
            removedOwnedFileAbsent: true,
          },
          null,
          2,
        )}\n`,
        { mode: 0o644 },
      );
    } finally {
      controller.abort();
      await rm(root, { recursive: true, force: true });
    }
  },
  waitMs + 120_000,
);

async function waitForConfirmation(path: string, nonce: string): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const signal = JSON.parse(await readFile(path, 'utf8')) as {
        nonce?: string;
        proceed?: boolean;
      };
      if (signal.nonce === nonce && signal.proceed === true) return;
    } catch {
      /* Confirmation file is not ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for coordinator replacement confirmation');
}
