import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteRange, ResourceSnapshot } from '../../download/http/index.js';
import type { DownloadSource, SourceRangeResponse } from '../../download/source/index.js';
import { DEPLOYMENT_LIMITS } from '../contracts/index.js';
import { writeDeployment } from '../writer/index.js';
import { openDeploymentReader } from './index.js';

const serverId = '11111111-1111-4111-8111-111111111111';
const deploymentId = '22222222-2222-4222-8222-222222222222';
const tempDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'torch-reader-test-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

class MemorySource implements DownloadSource {
  readonly kind = 'https' as const;
  readonly sourceId = 'memory://deployment';
  generation = 0;
  snapshot: ResourceSnapshot | undefined;
  readonly ranges: ByteRange[] = [];
  beforeResponse?: (range: ByteRange) => void;

  constructor(private readonly bytes: Uint8Array) {
    this.snapshot = { totalLength: bytes.byteLength, etag: '"stable"', lastModified: null };
  }

  async getRange(
    range: ByteRange,
    options: { signal?: AbortSignal } = {},
  ): Promise<SourceRangeResponse> {
    options.signal?.throwIfAborted();
    const responseSnapshot = this.snapshot;
    if (!responseSnapshot || range.start < 0 || range.end >= this.bytes.byteLength) {
      throw new Error('Range outside test source');
    }
    this.ranges.push({ ...range });
    const response = {
      sourceId: this.sourceId,
      sourceGeneration: this.generation,
      range: { ...range },
      bytes: this.bytes.slice(range.start, range.end + 1),
      snapshot: { ...responseSnapshot },
    };
    this.beforeResponse?.(range);
    return response;
  }

  reset(): void {
    this.generation += 1;
    this.snapshot = undefined;
  }
}

