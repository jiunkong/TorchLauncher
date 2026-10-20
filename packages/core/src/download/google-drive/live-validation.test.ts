import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ByteRange,
  RangeHttpError,
  type RangeResponse,
  RemoteResourceChangedError,
} from '../http/index.js';
import { createDownloadSource, SourceRestartRequiredError } from '../source/index.js';

const liveDriveUrl = process.env.TORCHLAUNCHER_LIVE_DRIVE_URL;
const rangeWindowBytes = 64 * 1024;
const fullCompareByteLimit = 16 * 1024 * 1024;
const replacementWaitMs = 30 * 60 * 1000;
const replacementMode = process.env.TORCHLAUNCHER_LIVE_DRIVE_MODE === 'replacement';
const receiptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'dl01-live-drive-v1.json',
);
const replacementReceiptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'dl01-live-drive-v2.json',
);
const replacementArmPath = '/tmp/torchlauncher-dl01-live-drive-replacement-arm.json';

interface ObservedRangeResponse {
  requestRange: string;
  status: number;
  contentRange: string | null;
}

describe.skipIf(!liveDriveUrl)('opt-in live Google Drive validation', () => {
  it.skipIf(replacementMode)(
    'checks bounded ranges and hashes, then compares full bytes only under the size cap',
    async () => {
      const observed: ObservedRangeResponse[] = [];
      const instrumentedFetch: typeof fetch = async (input, init) => {
        let response: Response;
        try {
          response = await globalThis.fetch(input, init);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          const errorName = error instanceof Error ? error.name : 'UnknownError';
          throw new Error(`Live Drive fetch failed (${errorName})`);
        }
        const requestRange = new Headers(init?.headers).get('Range');
        if (requestRange) {
          observed.push({
            requestRange,
            status: response.status,
            contentRange: response.headers.get('Content-Range'),
          });
        }
        return response;
      };

      const source = createDownloadSource(liveDriveUrl as string, { fetch: instrumentedFetch });
      expect(source.kind).toBe('google-drive');

      const probe = await readRange(source, { start: 0, end: 0 }, observed, 1);
      const totalLength = probe.snapshot.totalLength;
      expect(totalLength).toBeGreaterThan(0);
      assertSnapshotTotal(probe, totalLength);

      const windowLength = Math.min(rangeWindowBytes, totalLength);
      const middleStart = Math.max(Math.floor((totalLength - windowLength) / 2), 0);
      const lastStart = Math.max(totalLength - windowLength, 0);
      const ranges = [
        { label: 'first', range: { start: 0, end: windowLength - 1 } },
        {
          label: 'middle',
          range: { start: middleStart, end: middleStart + windowLength - 1 },
        },
        { label: 'last', range: { start: lastStart, end: totalLength - 1 } },
      ];

      const samples = new Map<string, RangeResponse>();
      const sampleHashes: Record<string, string> = {};
      for (const sample of ranges) {
        const response = await readRange(source, sample.range, observed, windowLength);
        assertSnapshotTotal(response, totalLength);
        samples.set(sample.label, response);
        sampleHashes[sample.label] = sha256(response.bytes);
      }

      const middleRange = { start: middleStart, end: middleStart + windowLength - 1 };
      const repeatedMiddle = await readRange(source, middleRange, observed, windowLength);
      assertSnapshotTotal(repeatedMiddle, totalLength);
      const repeatedMiddleSha256 = sha256(repeatedMiddle.bytes);
      expect(repeatedMiddleSha256).toBe(sampleHashes.middle);

      let fullSha256: string | null = null;
      let fullComparison: 'verified' | 'skipped-over-limit' = 'skipped-over-limit';
      if (totalLength <= fullCompareByteLimit) {
        const full = await readRange(
          source,
          { start: 0, end: totalLength - 1 },
          observed,
          fullCompareByteLimit,
        );
        assertSnapshotTotal(full, totalLength);
        expect(full.bytes.byteLength).toBe(totalLength);
        fullSha256 = sha256(full.bytes);
        for (const sample of ranges) {
          const sampled = samples.get(sample.label);
          if (!sampled) throw new Error('Missing range sample');
          const fullSlice = full.bytes.subarray(sample.range.start, sample.range.end + 1);
          expect(sha256(fullSlice)).toBe(sampleHashes[sample.label]);
        }
        fullComparison = 'verified';
      }

      const receipt = {
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        sourceType: 'public-google-drive',
        rangeWindowBytes,
        totalLength,
        firstProbe: {
          status: 206,
          contentRange: `bytes 0-0/${totalLength}`,
          sha256: sha256(probe.bytes),
        },
        sampleRanges: ranges.map((sample) => ({
          name: sample.label,
          start: sample.range.start,
          end: sample.range.end,
          status: 206,
          sha256: sampleHashes[sample.label],
        })),
        repeatedMiddleSha256,
        fullComparisonByteLimit: fullCompareByteLimit,
        fullComparison,
        fullSha256,
        generation: source.generation,
      };
      await mkdir(dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'w' });
    },
    120_000,
  );

  it.skipIf(!replacementMode)(
    'keeps a v1 source pinned until the coordinator confirms replacement',
    async () => {
      const observed: ObservedRangeResponse[] = [];
      const instrumentedFetch: typeof fetch = async (input, init) => {
        let response: Response;
        try {
          response = await globalThis.fetch(input, init);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          const errorName = error instanceof Error ? error.name : 'UnknownError';
          throw new Error(`Live Drive fetch failed (${errorName})`);
        }
        const requestRange = new Headers(init?.headers).get('Range');
        if (requestRange) {
          observed.push({
            requestRange,
            status: response.status,
            contentRange: response.headers.get('Content-Range'),
          });
        }
        return response;
      };
      const source = createDownloadSource(liveDriveUrl as string, { fetch: instrumentedFetch });
      expect(source.kind).toBe('google-drive');
      const v1Receipt = await readV1Receipt();
      const v1Length = v1Receipt.totalLength;
      const v1Probe = await readRange(source, { start: 0, end: 0 }, observed, 1);
      assertSnapshotTotal(v1Probe, v1Length);

      const v1Samples = new Map<string, RangeResponse>();
      for (const sample of v1Receipt.sampleRanges) {
        const response = await readRange(
          source,
          { start: sample.start, end: sample.end },
          observed,
          rangeWindowBytes,
        );
        assertSnapshotTotal(response, v1Length);
        expect(sha256(response.bytes)).toBe(sample.sha256);
        v1Samples.set(sample.name, response);
      }
      const v1Middle = v1Receipt.sampleRanges.find((sample) => sample.name === 'middle');
      if (!v1Middle) throw new Error('V1 receipt is missing the middle range');
      const repeatedV1Middle = await readRange(
        source,
        { start: v1Middle.start, end: v1Middle.end },
        observed,
        rangeWindowBytes,
      );
      expect(sha256(repeatedV1Middle.bytes)).toBe(v1Middle.sha256);

      const v1Generation = source.generation;
      expect(v1Generation).toBe(0);
      expect(source.snapshot?.totalLength).toBe(v1Length);
      const nonce = randomUUID();
      const confirmationPath = `/tmp/torchlauncher-dl01-live-drive-confirm-${nonce}.json`;
      await writeFile(
        replacementArmPath,
        `${JSON.stringify(
          {
            armedAt: new Date().toISOString(),
            processId: process.pid,
            nonce,
            confirmationPath,
            deadline: new Date(Date.now() + replacementWaitMs).toISOString(),
            totalLength: v1Length,
            sourceGeneration: v1Generation,
            v1RangeSha256: Object.fromEntries(
              v1Receipt.sampleRanges.map((sample) => [sample.name, sample.sha256]),
            ),
          },
          null,
          2,
        )}\n`,
        { flag: 'w' },
      );

      await waitForCoordinatorConfirmation(confirmationPath, nonce);

      let pinnedSourceOutcome:
        | 'change-detected'
        | 'expired-or-access-changed'
        | 'still-serving-v1'
        | 'mixed-version-bytes-accepted'
        | 'other-error' = 'still-serving-v1';
      let pinnedSourceError: string | null = null;
      for (const sample of v1Receipt.sampleRanges) {
        try {
          const response = await readRange(
            source,
            { start: sample.start, end: sample.end },
            observed,
            rangeWindowBytes,
          );
          if (
            response.snapshot.totalLength !== v1Length ||
            sha256(response.bytes) !== sample.sha256
          ) {
            pinnedSourceOutcome = 'mixed-version-bytes-accepted';
            break;
          }
        } catch (error) {
          if (error instanceof SourceRestartRequiredError) {
            if (error.cause instanceof RemoteResourceChangedError) {
              pinnedSourceOutcome = 'change-detected';
            } else if (error.cause instanceof RangeHttpError) {
              pinnedSourceOutcome = 'expired-or-access-changed';
            } else {
              pinnedSourceOutcome = 'change-detected';
            }
            pinnedSourceError = pinnedSourceOutcome;
          } else {
            pinnedSourceOutcome = 'other-error';
            pinnedSourceError = error instanceof Error ? error.name : 'UnknownError';
          }
          break;
        }
      }

      source.reset();
      const v2Probe = await readRange(source, { start: 0, end: 0 }, observed, 1);
      const v2Length = v2Probe.snapshot.totalLength;
      const v2WindowLength = Math.min(rangeWindowBytes, v2Length);
      const v2MiddleStart = Math.max(Math.floor((v2Length - v2WindowLength) / 2), 0);
      const v2Ranges = [
        { name: 'first', start: 0, end: v2WindowLength - 1 },
        { name: 'middle', start: v2MiddleStart, end: v2MiddleStart + v2WindowLength - 1 },
        {
          name: 'last',
          start: Math.max(v2Length - v2WindowLength, 0),
          end: v2Length - 1,
        },
      ];
      const v2Samples = [];
      for (const range of v2Ranges) {
        const response = await readRange(source, range, observed, v2WindowLength);
        assertSnapshotTotal(response, v2Length);
        v2Samples.push({ ...range, sha256: sha256(response.bytes) });
      }
      const v2Middle = v2Ranges[1];
      if (!v2Middle) throw new Error('V2 middle range is missing');
      const repeatedV2Middle = await readRange(
        source,
        { start: v2Middle.start, end: v2Middle.end },
        observed,
        v2WindowLength,
      );
      const repeatedV2MiddleSha256 = sha256(repeatedV2Middle.bytes);
      expect(repeatedV2MiddleSha256).toBe(v2Samples[1]?.sha256);
      const changedFromV1 =
        v2Length !== v1Length ||
        v2Samples.some((sample) => {
          const oldSample = v1Receipt.sampleRanges.find((item) => item.name === sample.name);
          return oldSample?.sha256 !== sample.sha256;
        });

      const receipt = {
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        sourceType: 'public-google-drive',
        v1TotalLength: v1Length,
        v1RangeSha256: Object.fromEntries(
          v1Receipt.sampleRanges.map((sample) => [sample.name, sample.sha256]),
        ),
        pinnedSourceOutcome,
        pinnedSourceError,
        v2TotalLength: v2Length,
        v2ProbeSha256: sha256(v2Probe.bytes),
        v2SampleRanges: v2Samples,
        repeatedV2MiddleSha256,
        changedFromV1,
        sourceGenerationAfterReset: source.generation,
      };
      await mkdir(dirname(replacementReceiptPath), { recursive: true });
      await writeFile(replacementReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: 'w',
      });

      expect(pinnedSourceOutcome).not.toBe('mixed-version-bytes-accepted');
      expect(pinnedSourceOutcome).not.toBe('other-error');
      expect(changedFromV1).toBe(true);
      expect(source.generation).toBeGreaterThan(v1Generation);
    },
    replacementWaitMs + 60_000,
  );
});

