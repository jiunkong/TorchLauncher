import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createValidDeployment, OTHER_SERVER_ID, SERVER_ID } from './fixtures/valid.js';
import {
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_LIMITS,
  type DeploymentFile,
  DeploymentValidationError,
  type DeploymentValidationErrorCode,
  EMPTY_FILE_SHA256,
  getDeploymentFileRange,
  validateDeploymentHeader,
  validateDeploymentIndex,
} from './index.js';

const context = { expectedServerId: SERVER_ID };

function expectInvalid(run: () => unknown, code: DeploymentValidationErrorCode) {
  expect(run).toThrow(DeploymentValidationError);
  expect(run).toThrow(expect.objectContaining({ code, field: expect.any(String) }));
}

function withFiles(files: readonly DeploymentFile[]) {
  const fixture = createValidDeployment();
  const payloadLength = files.reduce((sum, entry) => sum + entry.storedLength, 0);
  return {
    index: { ...fixture.index, files },
    header: {
      ...fixture.header,
      totalLength: DEPLOYMENT_HEADER_LENGTH + fixture.header.indexLength + payloadLength,
    },
  };
}

const emptyFile: DeploymentFile = {
  path: 'config/empty.txt',
  sha256: EMPTY_FILE_SHA256,
  offset: 0,
  storedLength: 0,
  originalLength: 0,
  compression: 'none',
  policy: 'initial-only',
};

describe('deployment v1 contracts', () => {
  it.each(['fabric', 'neoforge'] as const)('accepts the Minecraft 1.21.1 %s fixture', (kind) => {
    const { header, index, indexBytes, payloadBytes, originalBytes } = createValidDeployment(kind);
    expect(validateDeploymentHeader(header)).toBe(header);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    expect(createHash('sha256').update(indexBytes).digest('hex')).toBe(header.indexSha256);
    for (const [position, entry] of index.files.entries()) {
      const range = getDeploymentFileRange(header, entry);
      if (entry.storedLength === 0) {
        expect(range).toBeNull();
        continue;
      }
      expect(range).toEqual({
        start: DEPLOYMENT_HEADER_LENGTH + indexBytes.length + entry.offset,
        endInclusive:
          DEPLOYMENT_HEADER_LENGTH + indexBytes.length + entry.offset + entry.storedLength - 1,
      });
      const stored = payloadBytes.subarray(entry.offset, entry.offset + entry.storedLength);
      const original = entry.compression === 'gzip' ? gunzipSync(stored) : stored;
      expect(original).toEqual(originalBytes[position]);
      expect(original.length).toBe(entry.originalLength);
      expect(createHash('sha256').update(original).digest('hex')).toBe(entry.sha256);
    }
  });

  it('allows an empty deployment with exactly zero payload bytes', () => {
    const { index, header } = withFiles([]);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    expectInvalid(
      () =>
        validateDeploymentIndex(index, { ...header, totalLength: header.totalLength + 1 }, context),
      'invalid-layout',
    );
  });

  it('allows zero-length files at the same payload offset and creates no range', () => {
    const { index, header } = withFiles([emptyFile, { ...emptyFile, path: 'options.txt' }]);
    validateDeploymentIndex(index, header, context);
    expect(getDeploymentFileRange(header, emptyFile)).toBeNull();
  });

  it.each([null, [], 'index', 1, true, new Date()])('rejects a non-object index: %j', (value) => {
    expectInvalid(
      () => validateDeploymentIndex(value, createValidDeployment().header, context),
      'invalid-shape',
    );
  });

  it('rejects missing, additional, and inherited object fields', () => {
    const { index, header } = createValidDeployment();
    const { deploymentId: _removed, ...missing } = index;
    for (const candidate of [
      missing,
      { ...index, signature: 'unsupported' },
      Object.create(index),
    ]) {
      expectInvalid(() => validateDeploymentIndex(candidate, header, context), 'invalid-shape');
    }
    expectInvalid(
      () =>
        validateDeploymentIndex({ ...index, game: { ...index.game, java: 21 } }, header, context),
      'invalid-shape',
    );
    expectInvalid(
      () =>
        validateDeploymentIndex(
          { ...index, game: { ...index.game, loader: { ...index.game.loader, flags: [] } } },
          header,
          context,
        ),
      'invalid-shape',
    );
  });

  it.each([
    { major: 2, minor: 0 },
    { major: 1, minor: 3 },
    { major: '1', minor: 0 },
  ])('rejects unsupported header and index versions: %j', (formatVersion) => {
    const { index, header } = createValidDeployment();
    expectInvalid(
      () => validateDeploymentHeader({ ...header, formatVersion }),
      'unsupported-version',
    );
    expectInvalid(
      () => validateDeploymentIndex({ ...index, formatVersion }, header, context),
      'unsupported-version',
    );
  });

  it.each([
    '',
    'not-a-uuid',
    SERVER_ID.toUpperCase().replace('11111111', 'AAAAAAAA'),
    '11111111-1111-1111-8111-111111111111',
    `${SERVER_ID}\n`,
  ])('rejects invalid IDs: %j', (value) => {
    const { index, header } = createValidDeployment();
    expectInvalid(
      () => validateDeploymentIndex({ ...index, serverId: value }, header, context),
      'invalid-id',
    );
    expectInvalid(
      () => validateDeploymentIndex({ ...index, deploymentId: value }, header, context),
      'invalid-id',
    );
    expectInvalid(
      () => validateDeploymentIndex(index, header, { expectedServerId: value }),
      'invalid-id',
    );
  });

  it('requires the trusted launcher server ID to match', () => {
    const { index, header } = createValidDeployment();
    expectInvalid(
      () => validateDeploymentIndex(index, header, { expectedServerId: OTHER_SERVER_ID }),
      'server-mismatch',
    );
  });

  it.each(['', '../1.21.1', '1.21.1\n', 'v'.repeat(65), 21, null])(
    'rejects malformed version tokens: %j',
    (value) => {
      const { index, header } = createValidDeployment();
      expectInvalid(
        () =>
          validateDeploymentIndex(
            { ...index, game: { ...index.game, minecraftVersion: value } },
            header,
            context,
          ),
        'invalid-value',
      );
      expectInvalid(
        () =>
          validateDeploymentIndex(
            { ...index, game: { ...index.game, loader: { kind: 'fabric', version: value } } },
            header,
            context,
          ),
        'invalid-value',
      );
    },
  );

  it('rejects unsupported loaders', () => {
    const { index, header } = createValidDeployment();
    expectInvalid(
      () =>
        validateDeploymentIndex(
          { ...index, game: { ...index.game, loader: { kind: 'forge', version: '1' } } },
          header,
          context,
        ),
      'invalid-value',
    );
  });
});

