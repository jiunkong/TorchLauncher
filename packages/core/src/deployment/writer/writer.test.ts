import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInflateRaw, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import type { DeploymentIndex } from '../contracts/index.js';
import { DEPLOYMENT_LIMITS } from '../contracts/index.js';
import {
  DEPLOYMENT_WRITE_CHUNK_LENGTH,
  type DeploymentInputFile,
  DeploymentWriteError,
  type WriteDeploymentOptions,
  writeDeployment,
} from './index.js';

const roots: string[] = [];
const symlinkPermissionCodes = new Set(['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS']);

async function createSymlinkOrSkip(
  context: TestContext,
  target: string,
  path: string,
  type?: 'dir' | 'file' | 'junction',
): Promise<void> {
  try {
    await symlink(target, path, type);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      symlinkPermissionCodes.has(String(error.code))
    ) {
      context.skip(`Symlink creation is unavailable on this host: ${String(error.code)}`);
    }
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const plainInput: DeploymentInputFile = {
  sourcePath: 'config/options.txt',
  compression: 'none',
  policy: 'initial-only',
};

async function setup() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-writer-test-'));
  roots.push(root);
  const sourceRoot = join(root, 'source');
  await mkdir(join(sourceRoot, 'config'), { recursive: true });
  await mkdir(join(sourceRoot, 'mods'));
  const settings = Buffer.from('키설정=사용자 기본값\n');
  await writeFile(join(sourceRoot, plainInput.sourcePath), settings);
  const outputPath = join(root, 'server.torchpack');
  const options: WriteDeploymentOptions = {
    sourceRoot,
    outputPath,
    serverId: '11111111-1111-4111-8111-111111111111',
    deploymentId: '22222222-2222-4222-8222-222222222222',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'neoforge', version: '21.1.200' } },
    files: [plainInput],
  };
  return { root, sourceRoot, outputPath, options, settings };
}

/** Independent test-only decoder: no product writer encoders or contract validators. */
async function verifyContainer(path: string, expected: readonly Buffer[]) {
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('ascii')).toBe('TORCHDEP');
  expect(bytes.readUInt16LE(8)).toBe(1);
  expect(bytes.readUInt16LE(10)).toBe(0);
  expect(bytes.readUInt32LE(12)).toBe(0);
  const indexLength = Number(bytes.readBigUInt64LE(16));
  expect(bytes.readBigUInt64LE(24)).toBe(BigInt(bytes.length));
  const indexBytes = bytes.subarray(64, 64 + indexLength);
  expect(createHash('sha256').update(indexBytes).digest()).toEqual(bytes.subarray(32, 64));
  const index = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(indexBytes),
  ) as DeploymentIndex;
  expect(index.formatVersion).toEqual({ major: 1, minor: 0 });
  expect(index.files.length).toBe(expected.length);
  let cursor = 64 + indexLength;
  for (const [i, entry] of index.files.entries()) {
    expect(entry.offset).toBe(cursor - 64 - indexLength);
    const stored = bytes.subarray(cursor, cursor + entry.storedLength);
    expect(stored.length).toBe(entry.storedLength);
    const original = entry.compression === 'gzip' ? gunzipSync(stored) : stored;
    if (entry.compression === 'gzip') {
      // gzip produced here has a fixed 10-byte header (no optional fields). Check that exactly
      // one deflate stream plus the 8-byte CRC/size trailer consumes the entire file span.
      expect(stored.subarray(0, 4)).toEqual(Buffer.from([0x1f, 0x8b, 8, 0]));
      const inflater = createInflateRaw();
      inflater.end(stored.subarray(10));
      for await (const _chunk of inflater) {
        /* Drain the one raw stream. */
      }
      expect(inflater.bytesWritten + 18).toBe(stored.length);
    }
    const expectedBytes = expected[i];
    expect(expectedBytes !== undefined && original.equals(expectedBytes)).toBe(true);
    expect(original.length).toBe(entry.originalLength);
    expect(createHash('sha256').update(original).digest('hex')).toBe(entry.sha256);
    cursor += entry.storedLength;
  }
  expect(cursor).toBe(bytes.length);
  return index;
}

async function expectNoStage(root: string) {
  expect((await readdir(root)).filter((name) => name.startsWith('.torchpack-'))).toEqual([]);
}

