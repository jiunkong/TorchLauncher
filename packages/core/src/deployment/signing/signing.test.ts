import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tinyPng } from '../../branding/fixtures/images.js';
import type { ByteRange, ResourceSnapshot } from '../../download/http/index.js';
import type { DownloadSource, SourceRangeResponse } from '../../download/source/index.js';
import { createValidDeployment } from '../contracts/fixtures/valid.js';
import {
  DEPLOYMENT_SIGNATURE_CONTEXT,
  type DeploymentHeader,
  validateDeploymentHeader,
  validateDeploymentIndex,
} from '../contracts/index.js';
import { DeploymentReaderError, openDeploymentReader } from '../reader/index.js';
import { DeploymentWriteError, writeDeployment } from '../writer/index.js';
import {
  createEd25519Signer,
  type DeploymentRollbackState,
  decideRollback,
  deriveEd25519PublicKey,
} from './index.js';

const serverId = '11111111-1111-4111-8111-111111111111';
const deploymentId = '22222222-2222-4222-8222-222222222222';
const game = { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } } as const;
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'torch-sign-test-'));
  temps.push(directory);
  return directory;
}

class MemorySource implements DownloadSource {
  readonly kind = 'https' as const;
  readonly sourceId = 'memory://signed';
  readonly generation = 0;
  readonly snapshot: ResourceSnapshot;
  reset(): void {
    throw new Error('not used');
  }
  readonly ranges: ByteRange[] = [];
  constructor(private readonly bytes: Uint8Array) {
    this.snapshot = { totalLength: bytes.byteLength, etag: '"stable"', lastModified: null };
  }
  async getRange(range: ByteRange): Promise<SourceRangeResponse> {
    if (range.start < 0 || range.end >= this.bytes.byteLength) throw new Error('Range outside');
    this.ranges.push({ ...range });
    return {
      sourceId: this.sourceId,
      sourceGeneration: this.generation,
      range: { ...range },
      bytes: this.bytes.slice(range.start, range.end + 1),
      snapshot: { ...this.snapshot },
    };
  }
}

function newKey(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey: deriveEd25519PublicKey(privateKey) };
}

const key = newKey();
const otherKey = newKey();

interface Built {
  bytes: Buffer;
  indexLength: number;
  result: Awaited<ReturnType<typeof writeDeployment>>;
}

async function build(
  options: { signer?: KeyObject | null; sequence?: number; branding?: boolean } = {},
): Promise<Built> {
  const root = await temp();
  await writeFile(join(root, 'plain.dat'), Buffer.from('plain payload'));
  await writeFile(join(root, 'zip.bin'), Buffer.from('compress me '.repeat(100)));
  const signer = options.signer === undefined ? key.privateKey : options.signer;
  const result = await writeDeployment({
    sourceRoot: root,
    outputPath: join(root, 'out.torchpack'),
    serverId,
    deploymentId,
    game,
    files: [
      { sourcePath: 'plain.dat', policy: 'always', compression: 'none' },
      { sourcePath: 'zip.bin', policy: 'initial-only', compression: 'gzip' },
    ],
    ...(options.branding
      ? { branding: { icon: { bytes: tinyPng(), mediaType: 'image/png' as const } } }
      : {}),
    ...(signer ? { sign: createEd25519Signer(signer), sequence: options.sequence ?? 7 } : {}),
  });
  const bytes = await readFile(result.outputPath);
  return { bytes, indexLength: result.header.indexLength, result };
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function open(bytes: Uint8Array, trustedPublicKey?: string | Uint8Array, id = serverId) {
  const source = new MemorySource(bytes);
  return {
    source,
    reader: openDeploymentReader(source, {
      expectedServerId: id,
      ...(trustedPublicKey === undefined ? {} : { trustedPublicKey }),
    }),
  };
}

async function expectReaderError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'DeploymentReaderError', code });
}

