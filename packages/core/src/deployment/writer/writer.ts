import { createHash } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  BRANDING_LIMITS,
  BRANDING_ROLES,
  type BrandingRole,
  DEPLOYMENT_FORMAT_VERSION,
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_MAGIC,
  DEPLOYMENT_SIGNATURE_LENGTH,
  type DeploymentBranding,
  type DeploymentBrandingAsset,
  type DeploymentFile,
  type DeploymentHeader,
  type DeploymentIndex,
  deploymentIndexStart,
  EMPTY_FILE_SHA256,
  inspectBrandingImage,
  validateDeploymentHeader,
  validateDeploymentIndex,
} from '../contracts/index.js';
import { deploymentSignatureMessage } from '../signing/index.js';
import type {
  DeploymentInputFile,
  DeploymentWriteProgress,
  WriteDeploymentOptions,
  WriteDeploymentResult,
} from './types.js';

export const DEPLOYMENT_WRITE_CHUNK_LENGTH = 256 * 1024;

export class DeploymentWriteError extends Error {
  constructor(
    public readonly code:
      | 'invalid-input'
      | 'invalid-signature'
      | 'unsafe-path'
      | 'source-changed'
      | 'output-changed'
      | 'limit-exceeded',
  ) {
    super(`Deployment write failed: ${code}`);
    this.name = 'DeploymentWriteError';
  }
}

interface Snapshot {
  readonly path: string;
  readonly stat: BigIntStats;
  readonly directories: readonly string[];
}

function fail(code: DeploymentWriteError['code']): never {
  throw new DeploymentWriteError(code);
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    sameIdentity(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.nlink === b.nlink
  );
}

async function maybeStat(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function verifyDirectories(
  directories: ReadonlyMap<string, BigIntStats>,
  paths: Iterable<string> = directories.keys(),
): Promise<void> {
  for (const path of paths) {
    const original = directories.get(path);
    const current = await maybeStat(path);
    if (!original || !current?.isDirectory() || !sameIdentity(original, current))
      fail('source-changed');
  }
}

async function verifySource(snapshot: Snapshot, root: string): Promise<void> {
  const current = await maybeStat(snapshot.path);
  if (!current?.isFile() || !sameFile(snapshot.stat, current)) fail('source-changed');
  if (!within(root, await realpath(snapshot.path))) fail('unsafe-path');
}

function sourcePath(root: string, path: string): string {
  if (
    typeof path !== 'string' ||
    path.length > 1024 ||
    /[\\:\p{C}]/u.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail('unsafe-path');
  }
  const absolute = resolve(root, ...path.split('/'));
  if (!within(root, absolute)) fail('unsafe-path');
  return absolute;
}

async function inspectSource(
  root: string,
  input: DeploymentInputFile,
  directories: Map<string, BigIntStats>,
): Promise<Snapshot> {
  const absolute = sourcePath(root, input.sourcePath);
  const components = relative(root, absolute).split(sep);
  const parents = [root];
  let current = root;
  for (const part of components.slice(0, -1)) {
    current = join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe-path');
    const previous = directories.get(current);
    if (previous && !sameIdentity(previous, stat)) fail('source-changed');
    directories.set(current, stat);
    parents.push(current);
  }
  const stat = await lstat(absolute, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('unsafe-path');
  if (stat.size > BigInt(DEPLOYMENT_LIMITS.fileLength)) fail('limit-exceeded');
  if (!within(root, await realpath(absolute))) fail('unsafe-path');
  return { path: absolute, stat, directories: parents };
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten === 0) throw new Error('File write made no progress');
    offset += result.bytesWritten;
  }
}

async function progress(
  options: WriteDeploymentOptions,
  event: DeploymentWriteProgress,
): Promise<void> {
  options.signal?.throwIfAborted();
  await options.onProgress?.(event);
  options.signal?.throwIfAborted();
}

/** Build at most 16 MiB of index bytes, never an unbounded joined JSON string. */
function encodeIndex(index: DeploymentIndex): Buffer {
  const { files, ...metadata } = index;
  const prefix = `${JSON.stringify(metadata).slice(0, -1)},"files":[`;
  const chunks = [Buffer.from(prefix)];
  let length = chunks[0]?.byteLength ?? 0;
  for (const [position, entry] of files.entries()) {
    const bytes = Buffer.from(`${position === 0 ? '' : ','}${JSON.stringify(entry)}`);
    length += bytes.byteLength;
    if (length + 2 > DEPLOYMENT_LIMITS.indexLength) fail('limit-exceeded');
    chunks.push(bytes);
  }
  chunks.push(Buffer.from(']}'));
  return Buffer.concat(chunks);
}