describe('deployment writer bytes', () => {
  it.each(['neoforge', 'fabric'] as const)(
    'writes independently verifiable %s plain/gzip/empty spans',
    async (kind) => {
      const { root, sourceRoot, options, settings } = await setup();
      const mod = Buffer.from('independent gzip example payload '.repeat(50));
      await writeFile(join(sourceRoot, 'mods/server.jar'), mod);
      await writeFile(join(sourceRoot, 'config/empty.txt'), '');
      const result = await writeDeployment({
        ...options,
        game: {
          ...options.game,
          loader: { kind, version: kind === 'fabric' ? '0.16.14' : '21.1.200' },
        },
        files: [
          plainInput,
          { sourcePath: 'mods/server.jar', policy: 'always', compression: 'gzip' },
          { sourcePath: 'config/empty.txt', policy: 'initial-only', compression: 'gzip' },
        ],
      });
      const index = await verifyContainer(result.outputPath, [settings, mod, Buffer.alloc(0)]);
      expect(result.index).toEqual(index);
      expect(index.game.loader.kind).toBe(kind);
      expect(index.files.map((entry) => entry.compression)).toEqual(['none', 'gzip', 'none']);
      expect(index.files.map((entry) => entry.policy)).toEqual([
        'initial-only',
        'always',
        'initial-only',
      ]);
      expect(result.header.totalLength).toBe((await readFile(result.outputPath)).length);
      await expectNoStage(root);
    },
  );

  it('supports an empty file list without a payload or source reads', async () => {
    const { options } = await setup();
    const result = await writeDeployment({ ...options, files: [] });
    await verifyContainer(result.outputPath, []);
    expect(result.header.totalLength).toBe(64 + result.header.indexLength);
  });

  it('normalizes NFD disk names to NFC and preserves Unicode target spelling', async () => {
    const { sourceRoot, options, settings } = await setup();
    const sourcePath = 'config/한글-é.txt'.normalize('NFD');
    await writeFile(join(sourceRoot, sourcePath), settings);
    const result = await writeDeployment({ ...options, files: [{ ...plainInput, sourcePath }] });
    const index = await verifyContainer(result.outputPath, [settings]);
    expect(index.files[0]?.path).toBe('config/한글-é.txt');
    const remapped = await writeDeployment({
      ...options,
      files: [{ ...plainInput, path: 'resourcepacks/서버 설정.txt' }],
    });
    expect((await verifyContainer(remapped.outputPath, [settings])).files[0]?.path).toBe(
      'resourcepacks/서버 설정.txt',
    );
  });

  it('replaces an existing output only after success and is repeatable for fixed metadata', async () => {
    const { options, outputPath, settings } = await setup();
    await writeFile(outputPath, 'previous good deployment');
    await writeDeployment(options);
    const first = await readFile(outputPath);
    await writeDeployment(options);
    expect(await readFile(outputPath)).toEqual(first);
    await verifyContainer(outputPath, [settings]);
  });

  it('snapshots caller metadata before async progress callbacks can mutate it', async () => {
    const { options } = await setup();
    const game = {
      minecraftVersion: '1.21.1',
      loader: { kind: 'fabric' as const, version: '0.16.14' },
    };
    const files = [{ ...plainInput }];
    const result = await writeDeployment({
      ...options,
      game,
      files,
      onProgress: () => {
        game.minecraftVersion = 'changed';
        const input = files[0];
        if (input) {
          input.policy = 'always';
          input.sourcePath = 'missing';
        }
      },
    });
    expect(result.index.game.minecraftVersion).toBe('1.21.1');
    expect(result.index.files[0]?.policy).toBe('initial-only');
  });
});