describe('signed container 1.2 round trip', () => {
  it.each([false, true])(
    'writes and verifies a signed deployment (branding=%s)',
    async (branding) => {
      const { bytes, indexLength, result } = await build({ branding });
      expect(result.header.formatVersion).toEqual({ major: 1, minor: 2 });
      expect(result.header.totalLength).toBe(bytes.byteLength);
      expect(result.index.sequence).toBe(7);
      if (branding) expect(result.index.branding?.icon).toBeTruthy();
      else expect(result.index.branding).toEqual({});

      const { source, reader: pending } = open(bytes, key.publicKey);
      const reader = await pending;
      expect(reader.verification).toBe('verified');
      expect(reader.index.sequence).toBe(7);
      // Byte-exact request plan: header, signature, then the index only.
      expect(source.ranges).toEqual([
        { start: 0, end: 63 },
        { start: 64, end: 127 },
        { start: 128, end: 127 + indexLength },
      ]);

      const dir = await temp();
      source.ranges.length = 0;
      const plain = reader.index.files[0];
      const zipped = reader.index.files[1];
      if (!plain || !zipped) throw new Error('fixture');
      const staged = await reader.stageFile(plain.path, join(dir, 'a'));
      expect((await readFile(staged.outputPath)).toString()).toBe('plain payload');
      expect(source.ranges).toEqual([
        {
          start: 128 + indexLength + plain.offset,
          end: 128 + indexLength + plain.offset + plain.storedLength - 1,
        },
      ]);
      source.ranges.length = 0;
      const zip = await reader.stageFile(zipped.path, join(dir, 'b'));
      expect(zip.sha256).toBe(zipped.sha256);
      expect(source.ranges[0]?.start).toBe(128 + indexLength + zipped.offset);
      expect(source.ranges.at(-1)?.end).toBe(
        128 + indexLength + zipped.offset + zipped.storedLength - 1,
      );
      if (branding) {
        source.ranges.length = 0;
        const icon = reader.index.branding?.icon;
        if (!icon) throw new Error('fixture');
        const asset = await reader.stageBrandingAsset('icon', join(dir, 'icon'));
        expect(Buffer.compare(await readFile(asset.outputPath), tinyPng())).toBe(0);
        expect(source.ranges[0]?.start).toBe(128 + indexLength + icon.offset);
      }
      expect(bytes.byteLength).toBe(
        128 + indexLength + result.header.totalLength - 128 - indexLength,
      );
    },
  );

  it('signs exactly the context prefix plus the 64 header bytes', async () => {
    const root = await temp();
    let message: Buffer | undefined;
    const result = await writeDeployment({
      sourceRoot: root,
      outputPath: join(root, 'o.torchpack'),
      serverId,
      deploymentId,
      game,
      files: [],
      sequence: 1,
      sign: async (m) => {
        message = m;
        return createEd25519Signer(key.privateKey)(m);
      },
    });
    const bytes = await readFile(result.outputPath);
    expect(message?.subarray(0, 17).toString('latin1')).toBe('TORCHPACK-SIG-v1\0');
    expect(DEPLOYMENT_SIGNATURE_CONTEXT).toBe('TORCHPACK-SIG-v1\0');
    expect(message?.byteLength).toBe(17 + 64);
    expect(Buffer.compare(message?.subarray(17) ?? Buffer.alloc(0), bytes.subarray(0, 64))).toBe(0);
    expect(bytes.byteLength).toBe(128 + result.header.indexLength);
    await (await open(bytes, key.publicKey).reader).assertCurrent();
  });
});