async function buildDeployment(): Promise<{
  bytes: Uint8Array;
  index: {
    files: Array<{ path: string; offset: number; storedLength: number; compression: string }>;
  };
}> {
  const root = await tempDirectory();
  await writeFile(join(root, 'plain.dat'), Buffer.from('uncompressed test payload'));
  await writeFile(join(root, 'compressed.bin'), Buffer.from('compressed payload '.repeat(70)));
  await writeFile(join(root, 'empty.bin'), new Uint8Array());
  const result = await writeDeployment({
    sourceRoot: root,
    outputPath: join(root, 'bundle.torchpack'),
    serverId,
    deploymentId,
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
    files: [
      {
        sourcePath: 'plain.dat',
        path: 'custom data/arbitrary.bin',
        policy: 'always',
        compression: 'none',
      },
      {
        sourcePath: 'compressed.bin',
        path: 'third-party/anything.ext',
        policy: 'initial-only',
        compression: 'gzip',
      },
      { sourcePath: 'empty.bin', path: 'empty.bin', policy: 'always', compression: 'gzip' },
    ],
  });
  return {
    bytes: await readFile(result.outputPath),
    index: result.index as unknown as {
      files: Array<{ path: string; offset: number; storedLength: number; compression: string }>;
    },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rebuildContainer(bytes: Uint8Array, indexText: string, payload: Uint8Array): Uint8Array {
  return rebuildContainerWithIndexBytes(bytes, Buffer.from(indexText, 'utf8'), payload);
}

function rebuildContainerWithIndexBytes(
  bytes: Uint8Array,
  indexBytes: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const header = Buffer.from(bytes.subarray(0, 64));
  header.writeBigUInt64LE(BigInt(indexBytes.byteLength), 16);
  header.writeBigUInt64LE(BigInt(64 + indexBytes.byteLength + payload.byteLength), 24);
  Buffer.from(sha256(indexBytes), 'hex').copy(header, 32);
  return Buffer.concat([header, indexBytes, payload]);
}

function decodeIndexText(bytes: Uint8Array): string {
  const indexLength = Number(Buffer.from(bytes).readBigUInt64LE(16));
  return Buffer.from(bytes)
    .subarray(64, 64 + indexLength)
    .toString('utf8');
}

function getPayload(bytes: Uint8Array): Uint8Array {
  const indexLength = Number(Buffer.from(bytes).readBigUInt64LE(16));
  return bytes.slice(64 + indexLength);
}

describe('deployment reader', () => {
  it('roundtrips writer output, streams arbitrary paths, and returns immutable metadata', async () => {
    const { bytes } = await buildDeployment();
    const source = new MemorySource(bytes);
    const reader = await openDeploymentReader(source, {
      expectedServerId: serverId,
      rangeChunkBytes: 13,
    });
    expect(Object.isFrozen(reader.header)).toBe(true);
    expect(Object.isFrozen(reader.index)).toBe(true);
    expect(Object.isFrozen(reader.index.files)).toBe(true);
    expect(() => (reader.index.files as unknown[]).push({})).toThrow();

    const out = await tempDirectory();
    const beforePlainRanges = source.ranges.length;
    const plain = await reader.stageFile('custom data/arbitrary.bin', join(out, 'plain.stage'));
    const plainRequests = source.ranges.slice(beforePlainRanges);
    const firstFile = reader.index.files[0];
    if (!firstFile) throw new Error('Missing plain fixture');
    const plainStart = 64 + reader.header.indexLength + firstFile.offset;
    expect(plainRequests.length).toBeGreaterThan(0);
    expect(
      plainRequests.every(
        (range) => range.start >= plainStart && range.end < plainStart + firstFile.storedLength,
      ),
    ).toBe(true);
    const compressed = await reader.stageFile('third-party/anything.ext', join(out, 'gzip.stage'));
    const empty = await reader.stageFile('empty.bin', join(out, 'empty.stage'));
    expect(await readFile(plain.outputPath, 'utf8')).toBe('uncompressed test payload');
    expect(await readFile(compressed.outputPath, 'utf8')).toBe('compressed payload '.repeat(70));
    expect(await readFile(empty.outputPath)).toEqual(Buffer.alloc(0));
    expect(empty.length).toBe(0);
    expect(source.ranges.some((range) => range.end - range.start + 1 > 13)).toBe(true); // header is one exact 64-byte request.
    expect(
      source.ranges
        .filter((range) => range.start >= 64 + reader.header.indexLength)
        .every((range) => range.end - range.start + 1 <= 13),
    ).toBe(true);
    reader.assertCurrent();
  });

  it('rejects duplicate JSON keys and a UTF-8 BOM before accepting the index', async () => {
    const { bytes } = await buildDeployment();
    const text = decodeIndexText(bytes);
    const payload = getPayload(bytes);
    const duplicate = `{"serverId":"${serverId}",${text.slice(1)}`;
    await expect(
      openDeploymentReader(new MemorySource(rebuildContainer(bytes, duplicate, payload)), {
        expectedServerId: serverId,
      }),
    ).rejects.toMatchObject({ code: 'invalid-index-json' });
    const bom = rebuildContainer(bytes, `\uFEFF${text}`, payload);
    await expect(
      openDeploymentReader(new MemorySource(bom), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-index-encoding' });
    const nested = rebuildContainer(bytes, `${'['.repeat(101)}0${']'.repeat(101)}`, payload);
    await expect(
      openDeploymentReader(new MemorySource(nested), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-index-json' });
  });

  it('rejects invalid UTF-8, index digest mismatch, invalid magic, and unsafe u64 lengths', async () => {
    const { bytes } = await buildDeployment();
    const text = decodeIndexText(bytes);
    const payload = getPayload(bytes);
    const invalidUtf8 = rebuildContainerWithIndexBytes(
      bytes,
      Buffer.concat([Buffer.from([0xc3, 0x28]), Buffer.from(text.slice(2))]),
      payload,
    );
    await expect(
      openDeploymentReader(new MemorySource(invalidUtf8), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-index-encoding' });

    const digestMismatch = bytes.slice();
    const headerIndexLength = Number(Buffer.from(bytes).readBigUInt64LE(16));
    digestMismatch[64 + headerIndexLength - 1] =
      (digestMismatch[64 + headerIndexLength - 1] ?? 0) ^ 1;
    await expect(
      openDeploymentReader(new MemorySource(digestMismatch), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'index-hash-mismatch' });

    const invalidMagic = bytes.slice();
    invalidMagic[0] = 0;
    await expect(
      openDeploymentReader(new MemorySource(invalidMagic), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-header' });

    const unsafeLength = bytes.slice();
    Buffer.from(
      unsafeLength.buffer,
      unsafeLength.byteOffset,
      unsafeLength.byteLength,
    ).writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 24);
    await expect(
      openDeploymentReader(new MemorySource(unsafeLength), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-header' });

    const oversizedIndex = bytes.slice();
    Buffer.from(
      oversizedIndex.buffer,
      oversizedIndex.byteOffset,
      oversizedIndex.byteLength,
    ).writeBigUInt64LE(BigInt(DEPLOYMENT_LIMITS.indexLength + 1), 16);
    await expect(
      openDeploymentReader(new MemorySource(oversizedIndex), { expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'invalid-header' });
  });

  it('rejects a corrupted gzip trailer and removes only its new scratch file', async () => {
    const { bytes, index } = await buildDeployment();
    const file = index.files.find((entry) => entry.compression === 'gzip');
    if (!file) throw new Error('Missing gzip fixture');
    const payload = getPayload(bytes);
    const trailerIndex = file.offset + file.storedLength - 8;
    const trailerByte = payload[trailerIndex];
    if (trailerByte === undefined) throw new Error('Missing gzip trailer');
    payload[trailerIndex] = trailerByte ^ 1;
    const source = new MemorySource(rebuildContainer(bytes, decodeIndexText(bytes), payload));
    const reader = await openDeploymentReader(source, {
      expectedServerId: serverId,
      rangeChunkBytes: 11,
    });
    const output = join(await tempDirectory(), 'corrupt.stage');
    await expect(reader.stageFile(file.path as string, output)).rejects.toMatchObject({
      name: 'DeploymentReaderError',
      code: 'invalid-gzip',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a payload hash mismatch and removes the new scratch file', async () => {
    const { bytes, index } = await buildDeployment();
    const file = index.files[0];
    if (!file) throw new Error('Missing plain fixture');
    const corrupted = bytes.slice();
    const indexLength = Number(Buffer.from(bytes).readBigUInt64LE(16));
    const payloadPosition = 64 + indexLength + file.offset;
    corrupted[payloadPosition] = (corrupted[payloadPosition] ?? 0) ^ 1;
    const reader = await openDeploymentReader(new MemorySource(corrupted), {
      expectedServerId: serverId,
    });
    const output = join(await tempDirectory(), 'bad-hash.stage');
    await expect(reader.stageFile(file.path, output)).rejects.toMatchObject({
      name: 'DeploymentReaderError',
      code: 'file-hash-mismatch',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects bytes after the single gzip member', async () => {
    const { bytes, index } = await buildDeployment();
    const files = index.files.map((file) => ({ ...file }));
    const gzipIndex = files.findIndex((file) => file.compression === 'gzip');
    const gzip = files[gzipIndex];
    if (!gzip) throw new Error('Missing gzip fixture');
    const originalPayload = Buffer.from(getPayload(bytes));
    const insertion = Number(gzip.offset) + Number(gzip.storedLength);
    const payload = Buffer.concat([
      originalPayload.subarray(0, insertion),
      Buffer.from([0xa5]),
      originalPayload.subarray(insertion),
    ]);
    gzip.storedLength = Number(gzip.storedLength) + 1;
    for (const file of files.slice(gzipIndex + 1)) file.offset = Number(file.offset) + 1;
    const modifiedIndex = JSON.parse(decodeIndexText(bytes)) as {
      files: Array<Record<string, unknown>>;
    };
    modifiedIndex.files = files;
    const corrupted = rebuildContainer(bytes, JSON.stringify(modifiedIndex), payload);
    const reader = await openDeploymentReader(new MemorySource(corrupted), {
      expectedServerId: serverId,
    });
    await expect(
      reader.stageFile(gzip.path as string, join(await tempDirectory(), 'trailing.stage')),
    ).rejects.toMatchObject({
      name: 'DeploymentReaderError',
      code: 'invalid-gzip',
    });
  });

  it('rejects a truncated deflate stream before accepting its gzip trailer', async () => {
    const { bytes, index } = await buildDeployment();
    const files = index.files.map((file) => ({ ...file }));
    const gzipIndex = files.findIndex((file) => file.compression === 'gzip');
    const gzip = files[gzipIndex];
    if (!gzip) throw new Error('Missing gzip fixture');
    const originalPayload = Buffer.from(getPayload(bytes));
    const deflateStart = Number(gzip.offset) + 10;
    const oldTrailerStart = Number(gzip.offset) + Number(gzip.storedLength) - 8;
    const retainedDeflateBytes = 1;
    const removedBytes = oldTrailerStart - deflateStart - retainedDeflateBytes;
    const payload = Buffer.concat([
      originalPayload.subarray(0, deflateStart + retainedDeflateBytes),
      originalPayload.subarray(oldTrailerStart),
    ]);
    gzip.storedLength = 10 + retainedDeflateBytes + 8;
    for (const file of files.slice(gzipIndex + 1)) file.offset = Number(file.offset) - removedBytes;
    const modifiedIndex = JSON.parse(decodeIndexText(bytes)) as {
      files: Array<Record<string, unknown>>;
    };
    modifiedIndex.files = files;
    const reader = await openDeploymentReader(
      new MemorySource(rebuildContainer(bytes, JSON.stringify(modifiedIndex), payload)),
      { expectedServerId: serverId, rangeChunkBytes: 17 },
    );
    await expect(
      reader.stageFile(gzip.path as string, join(await tempDirectory(), 'truncated.stage')),
    ).rejects.toMatchObject({
      name: 'DeploymentReaderError',
      code: 'invalid-gzip',
    });
  });

  it('bounds optional gzip filename scanning with a local header budget', async () => {
    const { bytes, index } = await buildDeployment();
    const files = index.files.map((file) => ({ ...file }));
    const gzipIndex = files.findIndex((file) => file.compression === 'gzip');
    const gzip = files[gzipIndex];
    if (!gzip) throw new Error('Missing gzip fixture');
    const originalPayload = Buffer.from(getPayload(bytes));
    const start = Number(gzip.offset);
    const end = start + Number(gzip.storedLength);
    const filename = Buffer.alloc(64 * 1024 - 9, 0x61);
    const payload = Buffer.concat([
      originalPayload.subarray(0, start + 10),
      filename,
      originalPayload.subarray(start + 10, end),
      originalPayload.subarray(end),
    ]);
    payload[start + 3] = (payload[start + 3] ?? 0) | 0x08;
    gzip.storedLength = Number(gzip.storedLength) + filename.byteLength;
    for (const file of files.slice(gzipIndex + 1)) {
      file.offset = Number(file.offset) + filename.byteLength;
    }
    const modifiedIndex = JSON.parse(decodeIndexText(bytes)) as {
      files: Array<Record<string, unknown>>;
    };
    modifiedIndex.files = files;
    const rebuilt = rebuildContainer(bytes, JSON.stringify(modifiedIndex), payload);
    const reader = await openDeploymentReader(new MemorySource(rebuilt), {
      expectedServerId: serverId,
    });
    await expect(
      reader.stageFile(gzip.path as string, join(await tempDirectory(), 'long-name.stage')),
    ).rejects.toMatchObject({
      name: 'DeploymentReaderError',
      code: 'invalid-gzip',
    });
  });

  it('pins source generation and removes a partial file after reset or cancellation', async () => {
    const { bytes, index } = await buildDeployment();
    const source = new MemorySource(bytes);
    const reader = await openDeploymentReader(source, {
      expectedServerId: serverId,
      rangeChunkBytes: 8,
    });
    const output = join(await tempDirectory(), 'reset.stage');
    source.beforeResponse = () => source.reset();
    await expect(reader.stageFile(index.files[0]?.path ?? '', output)).rejects.toMatchObject({
      code: 'source-changed',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });

    const secondSource = new MemorySource(bytes);
    const secondReader = await openDeploymentReader(secondSource, {
      expectedServerId: serverId,
      rangeChunkBytes: 8,
    });
    const cancelOutput = join(await tempDirectory(), 'cancel.stage');
    const controller = new AbortController();
    secondSource.beforeResponse = () => controller.abort(new Error('cancelled'));
    await expect(
      secondReader.stageFile(index.files[0]?.path ?? '', cancelOutput, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'Error', message: 'cancelled' });
    await expect(readFile(cancelOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels while a gzip stream is producing output and removes its scratch file', async () => {
    const root = await tempDirectory();
    const data = randomBytes(512 * 1024);
    await writeFile(join(root, 'large.bin'), data);
    const result = await writeDeployment({
      sourceRoot: root,
      outputPath: join(root, 'large.torchpack'),
      serverId,
      deploymentId,
      game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
      files: [{ sourcePath: 'large.bin', policy: 'always', compression: 'gzip' }],
    });
    const source = new MemorySource(await readFile(result.outputPath));
    const reader = await openDeploymentReader(source, {
      expectedServerId: serverId,
      rangeChunkBytes: 4 * 1024 ** 2,
    });
    const file = reader.index.files[0];
    if (!file) throw new Error('Missing large gzip fixture');
    const payloadStart = 64 + reader.header.indexLength;
    const payloadEnd = payloadStart + file.storedLength - 1;
    const controller = new AbortController();
    source.beforeResponse = (range) => {
      if (range.start >= payloadStart && range.end === payloadEnd) {
        setTimeout(() => controller.abort(new Error('cancel while inflating')), 0);
      }
    };
    const output = join(await tempDirectory(), 'cancel-inflate.stage');
    await expect(
      reader.stageFile(file.path, output, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'Error',
      message: 'cancel while inflating',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite a pre-existing destination', async () => {
    const { bytes, index } = await buildDeployment();
    const reader = await openDeploymentReader(new MemorySource(bytes), {
      expectedServerId: serverId,
    });
    const output = join(await tempDirectory(), 'existing.stage');
    await writeFile(output, 'preserve');
    await expect(reader.stageFile(index.files[0]?.path ?? '', output)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(output, 'utf8')).toBe('preserve');
  });

  it('enforces a lower local output budget before creating the scratch file', async () => {
    const { bytes, index } = await buildDeployment();
    const reader = await openDeploymentReader(new MemorySource(bytes), {
      expectedServerId: serverId,
      maxFileBytes: 4,
    });
    const output = join(await tempDirectory(), 'too-large.stage');
    await expect(reader.stageFile(index.files[0]?.path ?? '', output)).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });

    const storedReader = await openDeploymentReader(new MemorySource(bytes), {
      expectedServerId: serverId,
      maxStoredFileBytes: 1,
    });
    const compressedFile = index.files.find((file) => file.compression === 'gzip');
    if (!compressedFile) throw new Error('Missing gzip fixture');
    const storedOutput = join(await tempDirectory(), 'stored-too-large.stage');
    await expect(storedReader.stageFile(compressedFile.path, storedOutput)).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    await expect(readFile(storedOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function buildBrandedDeployment() {
  const { tinyPng } = await import('../../branding/fixtures/images.js');
  const root = await tempDirectory();
  const icon = tinyPng();
  const background = tinyPng();
  await writeFile(join(root, 'game.dat'), 'game payload is independent');
  const result = await writeDeployment({
    sourceRoot: root,
    outputPath: join(root, 'branded.torchpack'),
    serverId,
    deploymentId,
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
    files: [{ sourcePath: 'game.dat', compression: 'none', policy: 'always' }],
    branding: {
      icon: { bytes: icon, mediaType: 'image/png' },
      background: { bytes: background, mediaType: 'image/png' },
    },
  });
  return { ...result, bytes: await readFile(result.outputPath), root, icon, background };
}

describe('isolated branding reader', () => {
  it('fetches only a changed role, reuses the pinned index and keeps the game namespace separate', async () => {
    const pack = await buildBrandedDeployment();
    const source = new MemorySource(pack.bytes);
    const reader = await openDeploymentReader(source, {
      expectedServerId: serverId,
      rangeChunkBytes: 16,
    });
    source.ranges.length = 0;
    // Consumer compares verified cached hashes: unchanged icon never calls stageBrandingAsset.
    const cachedIconHash = sha256(pack.icon);
    expect(reader.index.branding?.icon?.sha256).toBe(cachedIconHash);
    expect(source.ranges).toHaveLength(0);
    const output = join(pack.root, 'background.stage');
    await expect(reader.stageBrandingAsset('background', output)).resolves.toMatchObject({
      role: 'background',
      outputPath: output,
      length: pack.background.length,
      sha256: sha256(pack.background),
    });
    expect(await readFile(output)).toEqual(pack.background);
    const asset = reader.index.branding?.background;
    if (!asset) throw new Error('Missing background');
    expect(source.ranges[0]?.start).toBe(64 + reader.header.indexLength + asset.offset);
    expect(
      source.ranges.every((range) => range.start >= 64 + reader.header.indexLength + asset.offset),
    ).toBe(true);
    await expect(
      reader.stageFile('background', join(pack.root, 'not-a-game-file')),
    ).rejects.toMatchObject({ code: 'file-not-found' });
    const count = source.ranges.length;
    await expect(reader.stageBrandingAsset('background', output)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(source.ranges).toHaveLength(count);
    expect(await readFile(output)).toEqual(pack.background);
    const game = join(pack.root, 'game.stage');
    await reader.stageFile('game.dat', game);
    expect(await readFile(game, 'utf8')).toBe('game payload is independent');
  });
  it('does not fetch or stage absent/removed roles in v1.0/v1.1', async () => {
    const { bytes } = await buildDeployment();
    const legacySource = new MemorySource(bytes);
    const legacy = await openDeploymentReader(legacySource, { expectedServerId: serverId });
    const pack = await buildBrandedDeployment();
    const index = { ...pack.index, branding: { icon: null } };
    const raw = rebuildContainer(
      pack.bytes,
      JSON.stringify(index),
      getPayload(pack.bytes).subarray(0, pack.index.files[0]?.storedLength),
    );
    const source = new MemorySource(raw);
    const cleared = await openDeploymentReader(source, { expectedServerId: serverId });
    expect(cleared.index.branding).toEqual({ icon: null });
    for (const [reader, memory] of [
      [legacy, legacySource],
      [cleared, source],
    ] as const) {
      const count = memory.ranges.length;
      for (const role of ['icon', 'background'] as const)
        await expect(
          reader.stageBrandingAsset(role, join(pack.root, `${role}.missing`)),
        ).rejects.toMatchObject({ code: 'branding-not-found' });
      expect(memory.ranges).toHaveLength(count);
    }
  });
  it('removes corrupted partial branding and permits a clean retry from a reopened source', async () => {
    const pack = await buildBrandedDeployment();
    const corrupted = Buffer.from(pack.bytes);
    const asset = pack.index.branding?.icon;
    if (!asset) throw new Error('Missing icon');
    const corruptedPosition = 64 + pack.header.indexLength + asset.offset;
    corrupted[corruptedPosition] = (corrupted[corruptedPosition] ?? 0) ^ 1;
    const reader = await openDeploymentReader(new MemorySource(corrupted), {
      expectedServerId: serverId,
      rangeChunkBytes: 16,
    });
    const output = join(pack.root, 'retry.stage');
    await expect(reader.stageBrandingAsset('icon', output)).rejects.toMatchObject({
      code: 'file-hash-mismatch',
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const retry = await openDeploymentReader(new MemorySource(pack.bytes), {
      expectedServerId: serverId,
    });
    await retry.stageBrandingAsset('icon', output);
    expect(await readFile(output)).toEqual(pack.icon);
  });
  it('keeps malformed branding indexes fatal and honors smaller local payload budgets', async () => {
    const pack = await buildBrandedDeployment();
    const malformed = rebuildContainer(
      pack.bytes,
      JSON.stringify({ ...pack.index, branding: { icon: null } }),
      getPayload(pack.bytes),
    );
    const source = new MemorySource(malformed);
    await expect(openDeploymentReader(source, { expectedServerId: serverId })).rejects.toThrow();
    // Opening requests metadata only; unreferenced image bytes cannot become an optional warning.
    const metadataEnd = 64 + Number(Buffer.from(malformed).readBigUInt64LE(16));
    expect(source.ranges.every((range) => range.end < metadataEnd)).toBe(true);
    for (const budget of [{ maxFileBytes: 32 }, { maxStoredFileBytes: 32 }]) {
      const limitedSource = new MemorySource(pack.bytes);
      const reader = await openDeploymentReader(limitedSource, {
        expectedServerId: serverId,
        ...budget,
      });
      const before = limitedSource.ranges.length;
      await expect(
        reader.stageBrandingAsset('icon', join(pack.root, 'limited.stage')),
      ).rejects.toMatchObject({ code: 'limit-exceeded' });
      expect(limitedSource.ranges).toHaveLength(before);
    }
  });
  it('enforces source pinning and cancellation with scratch cleanup', async () => {
    const pack = await buildBrandedDeployment();
    for (const action of ['reset', 'abort'] as const) {
      const source = new MemorySource(pack.bytes);
      const reader = await openDeploymentReader(source, {
        expectedServerId: serverId,
        rangeChunkBytes: 16,
      });
      const controller = new AbortController();
      source.beforeResponse = () => {
        if (action === 'reset') source.reset();
        else controller.abort();
      };
      const output = join(pack.root, `${action}.stage`);
      await expect(
        reader.stageBrandingAsset('icon', output, { signal: controller.signal }),
      ).rejects.toThrow();
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
