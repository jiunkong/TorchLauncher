import { createHash } from 'node:crypto';
import { type FileHandle, open, rm } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import type { ByteRange, ResourceSnapshot } from '../../download/http/index.js';
import {
  type DownloadSource,
  type SourceRangeResponse,
  SourceRestartRequiredError,
} from '../../download/source/index.js';
import {
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_LIMITS,
  type DeploymentFile,
  type DeploymentHeader,
  type DeploymentIndex,
  getDeploymentFileRange,
  validateDeploymentHeader,
  validateDeploymentIndex,
} from '../contracts/index.js';
import { DeploymentReaderError } from './errors.js';
import type {
  DeploymentReader,
  OpenDeploymentReaderOptions,
  StagedDeploymentFile,
} from './types.js';

export const DEPLOYMENT_READ_CHUNK_LENGTH = 256 * 1024;
const defaultMaxFileBytes = 1024 ** 3;
const maxGzipHeaderBytes = 64 * 1024;
const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[i] = value >>> 0;
}

interface Pin {
  readonly source: DownloadSource;
  readonly sourceId: string;
  readonly generation: number;
  readonly snapshot: ResourceSnapshot;
}

function fail(
  code: ConstructorParameters<typeof DeploymentReaderError>[0],
  cause?: unknown,
): never {
  throw new DeploymentReaderError(code, cause === undefined ? undefined : { cause });
}

function equalSnapshot(a: ResourceSnapshot, b: ResourceSnapshot): boolean {
  return a.totalLength === b.totalLength && a.etag === b.etag && a.lastModified === b.lastModified;
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function decodeHeader(bytes: Uint8Array): DeploymentHeader {
  if (bytes.byteLength !== DEPLOYMENT_HEADER_LENGTH) fail('invalid-header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder('ascii').decode(bytes.subarray(0, 8));
  const major = view.getUint16(8, true);
  const minor = view.getUint16(10, true);
  const flags = view.getUint32(12, true);
  const indexLengthBig = view.getBigUint64(16, true);
  const totalLengthBig = view.getBigUint64(24, true);
  if (
    indexLengthBig > BigInt(Number.MAX_SAFE_INTEGER) ||
    totalLengthBig > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail('invalid-header');
  }
  const indexSha256 = Array.from(bytes.subarray(32, 64), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  try {
    return validateDeploymentHeader({
      magic,
      formatVersion: { major, minor },
      flags,
      indexLength: Number(indexLengthBig),
      totalLength: Number(totalLengthBig),
      indexSha256,
    });
  } catch (error) {
    fail('invalid-header', error);
  }
}

/** Scan JSON grammar before JSON.parse so duplicate keys cannot be silently overwritten. */
function rejectDuplicateKeys(text: string): void {
  let position = 0;

  function whitespace(): void {
    while (
      text[position] === ' ' ||
      text[position] === '\n' ||
      text[position] === '\r' ||
      text[position] === '\t'
    )
      position += 1;
  }

  function string(): string {
    const start = position;
    if (text[position] !== '"') fail('invalid-index-json');
    position += 1;
    while (position < text.length) {
      const code = text.charCodeAt(position);
      if (code === 34) {
        position += 1;
        try {
          return JSON.parse(text.slice(start, position)) as string;
        } catch (error) {
          fail('invalid-index-json', error);
        }
      }
      if (code < 0x20) fail('invalid-index-json');
      if (code === 92) {
        position += 1;
        const escapeCode = text[position];
        if (escapeCode === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(position + 1, position + 5)))
            fail('invalid-index-json');
          position += 5;
          continue;
        }
        if (escapeCode === undefined || !'"\\/bfnrt'.includes(escapeCode))
          fail('invalid-index-json');
      }
      position += 1;
    }
    fail('invalid-index-json');
  }

  function value(depth = 0): void {
    if (depth > 100) fail('invalid-index-json');
    whitespace();
    const current = text[position];
    if (current === '{') {
      position += 1;
      whitespace();
      const keys = new Set<string>();
      if (text[position] === '}') {
        position += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail('invalid-index-json');
        keys.add(key);
        whitespace();
        if (text[position] !== ':') fail('invalid-index-json');
        position += 1;
        value(depth + 1);
        whitespace();
        if (text[position] === '}') {
          position += 1;
          return;
        }
        if (text[position] !== ',') fail('invalid-index-json');
        position += 1;
      }
    }
    if (current === '[') {
      position += 1;
      whitespace();
      if (text[position] === ']') {
        position += 1;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        if (text[position] === ']') {
          position += 1;
          return;
        }
        if (text[position] !== ',') fail('invalid-index-json');
        position += 1;
      }
    }
    if (current === '"') {
      string();
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      text.slice(position),
    );
    if (!number) fail('invalid-index-json');
    position += number[0].length;
  }

  value();
  whitespace();
  if (position !== text.length) fail('invalid-index-json');
}

function parseIndex(bytes: Uint8Array): unknown {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('invalid-index-encoding');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('invalid-index-encoding', error);
  }
  rejectDuplicateKeys(text);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    fail('invalid-index-json', error);
  }
}