describe('verification states and key requirements', () => {
  it('reports a structurally valid 1.2 without a key as unverified', async () => {
    const { bytes } = await build();
    expect((await open(bytes).reader).verification).toBe('unverified');
  });

  it('reports unsigned 1.0/1.1 as unsigned when no key is configured', async () => {
    const v10 = await build({ signer: null });
    const v11 = await build({ signer: null, branding: true });
    expect(v10.result.header.formatVersion.minor).toBe(0);
    expect(v11.result.header.formatVersion.minor).toBe(1);
    expect((await open(v10.bytes).reader).verification).toBe('unsigned');
    expect((await open(v11.bytes).reader).verification).toBe('unsigned');
  });

  it.each([false, true])(
    'rejects unsigned containers when a key is required before reading the index (branding=%s)',
    async (branding) => {
      const { bytes } = await build({ signer: null, branding });
      const { source, reader } = open(bytes, key.publicKey);
      await expectReaderError(reader, 'signature-required');
      expect(source.ranges).toEqual([{ start: 0, end: 63 }]);
    },
  );

  it('rejects a downgrade of a signed container to 1.0/1.1 when a key is required', async () => {
    const { bytes } = await build();
    for (const minor of [0, 1]) {
      const forged = Buffer.from(bytes);
      forged.writeUInt16LE(minor, 10);
      await expectReaderError(open(forged, key.publicKey).reader, 'signature-required');
    }
  });

  it('rejects a signature from another key and never stages', async () => {
    const forged = await build({ signer: otherKey.privateKey });
    const { source, reader } = open(forged.bytes, key.publicKey);
    await expectReaderError(reader, 'signature-invalid');
    // Only header, signature and index were requested; no payload range.
    expect(source.ranges).toHaveLength(3);
    expect(source.ranges.every((r) => r.end <= 127 + forged.indexLength)).toBe(true);
    // The same container verifies under the key that made it.
    expect((await open(forged.bytes, otherKey.publicKey).reader).verification).toBe('verified');
  });

  it('rejects malformed trusted keys before any request', async () => {
    const { bytes } = await build();
    const bad = [
      '',
      'abc',
      `${key.publicKey}=`,
      key.publicKey.slice(1),
      `${key.publicKey}A`,
      Buffer.alloc(32).toString('base64'),
      new Uint8Array(31),
      new Uint8Array(33),
    ];
    for (const trusted of bad) {
      const { source, reader } = open(bytes, trusted);
      await expectReaderError(reader, 'invalid-signing-key');
      expect(source.ranges).toEqual([]);
    }
    // Raw bytes are accepted.
    const raw = Buffer.from(key.publicKey, 'base64url');
    expect((await open(bytes, raw).reader).verification).toBe('verified');
  });

  it('keeps cross-server handling: a valid signature does not bypass serverId', async () => {
    const { bytes } = await build();
    await expect(
      open(bytes, key.publicKey, '33333333-3333-4333-8333-333333333333').reader,
    ).rejects.toMatchObject({ name: 'DeploymentValidationError', code: 'server-mismatch' });
  });

  it('rejects a replay of a validly signed container only through rollback logic, not the reader', async () => {
    const older = await build({ sequence: 3 });
    const newer = await build({ sequence: 4 });
    const a = await open(older.bytes, key.publicKey).reader;
    const b = await open(newer.bytes, key.publicKey).reader;
    const state = (r: typeof a): DeploymentRollbackState => ({
      sequence: r.index.sequence as number,
      deploymentId: r.index.deploymentId,
      indexSha256: r.header.indexSha256,
    });
    expect(decideRollback(state(b), state(a))).toBe('reject-lower');
    expect(decideRollback(state(a), state(b))).toBe('accept');
  });
});