describe('deployment writer path and size rejection', () => {
  it.each([
    ['config/é.txt', 'config/e\u0301.txt'],
    ['mods/A.jar', 'MODS/a.JAR'],
    ['config/straße.txt', 'config/STRASSE.txt'],
    ['config/설정', 'config/설정/기본값'],
  ])(
    'rejects normalized path/case/prefix collisions before touching files: %s and %s',
    async (first, second) => {
      const { options, root, outputPath } = await setup();
      await writeFile(outputPath, 'old');
      await expect(
        writeDeployment({
          ...options,
          files: [first, second].map((path) => ({ ...plainInput, path })),
        }),
      ).rejects.toMatchObject({ code: 'path-conflict' });
      expect(await readFile(outputPath, 'utf8')).toBe('old');
      await expectNoStage(root);
    },
  );

  it.each([
    '../outside.txt',
    '/absolute',
    'config/../outside',
    'config\\file',
    'C:/file',
    'config//file',
    'config/',
    'config/a\u0000',
  ])('rejects source escapes/ambiguous paths: %j', async (sourcePath) => {
    const { options, root } = await setup();
    await expect(
      writeDeployment({
        ...options,
        files: [{ ...plainInput, sourcePath, path: 'config/safe.txt' }],
      }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
    await expectNoStage(root);
  });

  it.each([
    '../escape',
    'config/CON.txt',
    'config/a:',
    'config/COM¹.txt',
    `config/${'가'.repeat(41)}`,
  ])('rejects invalid target paths: %j', async (path) => {
    const { options } = await setup();
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, path }] }),
    ).rejects.toMatchObject({ code: 'invalid-path' });
  });

  it('rejects a symlink file', async (context) => {
    const { sourceRoot, options } = await setup();
    await createSymlinkOrSkip(
      context,
      join(sourceRoot, plainInput.sourcePath),
      join(sourceRoot, 'mods/link.txt'),
    );
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'mods/link.txt' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects a symlink parent directory even when it points inside the source root', async (context) => {
    const { sourceRoot, options } = await setup();
    await createSymlinkOrSkip(
      context,
      join(sourceRoot, 'config'),
      join(sourceRoot, 'alias'),
      'dir',
    );
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'alias/options.txt' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects a symlink source root', async (context) => {
    const { sourceRoot, root, options } = await setup();
    const rootLink = join(root, 'root-link');
    await createSymlinkOrSkip(context, sourceRoot, rootLink, 'dir');
    await expect(writeDeployment({ ...options, sourceRoot: rootLink })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('rejects an external symlink target', async (context) => {
    const { sourceRoot, root, options } = await setup();
    const external = join(root, 'private.txt');
    await writeFile(external, 'must not export');
    await createSymlinkOrSkip(context, external, join(sourceRoot, 'external'));
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'external' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects a multiply-linked input', async () => {
    const { sourceRoot, root, options } = await setup();
    const external = join(root, 'private.txt');
    await writeFile(external, 'must not export');
    await link(external, join(sourceRoot, 'hardlink'));
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'hardlink' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects a directory input', async () => {
    const { options } = await setup();
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'config' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('rejects a symlink output', async (context) => {
    const { options, outputPath, sourceRoot } = await setup();
    const source = join(sourceRoot, plainInput.sourcePath);
    await createSymlinkOrSkip(context, source, outputPath);
    await expect(writeDeployment(options)).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('never exports over an input file', async () => {
    const { options, sourceRoot, settings } = await setup();
    const source = join(sourceRoot, plainInput.sourcePath);
    await expect(writeDeployment({ ...options, outputPath: source })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
    expect(await readFile(source)).toEqual(settings);
  });

  it('rejects malformed metadata before writing an output', async () => {
    const { options, root } = await setup();
    await expect(writeDeployment({ ...options, serverId: 'invalid' })).rejects.toMatchObject({
      code: 'invalid-id',
    });
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, compression: 'zip' as 'gzip' }] }),
    ).rejects.toBeInstanceOf(DeploymentWriteError);
    await expectNoStage(root);
  });

  it('rejects oversized source files from stat before streaming them', async () => {
    const { sourceRoot, options, root } = await setup();
    const file = await open(join(sourceRoot, 'mods/oversized.jar'), 'w');
    try {
      await file.truncate(DEPLOYMENT_LIMITS.fileLength + 1);
    } finally {
      await file.close();
    }
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, sourcePath: 'mods/oversized.jar' }] }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    await expectNoStage(root);
  });

  it('rejects file count and bounded JSON index size before reading missing inputs', async () => {
    const { options, root } = await setup();
    await expect(
      writeDeployment({
        ...options,
        files: Array(DEPLOYMENT_LIMITS.fileCount + 1).fill(plainInput),
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    const files = Array.from({ length: 45_000 }, (_, i) => ({
      ...plainInput,
      sourcePath: `missing/${i}`,
      path: `config/${'a'.repeat(110)}${i}/${'b'.repeat(100)}`,
    }));
    await expect(writeDeployment({ ...options, files })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    await expectNoStage(root);
  }, 15_000);
});

describe('deployment writer snapshots and rollback', () => {
  // Windows cannot rename over a source the writer holds open (EPERM before the writer can notice),
  // so the 'replace' case is only meaningful on POSIX; other cases still cover Windows.
  it.each(
    (['append', 'truncate', 'same-size', 'replace'] as const).filter(
      (change) => !(change === 'replace' && process.platform === 'win32'),
    ),
  )('rejects a source changed during reading: %s', async (change) => {
    const { sourceRoot, options, outputPath, root } = await setup();
    const source = join(sourceRoot, plainInput.sourcePath);
    await writeFile(outputPath, 'old complete deployment');
    let changed = false;
    await expect(
      writeDeployment({
        ...options,
        onProgress: async (event) => {
          if (event.phase !== 'reading' || changed) return;
          changed = true;
          if (change === 'append')
            await writeFile(source, 'longer than the originally opened source'.repeat(3));
          if (change === 'truncate') await truncate(source, 0);
          if (change === 'same-size')
            await writeFile(source, Buffer.alloc((await readFile(source)).length, 65));
          if (change === 'replace') {
            const replacement = join(sourceRoot, 'replacement');
            await writeFile(replacement, 'replacement data');
            await rename(replacement, source);
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'source-changed' });
    expect(await readFile(outputPath, 'utf8')).toBe('old complete deployment');
    await expectNoStage(root);
  });

  it('rechecks already staged inputs immediately before publication', async () => {
    const { sourceRoot, options, outputPath, root } = await setup();
    await writeFile(outputPath, 'old');
    await expect(
      writeDeployment({
        ...options,
        onProgress: async (event) => {
          if (event.phase === 'assembling')
            await writeFile(join(sourceRoot, plainInput.sourcePath), 'changed after staging');
        },
      }),
    ).rejects.toMatchObject({ code: 'source-changed' });
    expect(await readFile(outputPath, 'utf8')).toBe('old');
    await expectNoStage(root);
  });

  // Windows cannot rename a directory containing a file the writer holds open (EPERM), so this
  // scenario cannot occur there.
  it.skipIf(process.platform === 'win32')(
    'rejects directory replacement during generation',
    async () => {
      const { options, sourceRoot, root } = await setup();
      let changed = false;
      await expect(
        writeDeployment({
          ...options,
          onProgress: async () => {
            if (changed) return;
            changed = true;
            await rename(join(sourceRoot, 'config'), join(sourceRoot, 'old-config'));
            await mkdir(join(sourceRoot, 'config'));
            await writeFile(join(sourceRoot, plainInput.sourcePath), 'replacement');
          },
        }),
      ).rejects.toMatchObject({ code: 'source-changed' });
      await expectNoStage(root);
    },
  );

  it.each(['reading', 'assembling'] as const)(
    'cancellation during %s preserves the existing output and removes staging',
    async (phase) => {
      const { options, root, outputPath } = await setup();
      await writeFile(outputPath, 'old');
      const controller = new AbortController();
      await expect(
        writeDeployment({
          ...options,
          signal: controller.signal,
          onProgress: (event) => {
            if (event.phase === phase) controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(await readFile(outputPath, 'utf8')).toBe('old');
      await expectNoStage(root);
    },
  );

  it('rejects pre-cancelled work and callback failures without creating output artifacts', async () => {
    const { options, root, outputPath } = await setup();
    await writeFile(outputPath, 'old');
    await expect(
      writeDeployment({ ...options, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      writeDeployment({
        ...options,
        onProgress: () => {
          throw new Error('UI cancelled export');
        },
      }),
    ).rejects.toThrow('UI cancelled export');
    expect(await readFile(outputPath, 'utf8')).toBe('old');
    await expectNoStage(root);
  });

  it('preserves an output changed by another actor during staging', async () => {
    const { options, outputPath, root } = await setup();
    await writeFile(outputPath, 'old');
    await expect(
      writeDeployment({
        ...options,
        onProgress: async (event) => {
          if (event.phase === 'assembling') await writeFile(outputPath, 'new external output');
        },
      }),
    ).rejects.toMatchObject({ code: 'output-changed' });
    expect(await readFile(outputPath, 'utf8')).toBe('new external output');
    await expectNoStage(root);
  });

  it('removes staging and leaves no new output after a compression-ratio failure', async () => {
    const { options, sourceRoot, outputPath, root } = await setup();
    await writeFile(join(sourceRoot, plainInput.sourcePath), Buffer.alloc(8 * 1024 ** 2));
    await expect(
      writeDeployment({ ...options, files: [{ ...plainInput, compression: 'gzip' }] }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectNoStage(root);
  });

  it('streams multi-chunk input with bounded progress increments and no whole-file source buffer', async () => {
    const { options, sourceRoot, outputPath } = await setup();
    const size = 8 * 1024 ** 2 + 17;
    const source = await open(join(sourceRoot, plainInput.sourcePath), 'w');
    try {
      await source.truncate(size);
    } finally {
      await source.close();
    }
    let previous = 0;
    let chunks = 0;
    await writeDeployment({
      ...options,
      onProgress: (event) => {
        if (event.phase !== 'reading') return;
        expect(event.processedBytes - previous).toBeLessThanOrEqual(DEPLOYMENT_WRITE_CHUNK_LENGTH);
        expect(event.processedBytes).toBeGreaterThan(previous);
        previous = event.processedBytes;
        chunks++;
      },
    });
    expect(previous).toBe(size);
    expect(chunks).toBeGreaterThan(32);
    await verifyContainer(outputPath, [Buffer.alloc(size)]);
  });
});

describe('branding writer snapshots', () => {
  it('publishes v1.1 role bytes after game payload, frozen at invocation before the first await', async () => {
    const { tinyPng } = await import('../../branding/fixtures/images.js');
    const { options, settings, outputPath } = await setup();
    const original = tinyPng();
    const bytes = Uint8Array.from(original);
    const request = {
      ...options,
      branding: { icon: { bytes, mediaType: 'image/png' as const }, background: null },
    };
    const writing = writeDeployment(request);
    bytes.fill(0);
    request.branding.icon.mediaType = 'image/jpeg' as 'image/png';
    const result = await writing;
    const container = await readFile(outputPath);
    const payloadStart = 64 + result.header.indexLength;
    const asset = result.index.branding?.icon;
    expect(asset).toBeTruthy();
    if (!asset) throw new Error('Missing icon');
    expect(container.readUInt16LE(10)).toBe(1);
    expect(result.index.formatVersion).toEqual({ major: 1, minor: 1 });
    expect(result.index.branding?.background).toBeNull();
    expect(asset).toMatchObject({
      offset: settings.length,
      compression: 'none',
      originalLength: original.length,
      mediaType: 'image/png',
      sha256: createHash('sha256').update(original).digest('hex'),
    });
    expect(container.subarray(payloadStart, payloadStart + settings.length)).toEqual(settings);
    expect(container.subarray(payloadStart + asset.offset)).toEqual(original);
    expect(result.index.files.map((entry) => entry.path)).toEqual(['config/options.txt']);
  });
  it('orders icon then background after files regardless of input property order and hashes raw index bytes', async () => {
    const { tinyPng } = await import('../../branding/fixtures/images.js');
    const { options, outputPath, settings } = await setup();
    const image = tinyPng();
    const result = await writeDeployment({
      ...options,
      branding: {
        background: { bytes: image, mediaType: 'image/png' },
        icon: { bytes: image, mediaType: 'image/png' },
      },
    });
    const container = await readFile(outputPath);
    const indexBytes = container.subarray(64, 64 + result.header.indexLength);
    expect(createHash('sha256').update(indexBytes).digest()).toEqual(container.subarray(32, 64));
    expect(JSON.parse(indexBytes.toString('utf8'))).toEqual(result.index);
    expect(result.index.branding?.icon?.offset).toBe(settings.length);
    expect(result.index.branding?.background?.offset).toBe(settings.length + image.length);
    expect(container.subarray(64 + result.header.indexLength)).toEqual(
      Buffer.concat([settings, image, image]),
    );
  });
  it('emits v1.0 when absent and v1.1 for empty/update-removal metadata without payload', async () => {
    const { options } = await setup();
    expect((await writeDeployment(options)).header.formatVersion.minor).toBe(0);
    for (const branding of [{}, { icon: null, background: null }]) {
      const result = await writeDeployment({ ...options, files: [], branding });
      expect(result.header.formatVersion.minor).toBe(1);
      expect(result.header.totalLength).toBe(64 + result.header.indexLength);
      expect(result.index.branding).toEqual(branding);
    }
  });
  it('rejects oversized/malformed/unsupported images without replacing previous output', async () => {
    const { tinyPng } = await import('../../branding/fixtures/images.js');
    const { options, outputPath, root } = await setup();
    await writeFile(outputPath, 'previous pack');
    const wide = tinyPng();
    wide.writeUInt32BE(513, 16);
    const invalidInputs: unknown[] = [
      { icon: { bytes: tinyPng(), mediaType: 'image/jpeg' } },
      { icon: { bytes: wide, mediaType: 'image/png' } },
      { icon: { bytes: new Uint8Array(1_048_577), mediaType: 'image/png' } },
      { icon: { bytes: tinyPng(), mediaType: 'image/svg+xml' } },
      { icon: { bytes: [1, 2], mediaType: 'image/png' } },
      { icon: undefined },
      { arbitrary: null },
      null,
    ];
    for (const branding of invalidInputs) {
      await expect(
        writeDeployment({
          ...options,
          branding: branding as NonNullable<WriteDeploymentOptions['branding']>,
        }),
      ).rejects.toBeInstanceOf(DeploymentWriteError);
      expect(await readFile(outputPath, 'utf8')).toBe('previous pack');
    }
    await expectNoStage(root);
  });
});
