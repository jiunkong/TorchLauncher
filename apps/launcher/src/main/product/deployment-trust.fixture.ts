import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEd25519Signer,
  deriveEd25519PublicKey,
} from '../../../../../packages/core/src/deployment/signing/index';
import { writeDeployment } from '../../../../../packages/core/src/deployment/writer/index';
import type {
  ByteRange,
  ResourceSnapshot,
} from '../../../../../packages/core/src/download/http/index';
import type {
  DownloadSource,
  SourceRangeResponse,
} from '../../../../../packages/core/src/download/source/index';
import { serverId } from '../../../../../packages/core/src/instance/mods/fixtures';

export { serverId };
export const deploymentA = '22222222-2222-4222-8222-222222222222';
export const deploymentB = '33333333-3333-4333-8333-333333333333';

export class MemorySource implements DownloadSource {
  readonly kind = 'https' as const;
  readonly sourceId = 'memory://trust';
  readonly generation = 0;
  readonly snapshot: ResourceSnapshot;
  reset(): void {}
  constructor(private readonly bytes: Uint8Array) {
    this.snapshot = { totalLength: bytes.byteLength, etag: '"stable"', lastModified: null };
  }
  async getRange(range: ByteRange): Promise<SourceRangeResponse> {
    return {
      sourceId: this.sourceId,
      sourceGeneration: this.generation,
      range: { ...range },
      bytes: this.bytes.slice(range.start, range.end + 1),
      snapshot: { ...this.snapshot },
    };
  }
}
export interface TestKey {
  privateKey: KeyObject;
  publicKey: string;
}
export function newKey(): TestKey {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey: deriveEd25519PublicKey(privateKey) };
}
/** Current signed fixture; minor overrides construct rejected historical headers. */
export async function buildDeployment(
  options: {
    signer?: KeyObject;
    sequence?: number;
    deploymentId?: string;
    payload?: string;
    minor?: number;
  } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'launcher-trust-build-'));
  try {
    await writeFile(join(dir, 'a.dat'), options.payload ?? 'payload');
    const result = await writeDeployment({
      sourceRoot: dir,
      outputPath: join(dir, 'out.torchpack'),
      serverId,
      deploymentId: options.deploymentId ?? deploymentA,
      game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
      files: [{ sourcePath: 'a.dat', policy: 'always', compression: 'none' }],
      sign: createEd25519Signer(options.signer ?? newKey().privateKey),
      sequence: options.sequence ?? 1,
    });
    const bytes = await readFile(result.outputPath);
    if (options.minor !== undefined) bytes.writeUInt16LE(options.minor, 10);
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