function makeHeader(indexBytes: Buffer, payloadLength: number): DeploymentHeader {
  return validateDeploymentHeader({
    magic: DEPLOYMENT_MAGIC,
    formatVersion: DEPLOYMENT_FORMAT_VERSION,
    flags: 0,
    indexLength: indexBytes.byteLength,
    totalLength: deploymentIndexStart() + indexBytes.byteLength + payloadLength,
    indexSha256: createHash('sha256').update(indexBytes).digest('hex'),
  });
}

function encodeHeader(header: DeploymentHeader): Buffer {
  const bytes = Buffer.alloc(DEPLOYMENT_HEADER_LENGTH);
  bytes.write(DEPLOYMENT_MAGIC, 0, 'ascii');
  bytes.writeUInt16LE(header.formatVersion.major, 8);
  bytes.writeUInt16LE(header.formatVersion.minor, 10);
  bytes.writeUInt32LE(header.flags, 12);
  bytes.writeBigUInt64LE(BigInt(header.indexLength), 16);
  bytes.writeBigUInt64LE(BigInt(header.totalLength), 24);
  Buffer.from(header.indexSha256, 'hex').copy(bytes, 32);
  return bytes;
}

async function stageFile(
  snapshot: Snapshot,
  input: DeploymentInputFile,
  path: string,
  payload: FileHandle,
  payloadOffset: number,
  root: string,
  options: WriteDeploymentOptions,
): Promise<DeploymentFile> {
  await verifySource(snapshot, root);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const source = await open(snapshot.path, flags);
  try {
    if (!sameFile(snapshot.stat, await source.stat({ bigint: true }))) fail('source-changed');
    const digest = createHash('sha256');
    const compression = snapshot.stat.size === 0n ? 'none' : input.compression;
    let originalLength = 0;
    let storedLength = 0;
    async function* bytes() {
      while (true) {
        options.signal?.throwIfAborted();
        const buffer = Buffer.allocUnsafe(DEPLOYMENT_WRITE_CHUNK_LENGTH);
        const { bytesRead } = await source.read(buffer, 0, buffer.length, originalLength);
        if (bytesRead === 0) break;
        originalLength += bytesRead;
        if (originalLength > Number(snapshot.stat.size)) fail('source-changed');
        digest.update(buffer.subarray(0, bytesRead));
        await progress(options, {
          phase: 'reading',
          sourcePath: input.sourcePath,
          processedBytes: originalLength,
        });
        yield buffer.subarray(0, bytesRead);
      }
    }
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        storedLength += chunk.byteLength;
        if (
          storedLength > DEPLOYMENT_LIMITS.fileLength ||
          payloadOffset + storedLength + DEPLOYMENT_HEADER_LENGTH + DEPLOYMENT_SIGNATURE_LENGTH >
            DEPLOYMENT_LIMITS.containerLength
        ) {
          callback(new DeploymentWriteError('limit-exceeded'));
          return;
        }
        writeAll(payload, chunk).then(() => callback(), callback);
      },
    });
    const stages = compression === 'gzip' ? createGzip() : new PassThrough();
    await pipeline(Readable.from(bytes(), { objectMode: false }), stages, sink, {
      signal: options.signal,
    });
    if (originalLength !== Number(snapshot.stat.size)) fail('source-changed');
    if (!sameFile(snapshot.stat, await source.stat({ bigint: true }))) fail('source-changed');
    await verifySource(snapshot, root);
    if (
      compression === 'gzip' &&
      originalLength > storedLength * DEPLOYMENT_LIMITS.compressionRatio
    ) {
      fail('limit-exceeded');
    }
    return {
      path,
      sha256: digest.digest('hex'),
      offset: payloadOffset,
      storedLength,
      originalLength,
      compression,
      policy: input.policy,
    };
  } finally {
    await source.close();
  }
}

interface BrandingSnapshot {
  readonly bytes: Uint8Array;
  readonly asset: DeploymentBrandingAsset;
}

