import { crc32, deflateRawSync } from 'node:zlib';
import { testSigning } from '../../deployment/fixtures/signing.js';

export interface ZipItem {
  readonly name: string;
  readonly data: string | Buffer;
  readonly stored?: boolean;
}

/** Builds a small ZIP in memory for tests. */
export function zip(items: readonly ZipItem[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const raw = Buffer.from(item.data);
    const body = item.stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(item.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(item.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(item.stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, directory, end, Buffer.from(comment)]);
}

export const fabricJar = (id: string, extra: Record<string, unknown> = {}, salt = ''): Buffer =>
  zip([
    {
      name: 'fabric.mod.json',
      data: JSON.stringify({ schemaVersion: 1, id, version: '1', ...extra }),
    },
    { name: 'salt.txt', data: salt },
  ]);

export const neoForgeJar = (id: string, salt = ''): Buffer =>
  zip([
    {
      name: 'META-INF/neoforge.mods.toml',
      data: `modLoader="javafml"\n[[mods]]\nmodId="${id}"\n[[dependencies.${id}]]\nmodId="neoforge"\n`,
    },
    { name: 'salt.txt', data: salt },
  ]);

// ---- real deployment helpers (writer -> range source -> reader -> synchronizeDeployment) ----
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeploymentFilePolicy } from '../../deployment/contracts/index.js';
import { openDeploymentReader } from '../../deployment/reader/index.js';
import { writeDeployment } from '../../deployment/writer/index.js';
import { createDownloadSource } from '../../download/source/index.js';
import { synchronizeDeployment } from '../sync/index.js';

export const serverId = '11111111-1111-4111-8111-111111111111';
const temporaryRoots: string[] = [];

export async function temporary(prefix = 'torch-mods-'): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix));
  temporaryRoots.push(root);
  return root;
}

export async function cleanTemporary(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export interface DeployInput {
  readonly path: string;
  readonly data: string | Buffer;
  readonly policy?: DeploymentFilePolicy;
}

export async function deploy(root: string, files: readonly DeployInput[], deploymentId: string) {
  const sourceRoot = await temporary('torch-mods-src-');
  for (const file of files) {
    await mkdir(dirname(join(sourceRoot, file.path)), { recursive: true });
    await writeFile(join(sourceRoot, file.path), file.data);
  }
  const result = await writeDeployment({
    ...testSigning,
    sourceRoot,
    outputPath: join(sourceRoot, 'output.torchpack'),
    serverId,
    deploymentId,
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
    files: files.map((file) => ({
      sourcePath: file.path,
      policy: file.policy ?? 'always',
      compression: 'none' as const,
    })),
  });
  const bytes = await readFile(result.outputPath);
  const fetcher: typeof fetch = async (_input, init) => {
    const range = /^bytes=([0-9]+)-([0-9]+)$/u.exec(new Headers(init?.headers).get('Range') ?? '');
    if (!range) throw new Error('Expected bounded range');
    const start = Number(range[1]);
    const end = Number(range[2]);
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Content-Length': String(end - start + 1),
        ETag: '"fixture-version"',
      },
    });
  };
  const source = createDownloadSource('https://example.test/deployment.torchpack', {
    fetch: fetcher,
  });
  const reader = await openDeploymentReader(source, { expectedServerId: serverId });
  return synchronizeDeployment({ root, expectedServerId: serverId, reader });
}