function validateChunkLength(value: number | undefined): number {
  const chunk = value ?? DEPLOYMENT_READ_CHUNK_LENGTH;
  if (!Number.isSafeInteger(chunk) || chunk < 1 || chunk > 4 * 1024 ** 2) fail('limit-exceeded');
  return chunk;
}

function validateFileBudget(value: number | undefined): number {
  const maximum = value ?? defaultMaxFileBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > DEPLOYMENT_LIMITS.fileLength) {
    fail('limit-exceeded');
  }
  return maximum;
}

function validateStoredFileBudget(value: number | undefined): number {
  const maximum = value ?? DEPLOYMENT_LIMITS.fileLength;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > DEPLOYMENT_LIMITS.fileLength) {
    fail('limit-exceeded');
  }
  return maximum;
}

function pinFromResponse(
  source: DownloadSource,
  response: Awaited<ReturnType<DownloadSource['getRange']>>,
  pin?: Pin,
): Pin {
  if (response.sourceId !== source.sourceId || response.sourceGeneration !== source.generation) {
    fail('source-changed');
  }
  const current = source.snapshot;
  if (!current || !equalSnapshot(current, response.snapshot)) fail('source-changed');
  if (pin) {
    if (
      response.sourceId !== pin.sourceId ||
      response.sourceGeneration !== pin.generation ||
      !equalSnapshot(response.snapshot, pin.snapshot)
    ) {
      fail('source-changed');
    }
    return pin;
  }
  return {
    source,
    sourceId: response.sourceId,
    generation: response.sourceGeneration,
    snapshot: Object.freeze({ ...response.snapshot }),
  };
}

function assertPin(pin: Pin): void {
  if (
    pin.source.sourceId !== pin.sourceId ||
    pin.source.generation !== pin.generation ||
    !pin.source.snapshot ||
    !equalSnapshot(pin.source.snapshot, pin.snapshot)
  ) {
    fail('source-changed');
  }
}