function snapshotBranding(options: WriteDeploymentOptions): {
  branding: DeploymentBranding;
  snapshots: Partial<Record<BrandingRole, BrandingSnapshot>>;
  length: number;
} {
  const input = options.branding === undefined ? {} : options.branding;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((role) => role !== 'icon' && role !== 'background')
  )
    fail('invalid-input');
  const branding: {
    icon?: DeploymentBrandingAsset | null;
    background?: DeploymentBrandingAsset | null;
  } = {};
  const snapshots: Partial<Record<BrandingRole, BrandingSnapshot>> = {};
  let length = 0;
  for (const role of BRANDING_ROLES) {
    if (!Object.hasOwn(input, role)) continue;
    const image = input[role];
    if (image === null) {
      branding[role] = null;
      continue;
    }
    if (
      !image ||
      typeof image !== 'object' ||
      Object.keys(image).length !== 2 ||
      !Object.hasOwn(image, 'bytes') ||
      !Object.hasOwn(image, 'mediaType') ||
      !(image.bytes instanceof Uint8Array)
    )
      fail('invalid-input');
    if (image.bytes.byteLength < 1 || image.bytes.byteLength > BRANDING_LIMITS[role].length)
      fail('limit-exceeded');
    const bytes = Uint8Array.from(image.bytes);
    try {
      inspectBrandingImage(role, image.mediaType, bytes);
    } catch {
      fail('invalid-input');
    }
    const asset: DeploymentBrandingAsset = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      offset: length,
      storedLength: bytes.byteLength,
      originalLength: bytes.byteLength,
      compression: 'none',
      mediaType: image.mediaType,
    };
    snapshots[role] = { bytes, asset };
    branding[role] = asset;
    length += bytes.byteLength;
  }
  return { branding, snapshots, length };
}

