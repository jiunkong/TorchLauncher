import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
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
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import type { DeploymentFilePolicy } from '../../deployment/contracts/index.js';
import { openDeploymentReader } from '../../deployment/reader/index.js';
import { writeDeployment } from '../../deployment/writer/index.js';
import { createDownloadSource } from '../../download/source/index.js';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import { recoverSynchronization, synchronizeDeployment } from './index.js';
import { type Journal, LEDGER_BYTE_LIMIT, type Ledger, validateJournal } from './state.js';

const serverId = '11111111-1111-4111-8111-111111111111';
const otherServerId = '33333333-3333-4333-8333-333333333333';
const roots: string[] = [];

async function temporary(): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-sync-test-'));
  roots.push(root);
  return root;
}

async function symlinkOrSkip(context: TestContext, target: string, path: string): Promise<void> {
  try {
    await symlink(target, path, 'dir');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && ['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code))
      context.skip(`Host cannot create symlinks (${code})`);
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Input {
  path: string;
  data: string;
  policy?: DeploymentFilePolicy;
  compression?: 'none' | 'gzip';
}

async function bundle(files: Input[], id = '22222222-2222-4222-8222-222222222222') {
  const sourceRoot = await temporary();
  for (const file of files) {
    await mkdir(dirname(join(sourceRoot, file.path)), { recursive: true });
    await writeFile(join(sourceRoot, file.path), file.data);
  }
  const result = await writeDeployment({
    sourceRoot,
    outputPath: join(sourceRoot, 'output.torchpack'),
    serverId,
    deploymentId: id,
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.16.9' } },
    files: files.map((file) => ({
      sourcePath: file.path,
      policy: file.policy ?? 'always',
      compression: file.compression ?? 'none',
    })),
  });
  const bytes = await readFile(result.outputPath);
  return { bytes, index: result.index, payloadStart: 64 + result.header.indexLength };
}

async function readerFor(artifact: Awaited<ReturnType<typeof bundle>>) {
  const ranges: Array<{ start: number; end: number }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const range = /^bytes=([0-9]+)-([0-9]+)$/u.exec(new Headers(init?.headers).get('Range') ?? '');
    if (!range) throw new Error('Expected bounded range');
    const start = Number(range[1]);
    const end = Number(range[2]);
    ranges.push({ start, end });
    return new Response(artifact.bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${artifact.bytes.length}`,
        'Content-Length': String(end - start + 1),
        ETag: '"fixture-version"',
      },
    });
  };
  const source = createDownloadSource('https://example.test/deployment.torchpack', {
    fetch: fetcher,
  });
  const reader = await openDeploymentReader(source, { expectedServerId: serverId });
  return {
    reader,
    source,
    ranges,
    payloadRanges: () => ranges.filter((range) => range.start >= artifact.payloadStart),
  };
}

async function sync(root: string, artifact: Awaited<ReturnType<typeof bundle>>) {
  const transport = await readerFor(artifact);
  const result = await synchronizeDeployment({
    root,
    expectedServerId: serverId,
    reader: transport.reader,
  });
  return { ...transport, result };
}

async function contents(root: string, path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

const v1Files: Input[] = [
  { path: 'custom-data/arbitrary.bin', data: 'unchanged generic content' },
  { path: 'saves/world/marker.dat', data: 'server world marker' },
  { path: 'config/required.txt', data: 'old required'.repeat(30), compression: 'gzip' },
  { path: 'options.txt', data: 'initial personal defaults', policy: 'initial-only' },
  { path: 'removed.dat', data: 'old managed file' },
];
const v2Files: Input[] = [
  ...v1Files.slice(0, 2),
  { path: 'config/required.txt', data: 'new required'.repeat(30), compression: 'gzip' },
  {
    path: 'options.txt',
    data: 'new default must not replace personal data',
    policy: 'initial-only',
  },
  {
    path: 'later-default.txt',
    data: 'not installed after initial success',
    policy: 'initial-only',
  },
  { path: 'new-content.anything', data: 'new file' },
];

describe('synchronization ownership and transport', () => {
  it('installs generic content, reuses unchanged payloads, and synchronizes only changed files', async () => {
    const root = await temporary();
    const first = await bundle(v1Files);
    const initial = await sync(root, first);
    expect(initial.result).toMatchObject({ downloaded: 5, reused: 0, preserved: 0, deleted: 0 });
    expect(await contents(root, 'saves/world/marker.dat')).toBe('server world marker');
    const repeat = await sync(root, first);
    expect(repeat.result).toMatchObject({ downloaded: 0, reused: 4, preserved: 1 });
    expect(repeat.payloadRanges()).toHaveLength(0);
    await writeFile(join(root, 'options.txt'), 'personal settings');
    const second = await bundle(v2Files, '44444444-4444-4444-8444-444444444444');
    const update = await sync(root, second);
    expect(update.result).toMatchObject({ downloaded: 2, reused: 2, preserved: 2, deleted: 1 });
    const downloadedNames = second.index.files
      .filter((file) =>
        update.payloadRanges().some((range) => range.start === second.payloadStart + file.offset),
      )
      .map((file) => file.path);
    expect(downloadedNames).toEqual(['config/required.txt', 'new-content.anything']);
    expect(await contents(root, 'options.txt')).toBe('personal settings');
    await expect(readFile(join(root, 'later-default.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(root, 'removed.dat'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs missing or damaged owned always files but preserves deleted initial-only files', async () => {
    const root = await temporary();
    const artifact = await bundle(v1Files);
    await sync(root, artifact);
    await rm(join(root, 'options.txt'));
    await rm(join(root, 'custom-data/arbitrary.bin'));
    await writeFile(join(root, 'config/required.txt'), 'damaged');
    const update = await sync(root, artifact);
    expect(update.result).toMatchObject({ downloaded: 2, reused: 2, preserved: 1 });
    expect(await contents(root, 'custom-data/arbitrary.bin')).toBe(v1Files[0]?.data);
    await expect(readFile(join(root, 'options.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await sync(root, await bundle(v1Files.filter((file) => file.path !== 'options.txt')));
    await expect(readFile(join(root, 'options.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a pre-existing initial default and refuses to adopt unowned always files even with matching bytes', async () => {
    const root = await temporary();
    await writeFile(join(root, 'options.txt'), 'existing personal settings');
    const result = await sync(
      root,
      await bundle([{ path: 'options.txt', data: 'defaults', policy: 'initial-only' }]),
    );
    expect(result.result).toMatchObject({ downloaded: 0, preserved: 1 });
    expect(await contents(root, 'options.txt')).toBe('existing personal settings');
    await writeFile(join(root, 'unowned.bin'), 'same content');
    const artifact = await bundle([{ path: 'unowned.bin', data: 'same content' }]);
    const transport = await readerFor(artifact);
    await expect(
      synchronizeDeployment({ root, expectedServerId: serverId, reader: transport.reader }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(transport.payloadRanges()).toHaveLength(0);
    expect(await contents(root, 'unowned.bin')).toBe('same content');
  });

  it.each([
    [{ path: 'content.dat', data: 'a' }],
    [{ path: 'Options.txt', data: 'a', policy: 'initial-only' as const }],
    [{ path: 'options.txt/child', data: 'a' }],
  ])('rejects policy, spelling, or file/directory transitions: %j', async (next) => {
    const root = await temporary();
    await sync(
      root,
      await bundle([
        { path: 'options.txt', data: 'original', policy: 'initial-only' },
        { path: 'content.dat', data: 'old', policy: 'initial-only' },
      ]),
    );
    const transport = await readerFor(await bundle([next]));
    await expect(
      synchronizeDeployment({ root, expectedServerId: serverId, reader: transport.reader }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(transport.payloadRanges()).toHaveLength(0);
    expect(await contents(root, 'options.txt')).toBe('original');
  });

  it.each([
    'runtime/java',
    'Versions/client.jar',
    'libraries/a',
    'assets/a',
    'natives/a',
    'accounts/token',
    'public-java/a',
  ])('protects installer and credential paths: %s', async (path) => {
    const root = await temporary();
    const transport = await readerFor(await bundle([{ path, data: 'protected' }]));
    await expect(
      synchronizeDeployment({ root, expectedServerId: serverId, reader: transport.reader }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
    expect(transport.payloadRanges()).toHaveLength(0);
  });

  it('rejects symlink parents and roots', async (context) => {
    const artifact = await bundle([{ path: 'data/file.dat', data: 'server' }]);
    const root = await temporary();
    const outside = await temporary();
    await symlinkOrSkip(context, outside, join(root, 'data'));
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'unsafe-path' });
    const parent = await temporary();
    await symlinkOrSkip(context, outside, join(parent, 'alias'));
    await expect(sync(join(parent, 'alias'), artifact)).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('rejects hardlinks, case aliases, and directory targets', async () => {
    const artifact = await bundle([{ path: 'data/file.dat', data: 'server' }]);
    const root = await temporary();
    const outside = await temporary();
    await mkdir(join(root, 'data'));
    await writeFile(join(outside, 'original'), 'personal');
    await link(join(outside, 'original'), join(root, 'data/file.dat'));
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'unsafe-path' });
    expect(await contents(outside, 'original')).toBe('personal');
    await rm(join(root, 'data/file.dat'));
    await mkdir(join(root, 'data/file.dat'));
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'conflict' });
    const caseRoot = await temporary();
    await mkdir(join(caseRoot, 'Data'));
    await expect(sync(caseRoot, artifact)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('uses the maintenance lock without stealing an existing lease', async () => {
    const root = await temporary();
    const lease = await acquireServerDataLock(root, 'game');
    try {
      await expect(sync(root, await bundle([]))).rejects.toMatchObject({
        name: 'ServerDataLockedError',
      });
    } finally {
      await lease.release();
    }
  });

  it('resolves NFC-equivalent disk spellings while retaining case conflict checks', async () => {
    const root = await temporary();
    const nfcPath = '설정/é.txt';
    const diskPath = nfcPath.normalize('NFD');
    await mkdir(dirname(join(root, diskPath)), { recursive: true });
    await writeFile(join(root, diskPath), 'personal Unicode settings');
    await sync(root, await bundle([{ path: nfcPath, data: 'defaults', policy: 'initial-only' }]));
    expect(await contents(root, diskPath)).toBe('personal Unicode settings');
    const managed = 'é.bin';
    await sync(root, await bundle([{ path: managed, data: 'old' }]));
    if (managed !== managed.normalize('NFD'))
      await rename(join(root, managed), join(root, managed.normalize('NFD')));
    await sync(root, await bundle([{ path: managed, data: 'new' }]));
    expect(await contents(root, managed.normalize('NFD'))).toBe('new');
  });

  it('rejects a wrong server and corrupted or protected ledger without rebuilding ownership', async () => {
    const root = await temporary();
    const artifact = await bundle([{ path: 'data.bin', data: 'old' }]);
    await sync(root, artifact);
    const transport = await readerFor(artifact);
    await expect(
      synchronizeDeployment({ root, expectedServerId: otherServerId, reader: transport.reader }),
    ).rejects.toMatchObject({ code: 'server-mismatch' });
    const ledgerPath = join(root, '.torchlauncher-sync/ledger.json');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger;
    await writeFile(ledgerPath, '{"version":1,"version":1}');
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'invalid-state' });
    await writeFile(
      ledgerPath,
      JSON.stringify({
        ...ledger,
        files: ledger.files.map((file) => ({ ...file, path: 'runtime/owned' })),
      }),
    );
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'unsafe-path' });
    expect(await contents(root, 'data.bin')).toBe('old');
  });

  it('rejects oversized state before parsing', async () => {
    const root = await temporary();
    const artifact = await bundle([{ path: 'managed', data: 'old' }]);
    await sync(root, artifact);
    await truncate(join(root, '.torchlauncher-sync/ledger.json'), LEDGER_BYTE_LIMIT + 1);
    await expect(sync(root, artifact)).rejects.toMatchObject({ code: 'invalid-state' });
    expect(await contents(root, 'managed')).toBe('old');
  });
});

describe('synchronization transaction failures and recovery', () => {
  it('marks first setup complete only after a successful transaction', async () => {
    const root = await temporary();
    const artifact = await bundle([
      { path: 'options.txt', data: 'defaults', policy: 'initial-only' },
    ]);
    const transport = await readerFor(artifact);
    const controller = new AbortController();
    await expect(
      synchronizeDeployment({
        root,
        expectedServerId: serverId,
        reader: transport.reader,
        signal: controller.signal,
        onProgress(event) {
          if (event.phase === 'staging') controller.abort();
        },
      }),
    ).rejects.toThrow();
    await expect(readFile(join(root, '.torchlauncher-sync/ledger.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await sync(root, artifact)).result.downloaded).toBe(1);
    expect(await contents(root, 'options.txt')).toBe('defaults');
  });
  it.each(['cancel', 'source-reset', 'corruption'])(
    'preserves every old file and ledger if staging fails: %s',
    async (kind) => {
      const root = await temporary();
      await sync(root, await bundle(v1Files));
      const before = await readFile(join(root, '.torchlauncher-sync/ledger.json'));
      const artifact = await bundle(v2Files);
      if (kind === 'corruption') {
        const changedFile = artifact.index.files.find(
          (file) => file.path === 'new-content.anything',
        );
        if (!changedFile) throw new Error('Missing changed fixture');
        const position = artifact.payloadStart + changedFile.offset;
        artifact.bytes[position] = (artifact.bytes[position] ?? 0) ^ 1;
      }
      const transport = await readerFor(artifact);
      const controller = new AbortController();
      await expect(
        synchronizeDeployment({
          root,
          expectedServerId: serverId,
          reader: transport.reader,
          signal: controller.signal,
          onProgress(event) {
            if (event.phase === 'staging') {
              if (kind === 'cancel') controller.abort(new Error('cancelled staging'));
              if (kind === 'source-reset') transport.source.reset();
            }
          },
        }),
      ).rejects.toThrow();
      expect(await readFile(join(root, '.torchlauncher-sync/ledger.json'))).toEqual(before);
      expect(await contents(root, 'config/required.txt')).toBe(v1Files[2]?.data);
      expect(await contents(root, 'removed.dat')).toBe('old managed file');
      await expect(readFile(join(root, 'new-content.anything'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readdir(join(root, '.torchlauncher-sync'))).toEqual(['ledger.json']);
    },
  );

  it('rechecks local files after staging and preserves a concurrent personal edit', async () => {
    const root = await temporary();
    await sync(root, await bundle(v1Files));
    const transport = await readerFor(await bundle(v2Files));
    await expect(
      synchronizeDeployment({
        root,
        expectedServerId: serverId,
        reader: transport.reader,
        async onProgress(event) {
          if (event.phase === 'staging')
            await writeFile(join(root, 'config/required.txt'), 'concurrent edit');
        },
      }),
    ).rejects.toMatchObject({ code: 'local-changed' });
    expect(await contents(root, 'config/required.txt')).toBe('concurrent edit');
    expect(await contents(root, 'removed.dat')).toBe('old managed file');
  });

  it('rolls back applied files and ledger on an apply failure', async () => {
    const root = await temporary();
    await sync(root, await bundle(v1Files));
    const previousLedger = await readFile(join(root, '.torchlauncher-sync/ledger.json'));
    const transport = await readerFor(await bundle(v2Files));
    await expect(
      synchronizeDeployment({
        root,
        expectedServerId: serverId,
        reader: transport.reader,
        onProgress(event) {
          if (event.phase === 'applying' && event.path) throw new Error('injected apply failure');
        },
      }),
    ).rejects.toThrow('injected apply failure');
    expect(await contents(root, 'config/required.txt')).toBe(v1Files[2]?.data);
    expect(await contents(root, 'removed.dat')).toBe('old managed file');
    expect(await readFile(join(root, '.torchlauncher-sync/ledger.json'))).toEqual(previousLedger);
    expect(await readdir(join(root, '.torchlauncher-sync'))).toEqual(['ledger.json']);
  });

  it('preserves an external identical new file when its uninstalled stage still exists', async () => {
    const root = await temporary();
    await sync(root, await bundle(v1Files));
    const transport = await readerFor(await bundle(v2Files));
    await expect(
      synchronizeDeployment({
        root,
        expectedServerId: serverId,
        reader: transport.reader,
        async onProgress(event) {
          if (event.phase === 'applying' && event.path === 'config/required.txt') {
            await writeFile(join(root, 'new-content.anything'), 'new file');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await contents(root, 'new-content.anything')).toBe('new file');
    await expect(
      recoverSynchronization({ root, expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await contents(root, 'new-content.anything')).toBe('new file');
    await rm(join(root, 'new-content.anything'));
    expect(await recoverSynchronization({ root, expectedServerId: serverId })).toBe('rolled-back');
    expect(await contents(root, 'config/required.txt')).toBe(v1Files[2]?.data);
  });

  it.each(['cancel', 'reset'])(
    'rolls back when %s occurs during final file verification',
    async (kind) => {
      const root = await temporary();
      await sync(root, await bundle(v1Files));
      const transport = await readerFor(await bundle(v2Files));
      const controller = new AbortController();
      await expect(
        synchronizeDeployment({
          root,
          expectedServerId: serverId,
          reader: transport.reader,
          signal: controller.signal,
          onProgress(event) {
            if (event.phase === 'applying' && event.path === 'removed.dat') {
              setTimeout(() => {
                if (kind === 'cancel') controller.abort();
                else transport.source.reset();
              }, 0);
            }
          },
        }),
      ).rejects.toThrow();
      expect(await contents(root, 'config/required.txt')).toBe(v1Files[2]?.data);
      expect(await contents(root, 'removed.dat')).toBe('old managed file');
      await expect(readFile(join(root, 'new-content.anything'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each(['applying', 'committed'] as const)(
    'recovers a journal left after ledger replacement in phase %s',
    async (phase) => {
      const root = await temporary();
      await sync(root, await bundle([{ path: 'managed', data: 'old' }]));
      const previousBytes = await readFile(join(root, '.torchlauncher-sync/ledger.json'));
      const previous = JSON.parse(previousBytes.toString('utf8')) as Ledger;
      await sync(
        root,
        await bundle([{ path: 'managed', data: 'new' }], '44444444-4444-4444-8444-444444444444'),
      );
      const nextBytes = await readFile(join(root, '.torchlauncher-sync/ledger.json'));
      const next = JSON.parse(nextBytes.toString('utf8')) as Ledger;
      const transaction = join(root, '.torchlauncher-sync/transaction');
      await mkdir(transaction);
      await writeFile(join(transaction, 'backup-00000'), 'old');
      await writeFile(join(transaction, 'ledger.backup'), previousBytes);
      const journal = validateJournal(
        {
          version: 1,
          transactionId: serverId,
          phase,
          serverId,
          previous,
          next,
          operations: [
            {
              path: 'managed',
              before: { length: 3, sha256: createHash('sha256').update('old').digest('hex') },
              after: { length: 3, sha256: createHash('sha256').update('new').digest('hex') },
            },
          ],
        },
        serverId,
      );
      await writeFile(join(root, '.torchlauncher-sync/journal.json'), JSON.stringify(journal));
      expect(await recoverSynchronization({ root, expectedServerId: serverId })).toBe(
        phase === 'applying' ? 'rolled-back' : 'cleaned-committed',
      );
      expect(await contents(root, 'managed')).toBe(phase === 'applying' ? 'old' : 'new');
      expect(await readFile(join(root, '.torchlauncher-sync/ledger.json'))).toEqual(
        phase === 'applying' ? previousBytes : nextBytes,
      );
      expect(await readdir(join(root, '.torchlauncher-sync'))).toEqual(['ledger.json']);
    },
  );

  it('preserves an unrecoverable journal and later restores files once its missing backup returns', async () => {
    const root = await temporary();
    await sync(root, await bundle(v1Files));
    const beforeLedger = await readFile(join(root, '.torchlauncher-sync/ledger.json'));
    const transport = await readerFor(await bundle(v2Files));
    const held = join(await temporary(), 'held-backup');
    const transaction = join(root, '.torchlauncher-sync/transaction');
    await expect(
      synchronizeDeployment({
        root,
        expectedServerId: serverId,
        reader: transport.reader,
        async onProgress(event) {
          if (event.phase === 'applying' && event.path) {
            await rename(join(transaction, 'backup-00000'), held);
            throw new Error('simulated unavailable backup');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await readFile(join(root, '.torchlauncher-sync/journal.json'), 'utf8')).toContain(
      'applying',
    );
    await rename(held, join(transaction, 'backup-00000'));
    await writeFile(join(transaction, 'unknown-artifact'), 'preserve unknown internal data');
    await expect(
      recoverSynchronization({ root, expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await readFile(join(transaction, 'unknown-artifact'), 'utf8')).toBe(
      'preserve unknown internal data',
    );
    await rm(join(transaction, 'unknown-artifact'));
    expect(await recoverSynchronization({ root, expectedServerId: serverId })).toBe('rolled-back');
    expect(await contents(root, 'config/required.txt')).toBe(v1Files[2]?.data);
    expect(await readFile(join(root, '.torchlauncher-sync/ledger.json'))).toEqual(beforeLedger);
    expect(await readdir(join(root, '.torchlauncher-sync'))).toEqual(['ledger.json']);
  });

  it('rejects a forged journal operation outside the validated ledger ownership', async () => {
    const root = await temporary();
    await sync(root, await bundle([{ path: 'managed', data: 'server' }]));
    const ledger = JSON.parse(
      await readFile(join(root, '.torchlauncher-sync/ledger.json'), 'utf8'),
    ) as Ledger;
    const journal: Journal = {
      version: 1,
      transactionId: serverId,
      phase: 'applying',
      serverId,
      previous: ledger,
      next: ledger,
      operations: [
        { path: 'unowned-personal', before: { sha256: '0'.repeat(64), length: 1 }, after: null },
      ],
    };
    expect(() => validateJournal(journal, serverId)).toThrow();
    await mkdir(join(root, '.torchlauncher-sync/transaction'));
    await writeFile(join(root, '.torchlauncher-sync/journal.json'), JSON.stringify(journal));
    await writeFile(join(root, 'unowned-personal'), 'personal');
    await expect(
      recoverSynchronization({ root, expectedServerId: serverId }),
    ).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await contents(root, 'unowned-personal')).toBe('personal');
  });
});