describe('tampering and truncation of a signed container', () => {
  it('rejects a flip of every header byte', async () => {
    const { bytes } = await build();
    for (let i = 0; i < 64; i++) {
      const forged = Buffer.from(bytes);
      forged[i] = (forged[i] ?? 0) ^ 0x01;
      const rejected = open(forged, key.publicKey).reader;
      await expect(rejected, `header byte ${i}`).rejects.toBeInstanceOf(DeploymentReaderError);
      if (i >= 32)
        await expectReaderError(open(forged, key.publicKey).reader, 'index-hash-mismatch');
    }
  });

  it('rejects a flip of every signature byte', async () => {
    const { bytes } = await build();
    for (let i = 64; i < 128; i++) {
      const forged = Buffer.from(bytes);
      forged[i] = (forged[i] ?? 0) ^ 0x80;
      await expectReaderError(open(forged, key.publicKey).reader, 'signature-invalid');
    }
  });

  it('rejects a flip of every index byte', async () => {
    const { bytes, indexLength } = await build({ branding: true });
    for (let i = 128; i < 128 + indexLength; i++) {
      const forged = Buffer.from(bytes);
      forged[i] = (forged[i] ?? 0) ^ 0x01;
      await expectReaderError(open(forged, key.publicKey).reader, 'index-hash-mismatch');
    }
  });

  it('rejects an index swapped together with its recomputed header hash', async () => {
    const { bytes, indexLength } = await build();
    const text = bytes.subarray(128, 128 + indexLength).toString('utf8');
    const swapped = Buffer.from(text.replace('"sequence":7', '"sequence":8'), 'utf8');
    expect(swapped.byteLength).toBe(indexLength);
    const forged = Buffer.concat([
      bytes.subarray(0, 128),
      swapped,
      bytes.subarray(128 + indexLength),
    ]);
    sha(swapped); // recompute header hash like a link-controlling attacker would
    Buffer.from(sha(swapped), 'hex').copy(forged, 32);
    await expectReaderError(open(forged, key.publicKey).reader, 'signature-invalid');
    // Without a key it is merely unverified: nothing authenticates it.
    expect((await open(forged).reader).verification).toBe('unverified');
  });

  it('opens with a tampered payload but refuses to stage it (payload is covered by file hashes)', async () => {
    const { bytes, indexLength } = await build();
    const forged = Buffer.from(bytes);
    forged[128 + indexLength] = (forged[128 + indexLength] ?? 0) ^ 0xff;
    const reader = await open(forged, key.publicKey).reader;
    const first = reader.index.files[0];
    if (!first) throw new Error('fixture');
    const dir = await temp();
    await expectReaderError(reader.stageFile(first.path, join(dir, 'x')), 'file-hash-mismatch');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects truncation at every boundary', async () => {
    const { bytes, indexLength } = await build();
    const lengths = [
      0,
      1,
      63,
      64,
      65,
      100,
      127,
      128,
      129,
      128 + indexLength - 1,
      128 + indexLength,
      128 + indexLength + 1,
      bytes.byteLength - 1,
    ];
    for (const length of lengths) {
      await expect(
        open(bytes.subarray(0, length), key.publicKey).reader,
        `len ${length}`,
      ).rejects.toThrow();
      await expect(
        open(bytes.subarray(0, length)).reader,
        `len ${length} keyless`,
      ).rejects.toThrow();
    }
    // A trailing byte is also invalid (totalLength mismatch).
    await expectReaderError(
      open(Buffer.concat([bytes, Buffer.from([0])]), key.publicKey).reader,
      'invalid-header',
    );
  });
});