async function getExactRange(
  pinState: { pin?: Pin },
  source: DownloadSource,
  range: ByteRange,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (pinState.pin) assertPin(pinState.pin);
  let response: SourceRangeResponse;
  try {
    response = await source.getRange(range, { maxBytes, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof SourceRestartRequiredError) fail('source-changed', error);
    throw error;
  }
  pinState.pin = pinFromResponse(source, response, pinState.pin);
  if (
    response.range.start !== range.start ||
    response.range.end !== range.end ||
    response.bytes.byteLength !== range.end - range.start + 1
  ) {
    fail('source-changed');
  }
  signal?.throwIfAborted();
  assertPin(pinState.pin);
  return response.bytes;
}

async function readIndex(
  source: DownloadSource,
  options: OpenDeploymentReaderOptions,
): Promise<{ header: DeploymentHeader; index: DeploymentIndex; pin: Pin }> {
  const pinState: { pin?: Pin } = {};
  const chunkBytes = validateChunkLength(options.rangeChunkBytes);
  const headerBytes = await getExactRange(
    pinState,
    source,
    { start: 0, end: DEPLOYMENT_HEADER_LENGTH - 1 },
    DEPLOYMENT_HEADER_LENGTH,
    options.signal,
  );
  const header = decodeHeader(headerBytes);
  if (!pinState.pin || header.totalLength !== pinState.pin.snapshot.totalLength)
    fail('invalid-header');
  const indexStart = DEPLOYMENT_HEADER_LENGTH;
  const indexBytes = new Uint8Array(header.indexLength);
  let offset = 0;
  while (offset < header.indexLength) {
    const length = Math.min(chunkBytes, header.indexLength - offset);
    const range = { start: indexStart + offset, end: indexStart + offset + length - 1 };
    indexBytes.set(await getExactRange(pinState, source, range, length, options.signal), offset);
    offset += length;
  }
  const actualHash = createHash('sha256').update(indexBytes).digest('hex');
  if (actualHash !== header.indexSha256) fail('index-hash-mismatch');
  const parsed = parseIndex(indexBytes);
  const index: DeploymentIndex = validateDeploymentIndex(parsed, header, {
    expectedServerId: options.expectedServerId,
  });
  const frozenHeader = freezeTree({ ...header, formatVersion: { ...header.formatVersion } });
  const frozenIndex = freezeTree(structuredClone(index));
  return { header: frozenHeader, index: frozenIndex, pin: pinState.pin };
}

class StoredByteCursor {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private current: Uint8Array = new Uint8Array();
  private offset = 0;
  private pushedBack: Uint8Array | undefined;

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  async takeChunk(): Promise<Uint8Array | undefined> {
    if (this.pushedBack) {
      const chunk = this.pushedBack;
      this.pushedBack = undefined;
      return chunk;
    }
    if (this.offset < this.current.byteLength) {
      const chunk = this.current.subarray(this.offset);
      this.offset = this.current.byteLength;
      return chunk;
    }
    const next = await this.iterator.next();
    if (next.done) return undefined;
    this.current = next.value;
    this.offset = this.current.byteLength;
    return this.current;
  }

  pushBack(bytes: Uint8Array): void {
    if (this.pushedBack || bytes.byteLength === 0) throw new Error('Invalid gzip cursor pushback');
    this.pushedBack = bytes;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const chunk = await this.takeChunk();
      if (!chunk) fail('invalid-gzip');
      const count = Math.min(chunk.byteLength, length - written);
      result.set(chunk.subarray(0, count), written);
      written += count;
      if (count < chunk.byteLength) this.pushBack(chunk.subarray(count));
    }
    return result;
  }

  async readZeroTerminated(headerCrc: { value: number }, maximum: number): Promise<number> {
    for (let count = 0; count < maximum; count += 1) {
      const byte = await this.readExactly(1);
      headerCrc.value = crc32Update(headerCrc.value, byte);
      if (byte[0] === 0) return count + 1;
    }
    fail('invalid-gzip');
  }

  async assertEnd(): Promise<void> {
    if (await this.takeChunk()) fail('invalid-gzip');
  }
}