async function readRange(
  source: ReturnType<typeof createDownloadSource>,
  range: ByteRange,
  observed: ObservedRangeResponse[],
  maxBytes: number,
): Promise<RangeResponse> {
  const requestRange = `bytes=${range.start}-${range.end}`;
  const firstObservation = observed.length;
  const result = await source.getRange(range, { maxBytes });
  expect(result.range).toEqual(range);
  expect(result.bytes.byteLength).toBe(range.end - range.start + 1);
  const completedObservations = observed.slice(firstObservation);
  const matching = completedObservations.filter((item) => item.requestRange === requestRange);
  expect(matching.length).toBeGreaterThan(0);
  expect(matching.at(-1)).toMatchObject({
    requestRange,
    status: 206,
    contentRange: `bytes ${range.start}-${range.end}/${result.snapshot.totalLength}`,
  });
  return result;
}

function assertSnapshotTotal(response: RangeResponse, expectedTotal: number): void {
  expect(response.snapshot.totalLength).toBe(expectedTotal);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readV1Receipt(): Promise<{
  totalLength: number;
  sampleRanges: Array<{ name: string; start: number; end: number; sha256: string }>;
}> {
  return JSON.parse(await readFile(receiptPath, 'utf8')) as {
    totalLength: number;
    sampleRanges: Array<{ name: string; start: number; end: number; sha256: string }>;
  };
}

async function waitForCoordinatorConfirmation(path: string, nonce: string): Promise<void> {
  const deadline = Date.now() + replacementWaitMs;
  while (Date.now() < deadline) {
    try {
      const signal = JSON.parse(await readFile(path, 'utf8')) as {
        nonce?: string;
        proceed?: boolean;
      };
      if (signal.nonce === nonce && signal.proceed === true) return;
    } catch {
      // No confirmation file yet, or it is not a complete JSON document.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for coordinator replacement confirmation');
}