describe('writer signing inputs', () => {
  const base = async () => {
    const root = await temp();
    return {
      sourceRoot: root,
      outputPath: join(root, 'o.torchpack'),
      serverId,
      deploymentId,
      game,
      files: [],
    };
  };

  it.each([
    ['sequence without sign', { sequence: 1 }],
    ['sign without sequence', { sign: () => Buffer.alloc(64) }],
    ['sequence 0', { sequence: 0, sign: () => Buffer.alloc(64) }],
    ['negative', { sequence: -1, sign: () => Buffer.alloc(64) }],
    ['fraction', { sequence: 1.5, sign: () => Buffer.alloc(64) }],
    ['unsafe', { sequence: 2 ** 53, sign: () => Buffer.alloc(64) }],
    ['NaN', { sequence: Number.NaN, sign: () => Buffer.alloc(64) }],
  ])('rejects %s', async (_name, extra) => {
    const options = { ...(await base()), ...extra };
    await expect(writeDeployment(options)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it.each([0, 63, 65, 128])('rejects a %i-byte signature and leaves no output', async (length) => {
    const options = {
      ...(await base()),
      sequence: 1,
      sign: () => Buffer.alloc(length),
    };
    await expect(writeDeployment(options)).rejects.toBeInstanceOf(DeploymentWriteError);
    await expect(writeDeployment(options)).rejects.toMatchObject({ code: 'invalid-signature' });
    expect(await readdir(options.sourceRoot)).toEqual([]);
  });

  it('propagates signer failure without output', async () => {
    const options = {
      ...(await base()),
      sequence: 1,
      sign: async () => {
        throw new Error('hsm offline');
      },
    };
    await expect(writeDeployment(options)).rejects.toThrow('hsm offline');
    expect(await readdir(options.sourceRoot)).toEqual([]);
  });

  it('accepts the maximum safe sequence', async () => {
    const options = {
      ...(await base()),
      sequence: Number.MAX_SAFE_INTEGER,
      sign: createEd25519Signer(key.privateKey),
    };
    const result = await writeDeployment(options);
    const reader = await open(await readFile(result.outputPath), key.publicKey).reader;
    expect(reader.index.sequence).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('contract rules for sequence and version 1.2', () => {
  const context = { expectedServerId: '11111111-1111-4111-8111-111111111111' };
  function v12(sequence: unknown, extra: Record<string, unknown> = {}) {
    const { index, header } = createValidDeployment();
    const signedHeader: DeploymentHeader = {
      ...header,
      formatVersion: { major: 1, minor: 2 },
      totalLength: header.totalLength + 64,
    };
    const body: Record<string, unknown> = {
      ...index,
      formatVersion: { major: 1, minor: 2 },
      branding: {},
      ...extra,
    };
    if (sequence !== undefined) body.sequence = sequence;
    return { signedHeader, body };
  }

  it('accepts a valid 1.2 index', () => {
    const { signedHeader, body } = v12(1);
    expect(validateDeploymentHeader(signedHeader).formatVersion.minor).toBe(2);
    expect(validateDeploymentIndex(body, signedHeader, context).sequence).toBe(1);
  });

  it.each([undefined, 0, -1, 1.5, 2 ** 53, '1', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects sequence %s in 1.2',
    (sequence) => {
      const { signedHeader, body } = v12(sequence);
      expect(() => validateDeploymentIndex(body, signedHeader, context)).toThrow();
    },
  );

  it('rejects sequence in 1.0 and 1.1', () => {
    const { index, header } = createValidDeployment();
    expect(() => validateDeploymentIndex({ ...index, sequence: 1 }, header, context)).toThrow();
    const v11Header = { ...header, formatVersion: { major: 1, minor: 1 } as const };
    expect(() =>
      validateDeploymentIndex(
        { ...index, formatVersion: { major: 1, minor: 1 }, branding: {}, sequence: 1 },
        v11Header,
        context,
      ),
    ).toThrow();
  });

  it('requires index minor to match header minor and rejects minor 3', () => {
    const { signedHeader, body } = v12(1);
    expect(() =>
      validateDeploymentIndex(
        { ...body, formatVersion: { major: 1, minor: 1 } },
        signedHeader,
        context,
      ),
    ).toThrow();
    expect(() =>
      validateDeploymentHeader({ ...signedHeader, formatVersion: { major: 1, minor: 3 } }),
    ).toThrow();
  });

  it('requires totalLength to cover the signature block', () => {
    const { signedHeader } = v12(1);
    expect(() =>
      validateDeploymentHeader({
        ...signedHeader,
        totalLength: 64 + 64 + signedHeader.indexLength - 1,
      }),
    ).toThrow();
  });
});

describe('rollback decision', () => {
  const sha1 = 'a'.repeat(64);
  const sha2 = 'b'.repeat(64);
  const id1 = '22222222-2222-4222-8222-222222222222';
  const id2 = '44444444-4444-4444-8444-444444444444';
  const s = (
    sequence: number,
    deploymentId = id1,
    indexSha256 = sha1,
  ): DeploymentRollbackState => ({
    sequence,
    deploymentId,
    indexSha256,
  });

  it('accepts when nothing has been seen', () => {
    expect(decideRollback(null, s(1))).toBe('accept');
  });
  it('rejects lower sequences even with identical ids', () => {
    expect(decideRollback(s(5), s(4))).toBe('reject-lower');
    expect(decideRollback(s(5), s(1, id2, sha2))).toBe('reject-lower');
  });
  it('accepts higher sequences regardless of ids', () => {
    expect(decideRollback(s(5), s(6, id2, sha2))).toBe('accept');
    expect(decideRollback(s(5), s(Number.MAX_SAFE_INTEGER))).toBe('accept');
  });
  it('accepts an equal sequence only for the identical deployment', () => {
    expect(decideRollback(s(5), s(5))).toBe('accept');
    expect(decideRollback(s(5), s(5, id2))).toBe('reject-conflict');
    expect(decideRollback(s(5), s(5, id1, sha2))).toBe('reject-conflict');
    expect(decideRollback(s(5), s(5, id2, sha2))).toBe('reject-conflict');
  });
  it('rejects malformed states instead of guessing', () => {
    expect(() => decideRollback(null, s(0))).toThrow(TypeError);
    expect(() => decideRollback(null, s(1.5))).toThrow(TypeError);
    expect(() => decideRollback(null, s(1, id1, 'XYZ'))).toThrow(TypeError);
    expect(() => decideRollback(s(-1), s(1))).toThrow(TypeError);
  });
});