function crc32Update(previous: number, bytes: Uint8Array): number {
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function parseGzipHeader(cursor: StoredByteCursor, storedLength: number): Promise<void> {
  const crc = { value: 0 };
  const fixed = await cursor.readExactly(10);
  crc.value = crc32Update(crc.value, fixed);
  if (fixed[0] !== 0x1f || fixed[1] !== 0x8b || fixed[2] !== 8 || ((fixed[3] ?? 0) & 0xe0) !== 0) {
    fail('invalid-gzip');
  }
  const flags = fixed[3] ?? 0;
  let headerBytes = 10;
  if ((flags & 4) !== 0) {
    const lengthBytes = await cursor.readExactly(2);
    crc.value = crc32Update(crc.value, lengthBytes);
    const view = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, 2);
    const extraLength = view.getUint16(0, true);
    if (headerBytes + 2 + extraLength > maxGzipHeaderBytes) fail('limit-exceeded');
    const extra = await cursor.readExactly(extraLength);
    crc.value = crc32Update(crc.value, extra);
    headerBytes += 2 + extraLength;
  }
  if ((flags & 8) !== 0) {
    const readLength = await cursor.readZeroTerminated(
      crc,
      Math.min(storedLength - headerBytes, maxGzipHeaderBytes - headerBytes),
    );
    headerBytes += readLength;
  }
  if ((flags & 16) !== 0) {
    const readLength = await cursor.readZeroTerminated(
      crc,
      Math.min(storedLength - headerBytes, maxGzipHeaderBytes - headerBytes),
    );
    headerBytes += readLength;
  }
  if ((flags & 2) !== 0) {
    if (headerBytes + 2 > maxGzipHeaderBytes) fail('limit-exceeded');
    const expected = await cursor.readExactly(2);
    const actual = crc.value & 0xffff;
    const expectedCrc = (expected[0] ?? 0) | ((expected[1] ?? 0) << 8);
    if (expectedCrc !== actual) fail('invalid-gzip');
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (result.bytesWritten === 0) throw new Error('File write made no progress');
    offset += result.bytesWritten;
  }
}

function sameCrc(expected: number, actual: number): boolean {
  return expected >>> 0 === actual >>> 0;
}

async function stagePayload(
  pin: Pin,
  file: DeploymentFile,
  header: DeploymentHeader,
  output: FileHandle,
  options: { chunkBytes: number; maxFileBytes: number; signal?: AbortSignal },
): Promise<{ length: number; sha256: string }> {
  const range = getDeploymentFileRange(header, file);
  const digest = createHash('sha256');
  let originalLength = 0;
  let crc = 0;
  const writeOutput = async (bytes: Uint8Array) => {
    options.signal?.throwIfAborted();
    originalLength += bytes.byteLength;
    if (originalLength > options.maxFileBytes || originalLength > file.originalLength)
      fail('limit-exceeded');
    digest.update(bytes);
    crc = crc32Update(crc, bytes);
    await writeAll(output, bytes);
    options.signal?.throwIfAborted();
  };

  async function* fetchChunks(): AsyncGenerator<Uint8Array> {
    if (!range) return;
    let start = range.start;
    while (start <= range.endInclusive) {
      options.signal?.throwIfAborted();
      assertPin(pin);
      const end = Math.min(start + options.chunkBytes - 1, range.endInclusive);
      const bytes = await getExactRange(
        { pin },
        pin.source,
        { start, end },
        options.chunkBytes,
        options.signal,
      );
      yield bytes;
      start = end + 1;
    }
  }

  if (file.compression === 'none') {
    for await (const chunk of fetchChunks()) await writeOutput(chunk);
  } else {
    const cursor = new StoredByteCursor(fetchChunks());
    await parseGzipHeader(cursor, file.storedLength);
    const inflater = createInflateRaw();
    const consume = (async (): Promise<{ ok: true } | { ok: false; error: unknown }> => {
      for await (const outputChunk of inflater) await writeOutput(outputChunk as Uint8Array);
      return { ok: true };
    })().catch((error: unknown) => ({ ok: false as const, error }));
    let feedError: unknown;
    let consumeResult: { ok: true } | { ok: false; error: unknown };
    try {
      while (true) {
        options.signal?.throwIfAborted();
        assertPin(pin);
        const chunk = await cursor.takeChunk();
        if (!chunk) break;
        const before = inflater.bytesWritten;
        await new Promise<void>((resolve, reject) => {
          inflater.write(chunk, (error) => (error ? reject(error) : resolve()));
        });
        const consumed = inflater.bytesWritten - before;
        if (consumed < chunk.byteLength) {
          cursor.pushBack(chunk.subarray(consumed));
          break;
        }
      }
      inflater.end();
    } catch (error) {
      feedError = error;
    } finally {
      if (feedError !== undefined) inflater.destroy();
      consumeResult = await consume;
      if (!consumeResult.ok) inflater.destroy();
    }
    if (feedError !== undefined) {
      if (feedError instanceof DeploymentReaderError || options.signal?.aborted) throw feedError;
      fail('invalid-gzip', feedError);
    }
    if (!consumeResult.ok) {
      if (consumeResult.error instanceof DeploymentReaderError || options.signal?.aborted) {
        throw consumeResult.error;
      }
      fail('invalid-gzip', consumeResult.error);
    }
    const trailer = await cursor.readExactly(8);
    const trailerView = new DataView(trailer.buffer, trailer.byteOffset, trailer.byteLength);
    if (!sameCrc(trailerView.getUint32(0, true), crc)) fail('invalid-gzip');
    if (trailerView.getUint32(4, true) !== originalLength >>> 0) fail('invalid-gzip');
    await cursor.assertEnd();
  }
  const actualHash = digest.digest('hex');
  if (originalLength !== file.originalLength) {
    fail(file.compression === 'gzip' ? 'invalid-gzip' : 'limit-exceeded');
  }
  if (actualHash !== file.sha256) fail('file-hash-mismatch');
  assertPin(pin);
  return { length: originalLength, sha256: actualHash };
}