describe('header boundaries', () => {
  it.each([0, -1, 0.5, NaN, Infinity, '1024', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid index lengths: %j',
    (indexLength) => {
      expectInvalid(
        () => validateDeploymentHeader({ ...createValidDeployment().header, indexLength }),
        'invalid-number',
      );
    },
  );

  it.each([-1, 1.5, NaN, Infinity, '1024', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid total lengths: %j',
    (totalLength) => {
      expectInvalid(
        () => validateDeploymentHeader({ ...createValidDeployment().header, totalLength }),
        'invalid-number',
      );
    },
  );

  it('rejects excess sizes and a truncated header/index region', () => {
    const { header } = createValidDeployment();
    expectInvalid(
      () => validateDeploymentHeader({ ...header, indexLength: DEPLOYMENT_LIMITS.indexLength + 1 }),
      'limit-exceeded',
    );
    expectInvalid(
      () =>
        validateDeploymentHeader({ ...header, totalLength: DEPLOYMENT_LIMITS.containerLength + 1 }),
      'limit-exceeded',
    );
    expectInvalid(
      () =>
        validateDeploymentHeader({
          ...header,
          totalLength: DEPLOYMENT_HEADER_LENGTH + header.indexLength - 1,
        }),
      'invalid-layout',
    );
    expect(
      validateDeploymentHeader({
        ...header,
        indexLength: DEPLOYMENT_LIMITS.indexLength,
        totalLength: DEPLOYMENT_LIMITS.containerLength,
      }),
    ).toBeDefined();
  });

  it('rejects wrong magic, future flags, and extra fields', () => {
    const { header } = createValidDeployment();
    expectInvalid(
      () => validateDeploymentHeader({ ...header, magic: 'TORCHZIP' }),
      'invalid-value',
    );
    expectInvalid(() => validateDeploymentHeader({ ...header, flags: 1 }), 'unsupported-version');
    expectInvalid(() => validateDeploymentHeader({ ...header, padding: 0 }), 'invalid-shape');
  });

  it.each(['a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), `${'a'.repeat(63)}\n`, null])(
    'rejects malformed SHA-256: %j',
    (sha256) => {
      const { header, index } = createValidDeployment();
      expectInvalid(
        () => validateDeploymentHeader({ ...header, indexSha256: sha256 }),
        'invalid-hash',
      );
      expectInvalid(
        () =>
          validateDeploymentIndex({ ...index, files: [{ ...emptyFile, sha256 }] }, header, context),
        'invalid-hash',
      );
    },
  );
});

describe('portable path validation', () => {
  it.each([
    '',
    '.',
    '..',
    '../outside',
    'config/../outside',
    '/absolute',
    'C:/absolute',
    'C:relative',
    '\\\\server\\share',
    'config\\file',
    'config//file',
    'config/',
    'config/./file',
    'config/file:stream',
    'config/%2e%2e',
    'config/a\u0000b',
    'config/a\nb',
    'config/ 한글.txt',
    'config/ file',
    'config/file ',
    'config/file.',
    'config/CON',
    'config/nul.txt',
    'config/NUL .txt',
    'AUX/a',
    'mods/COM1.jar',
    'mods/LPT9.jar',
    'config/COM0.txt',
    'config/LPT0.txt',
    'config/CONIN$',
    'config/CONOUT$.txt',
    'config/COM¹.txt',
    'config/LPT².txt',
    'config/COM³.txt',
    'config/a\u0085b',
    'config/a\u202eb',
    'config/a\u200db',
    'config/a\u00a0b',
    'config/a\ud800b',
    'config/file?.txt',
    'config/file*.txt',
    'config/file|name',
    'config/file<name',
    'config/file>name',
    'config/file"name',
    '.torchlauncher/state.json',
    '.TorchLauncher-cache/file',
    'a'.repeat(121),
    `${'a'.repeat(120)}/${'b'.repeat(120)}`,
    '가'.repeat(41),
    `${'가'.repeat(40)}/${'나'.repeat(40)}`,
  ])('rejects an unsafe path: %j', (path) => {
    const { index, header } = withFiles([{ ...emptyFile, path }]);
    expectInvalid(() => validateDeploymentIndex(index, header, context), 'invalid-path');
  });

  it('accepts portable nested names and exact path/component length limits', () => {
    const paths = [
      'mods/Example Mod [1.21.1]+(client).jar',
      `${'a'.repeat(120)}/${'b'.repeat(119)}`,
      '가'.repeat(40),
      `${'가'.repeat(40)}/${'나'.repeat(39)}ab`,
    ];
    for (const path of paths) {
      const { index, header } = withFiles([{ ...emptyFile, path }]);
      expect(validateDeploymentIndex(index, header, context)).toBe(index);
    }
  });

  it.each([
    'resourcepacks/서버 리소스팩.zip',
    'config/서버/기본 설정.toml',
    'config/é.txt',
    'config/ǰ.txt',
    'resourcepacks/🔥 팩.zip',
  ])('accepts portable NFC Unicode names without rewriting: %s', (path) => {
    const { index, header } = withFiles([{ ...emptyFile, path }]);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    expect(index.files[0]?.path).toBe(path);
  });

  it.each(['config/é.txt', 'config/한글.txt', 'config/각/설정.toml'])(
    'rejects non-NFC names and normalization aliases instead of rewriting: %s',
    (path) => {
      const decomposed = path.normalize('NFD');
      expect(decomposed).not.toBe(path);
      const single = withFiles([{ ...emptyFile, path: decomposed }]);
      expectInvalid(
        () => validateDeploymentIndex(single.index, single.header, context),
        'invalid-path',
      );
      for (const paths of [
        [path, decomposed],
        [decomposed, path],
      ]) {
        const { index, header } = withFiles(paths.map((path) => ({ ...emptyFile, path })));
        expectInvalid(() => validateDeploymentIndex(index, header, context), 'invalid-path');
      }
    },
  );

  it('rejects a decomposed directory alias of a file prefix', () => {
    const { index, header } = withFiles([
      { ...emptyFile, path: 'config/각' },
      { ...emptyFile, path: 'config/각/설정.toml'.normalize('NFD') },
    ]);
    expectInvalid(() => validateDeploymentIndex(index, header, context), 'invalid-path');
  });

  it.each([
    ['mods/a.jar', 'mods/a.jar'],
    ['mods/A.jar', 'MODS/a.JAR'],
    ['config', 'config/a.toml'],
    ['config/a.toml', 'CONFIG'],
    ['config/É.txt', 'CONFIG/é.TXT'],
    ['config/straße.txt', 'config/STRASSE.txt'],
    ['config/σ.txt', 'config/ς.txt'],
    ['config/ﬀ.txt', 'config/FF.txt'],
    ['config/ǰ.txt', 'config/J\u030c.txt'.normalize('NFC')],
    ['config/한글É', 'CONFIG/한글é/설정.toml'],
    ['config/한글é/설정.toml', 'CONFIG/한글É'],
  ])('rejects duplicate or file/directory aliases: %j', (first, second) => {
    const { index, header } = withFiles([
      { ...emptyFile, path: first },
      { ...emptyFile, path: second },
    ]);
    expectInvalid(() => validateDeploymentIndex(index, header, context), 'path-conflict');
  });

  it('does not confuse a shared directory or a filename prefix with a conflict', () => {
    const { index, header } = withFiles(
      ['config/a', 'CONFIG/b', 'config-a', '설정/기본값', '설정/서버값', '설정-서버값'].map(
        (path) => ({ ...emptyFile, path }),
      ),
    );
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
  });
});

describe('file layout and resource budgets', () => {
  it.each([-1, 0.5, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid offsets and lengths: %j',
    (value) => {
      const { header, index } = createValidDeployment();
      for (const field of ['offset', 'storedLength', 'originalLength']) {
        expectInvalid(
          () =>
            validateDeploymentIndex(
              { ...index, files: [{ ...emptyFile, [field]: value }] },
              header,
              context,
            ),
          'invalid-number',
        );
      }
    },
  );

  it.each([-1, 1])('rejects a shifted second span (overlap or gap): %i', (shift) => {
    const { index, header } = createValidDeployment();
    const files = index.files.map((entry, i) =>
      i === 1 ? { ...entry, offset: entry.offset + shift } : entry,
    );
    expectInvalid(
      () => validateDeploymentIndex({ ...index, files }, header, context),
      'invalid-layout',
    );
  });

  it('rejects out-of-order spans and unused or missing payload bytes', () => {
    const { index, header } = createValidDeployment();
    expectInvalid(
      () =>
        validateDeploymentIndex({ ...index, files: [...index.files].reverse() }, header, context),
      'invalid-layout',
    );
    for (const delta of [-1, 1]) {
      expectInvalid(
        () =>
          validateDeploymentIndex(
            index,
            { ...header, totalLength: header.totalLength + delta },
            context,
          ),
        'invalid-layout',
      );
    }
    expectInvalid(
      () => getDeploymentFileRange(header, { ...emptyFile, offset: header.totalLength }),
      'invalid-layout',
    );
  });

  it('rejects uncompressed length mismatch and unsupported compression/policy', () => {
    const { index, header } = withFiles([emptyFile]);
    for (const change of [
      { storedLength: 1 },
      { compression: 'brotli' },
      { policy: 'overwrite' },
    ]) {
      expectInvalid(
        () =>
          validateDeploymentIndex(
            { ...index, files: [{ ...emptyFile, ...change }] },
            header,
            context,
          ),
        'compression' in change || 'policy' in change ? 'invalid-value' : 'invalid-layout',
      );
    }
  });

  it('rejects invalid empty-file hashes and zero-sized gzip entries', () => {
    const { index, header } = withFiles([emptyFile]);
    expectInvalid(
      () =>
        validateDeploymentIndex(
          { ...index, files: [{ ...emptyFile, sha256: 'a'.repeat(64) }] },
          header,
          context,
        ),
      'invalid-hash',
    );
    for (const [storedLength, originalLength] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ]) {
      expectInvalid(
        () =>
          validateDeploymentIndex(
            {
              ...index,
              files: [{ ...emptyFile, compression: 'gzip', storedLength, originalLength }],
            },
            header,
            context,
          ),
        'invalid-layout',
      );
    }
  });

  it('accepts exactly the gzip ratio limit and rejects a greater ratio', () => {
    const entry: DeploymentFile = {
      ...emptyFile,
      sha256: 'a'.repeat(64),
      compression: 'gzip',
      storedLength: 10,
      originalLength: 10 * DEPLOYMENT_LIMITS.compressionRatio,
    };
    const { index, header } = withFiles([entry]);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    expectInvalid(
      () =>
        validateDeploymentIndex(
          { ...index, files: [{ ...entry, originalLength: entry.originalLength + 1 }] },
          header,
          context,
        ),
      'invalid-layout',
    );
  });

  it('accepts the exact file size limit and rejects excess stored/original sizes', () => {
    const entry = {
      ...emptyFile,
      sha256: 'a'.repeat(64),
      storedLength: DEPLOYMENT_LIMITS.fileLength,
      originalLength: DEPLOYMENT_LIMITS.fileLength,
    };
    const { index, header } = withFiles([entry]);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    for (const field of ['storedLength', 'originalLength']) {
      expectInvalid(
        () =>
          validateDeploymentIndex(
            { ...index, files: [{ ...entry, [field]: DEPLOYMENT_LIMITS.fileLength + 1 }] },
            header,
            context,
          ),
        'limit-exceeded',
      );
    }
  });

  it('enforces total expanded length independently of container length', () => {
    const storedLength = 5 * 1024 ** 2;
    const files = Array.from({ length: 32 }, (_, i) => ({
      ...emptyFile,
      path: `mods/${i}.jar`,
      sha256: 'a'.repeat(64),
      compression: 'gzip' as const,
      storedLength,
      originalLength: DEPLOYMENT_LIMITS.fileLength,
      offset: i * storedLength,
    }));
    const { index, header } = withFiles(files);
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    const tooLarge = withFiles([
      ...files,
      {
        ...files[0],
        ...emptyFile,
        path: 'mods/extra.jar',
        sha256: 'a'.repeat(64),
        storedLength: 1,
        originalLength: 1,
        offset: 32 * storedLength,
      },
    ]);
    expectInvalid(
      () => validateDeploymentIndex(tooLarge.index, tooLarge.header, context),
      'limit-exceeded',
    );
  });

  it('rejects excess file count before visiting entries', () => {
    const { header, index } = createValidDeployment();
    expectInvalid(
      () =>
        validateDeploymentIndex(
          { ...index, files: Array(DEPLOYMENT_LIMITS.fileCount + 1).fill(null) },
          header,
          context,
        ),
      'limit-exceeded',
    );
  });

  it('rejects sparse arrays, missing file fields, and unknown file fields', () => {
    const { index, header } = withFiles([emptyFile]);
    for (const files of [
      Array(1),
      [{ ...emptyFile, extra: true }],
      [{ path: 'mods/a.jar' }],
      null,
    ]) {
      expectInvalid(
        () => validateDeploymentIndex({ ...index, files }, header, context),
        'invalid-shape',
      );
    }
  });

  it('revalidates the supplied header rather than trusting a TypeScript annotation', () => {
    const { index, header } = createValidDeployment();
    const changed = { ...header, totalLength: Number.MAX_SAFE_INTEGER + 1 };
    expectInvalid(() => validateDeploymentIndex(index, changed, context), 'invalid-number');
    expectInvalid(() => getDeploymentFileRange(changed, emptyFile), 'invalid-number');
  });
});