/** Atomically publish a validated snapshot; no existing output is opened for writing. */
export async function writeDeployment(
  options: WriteDeploymentOptions,
): Promise<WriteDeploymentResult> {
  options.signal?.throwIfAborted();
  if (!Array.isArray(options.files) || options.files.length > DEPLOYMENT_LIMITS.fileCount)
    fail('invalid-input');
  // Snapshot caller-owned metadata before awaiting filesystem operations.
  const brandingSnapshot = snapshotBranding(options);
  if (
    typeof options.sign !== 'function' ||
    typeof options.sequence !== 'number' ||
    !Number.isSafeInteger(options.sequence) ||
    options.sequence < 1
  )
    fail('invalid-input');
  const sign = options.sign;
  const formatVersion = DEPLOYMENT_FORMAT_VERSION;
  const inputs = options.files.map((entry) => ({ ...entry }));
  const placeholders = inputs.map((input): DeploymentFile => {
    if (
      typeof input.sourcePath !== 'string' ||
      (input.path !== undefined && typeof input.path !== 'string')
    )
      fail('invalid-input');
    if (input.compression !== 'none' && input.compression !== 'gzip') fail('invalid-input');
    return {
      path: (input.path ?? input.sourcePath).normalize('NFC'),
      sha256: EMPTY_FILE_SHA256,
      offset: 0,
      storedLength: 0,
      originalLength: 0,
      compression: 'none',
      policy: input.policy,
    };
  });
  const initialIndex: DeploymentIndex = {
    formatVersion,
    serverId: options.serverId,
    deploymentId: options.deploymentId,
    sequence: options.sequence,
    game: structuredClone(options.game),
    files: placeholders,
    branding: brandingSnapshot.branding,
  };
  const initialHeader = makeHeader(Buffer.from('{}'), brandingSnapshot.length);
  validateDeploymentIndex(initialIndex, initialHeader, { expectedServerId: initialIndex.serverId });
  encodeIndex(initialIndex);

  const rootInput = resolve(options.sourceRoot);
  const rootStat = await lstat(rootInput, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('unsafe-path');
  const root = await realpath(rootInput);
  const directories = new Map([[root, rootStat]]);
  const parent = await realpath(dirname(resolve(options.outputPath)));
  const parentStat = await lstat(parent, { bigint: true });
  if (!parentStat.isDirectory()) fail('unsafe-path');
  const outputPath = join(parent, basename(resolve(options.outputPath)));
  const originalOutput = await maybeStat(outputPath);
  if (originalOutput && !originalOutput.isFile()) fail('unsafe-path');
  const sources: Snapshot[] = [];
  let totalOriginal = BigInt(brandingSnapshot.length);
  for (const input of inputs) {
    options.signal?.throwIfAborted();
    const source = await inspectSource(root, input, directories);
    if (source.path === outputPath || (originalOutput && sameIdentity(source.stat, originalOutput)))
      fail('unsafe-path');
    totalOriginal += source.stat.size;
    if (totalOriginal > BigInt(DEPLOYMENT_LIMITS.totalOriginalLength)) fail('limit-exceeded');
    sources.push(source);
  }
  const staging = await mkdtemp(join(parent, '.torchpack-'));
  let committed = false;
  try {
    const payloadPath = join(staging, 'payload');
    const payload = await open(payloadPath, 'wx+', 0o600);
    let payloadOpen = true;
    const entries: DeploymentFile[] = [];
    let payloadLength = 0;
    try {
      for (const [i, source] of sources.entries()) {
        await verifyDirectories(directories, source.directories);
        const input = inputs[i];
        const placeholder = placeholders[i];
        if (!input || !placeholder) fail('invalid-input');
        const entry = await stageFile(
          source,
          input,
          placeholder.path,
          payload,
          payloadLength,
          root,
          options,
        );
        entries.push(entry);
        payloadLength += entry.storedLength;
      }
      const branding: {
        icon?: DeploymentBrandingAsset | null;
        background?: DeploymentBrandingAsset | null;
      } = {};
      for (const role of BRANDING_ROLES) {
        if (!Object.hasOwn(brandingSnapshot.branding, role)) continue;
        const snapshot = brandingSnapshot.snapshots[role];
        if (!snapshot) {
          branding[role] = null;
          continue;
        }
        branding[role] = { ...snapshot.asset, offset: payloadLength };
        options.signal?.throwIfAborted();
        if (
          payloadLength +
            snapshot.bytes.byteLength +
            DEPLOYMENT_HEADER_LENGTH +
            DEPLOYMENT_SIGNATURE_LENGTH >
          DEPLOYMENT_LIMITS.containerLength
        )
          fail('limit-exceeded');
        await writeAll(payload, snapshot.bytes);
        payloadLength += snapshot.bytes.byteLength;
      }
      const index: DeploymentIndex = {
        ...initialIndex,
        files: entries,
        branding,
      };
      const indexBytes = encodeIndex(index);
      const header = makeHeader(indexBytes, payloadLength);
      validateDeploymentIndex(index, header, { expectedServerId: index.serverId });
      const result: unknown = await sign(deploymentSignatureMessage(encodeHeader(header)));
      if (!(result instanceof Uint8Array) || result.byteLength !== DEPLOYMENT_SIGNATURE_LENGTH)
        fail('invalid-signature');
      const signature = Buffer.from(result);
      options.signal?.throwIfAborted();
      const candidatePath = join(staging, 'container');
      const candidate = await open(candidatePath, 'wx', 0o600);
      try {
        await writeAll(candidate, encodeHeader(header));
        await writeAll(candidate, signature);
        await writeAll(candidate, indexBytes);
        let copied = 0;
        await progress(options, { phase: 'assembling', processedBytes: 0 });
        while (copied < payloadLength) {
          options.signal?.throwIfAborted();
          const buffer = Buffer.allocUnsafe(
            Math.min(DEPLOYMENT_WRITE_CHUNK_LENGTH, payloadLength - copied),
          );
          const { bytesRead } = await payload.read(buffer, 0, buffer.length, copied);
          if (bytesRead === 0) throw new Error('Staged payload was truncated');
          await writeAll(candidate, buffer.subarray(0, bytesRead));
          copied += bytesRead;
          await progress(options, { phase: 'assembling', processedBytes: copied });
        }
        await candidate.sync();
      } finally {
        await candidate.close();
      }
      await payload.close();
      payloadOpen = false;
      await rm(payloadPath);
      await verifyDirectories(directories);
      for (const source of sources) await verifySource(source, root);
      const currentOutput = await maybeStat(outputPath);
      if (
        !sameIdentity(parentStat, await lstat(parent, { bigint: true })) ||
        (originalOutput
          ? !currentOutput || !sameFile(originalOutput, currentOutput)
          : currentOutput !== undefined)
      )
        fail('output-changed');
      options.signal?.throwIfAborted();
      await rename(candidatePath, outputPath);
      committed = true;
      return { outputPath, header, index };
    } finally {
      if (payloadOpen) await payload.close();
    }
  } finally {
    // After the commit point only an empty private directory remains; cleanup cannot undo commit.
    const cleanup = rm(staging, { recursive: true, force: true });
    if (committed) await cleanup.catch(() => undefined);
    else await cleanup;
  }
}