class DeploymentReaderImpl implements DeploymentReader {
  readonly header: DeploymentHeader;
  readonly index: DeploymentIndex;
  readonly sourceId: string;
  readonly sourceGeneration: number;
  readonly snapshot: ResourceSnapshot;
  private readonly pin: Pin;
  private readonly chunkBytes: number;
  private readonly maxFileBytes: number;
  private readonly maxStoredFileBytes: number;

  constructor(result: Awaited<ReturnType<typeof readIndex>>, options: OpenDeploymentReaderOptions) {
    this.header = result.header;
    this.index = result.index;
    this.pin = result.pin;
    this.sourceId = result.pin.sourceId;
    this.sourceGeneration = result.pin.generation;
    this.snapshot = result.pin.snapshot;
    this.chunkBytes = validateChunkLength(options.rangeChunkBytes);
    this.maxFileBytes = validateFileBudget(options.maxFileBytes);
    this.maxStoredFileBytes = validateStoredFileBudget(options.maxStoredFileBytes);
  }

  assertCurrent(): void {
    assertPin(this.pin);
  }

  async stageFile(
    path: string,
    newScratchPath: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StagedDeploymentFile> {
    const file = this.index.files.find((entry) => entry.path === path);
    if (!file) fail('file-not-found');
    if (file.originalLength > this.maxFileBytes) fail('limit-exceeded');
    if (file.storedLength > this.maxStoredFileBytes) fail('limit-exceeded');
    this.assertCurrent();
    options.signal?.throwIfAborted();
    let handle: FileHandle | undefined;
    let created = false;
    try {
      handle = await open(newScratchPath, 'wx', 0o600);
      created = true;
      const result = await stagePayload(this.pin, file, this.header, handle, {
        chunkBytes: this.chunkBytes,
        maxFileBytes: this.maxFileBytes,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      options.signal?.throwIfAborted();
      this.assertCurrent();
      await handle.sync();
      await handle.close();
      handle = undefined;
      return Object.freeze({ path: file.path, outputPath: newScratchPath, ...result });
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        handle = undefined;
      }
      if (created) await rm(newScratchPath, { force: true });
      throw error;
    } finally {
      await handle?.close();
    }
  }
}

export async function openDeploymentReader(
  source: DownloadSource,
  options: OpenDeploymentReaderOptions,
): Promise<DeploymentReader> {
  options.signal?.throwIfAborted();
  validateFileBudget(options.maxFileBytes);
  validateStoredFileBudget(options.maxStoredFileBytes);
  const result = await readIndex(source, options);
  return new DeploymentReaderImpl(result, options);
}
