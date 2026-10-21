import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stat as lstatOrUndefined } from '../../minecraft/filesystem';
import { acquireServerDataLock } from '../../minecraft/lock';
import {
  DELETION_MARKER_FILE,
  deleteServerData,
  ensureServerDataRoot,
  getServerDataUsage,
  listServerData,
  previewServerDataDeletion,
  ROOT_MARKER_FILE,
  resolveServerDataRoot,
  ServerDataError,
  type ServerDataErrorCode,
} from './index';

const SERVER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const isWindows = process.platform === 'win32';
const canTestPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

let temp: string;
let base: string;
let outside: string;

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'torchlauncher-data-')));
  base = join(temp, 'userData');
  outside = join(temp, 'outside');
  await mkdir(base);
  await mkdir(outside);
  await writeFile(join(outside, 'keep.bin'), Buffer.alloc(5000));
});

afterEach(async () => {
  await chmod(temp, 0o700).catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
});

async function expectCode(promise: Promise<unknown>, code: ServerDataErrorCode) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ServerDataError);
  expect((error as ServerDataError).code).toBe(code);
  return error as ServerDataError;
}

async function exists(path: string) {
  return (await lstatOrUndefined(path)) !== undefined;
}

async function populate(root: string) {
  await mkdir(join(root, 'mods'), { recursive: true });
  await mkdir(join(root, 'saves', 'world', 'region'), { recursive: true });
  await writeFile(join(root, 'mods', 'a.jar'), Buffer.alloc(100));
  await writeFile(join(root, 'saves', 'world', 'region', 'r.0.0.mca'), Buffer.alloc(250));
  await writeFile(join(root, 'options.txt'), 'fov:0.5\n');
}

async function previewToken(serverId = SERVER) {
  const preview = await previewServerDataDeletion(base, serverId);
  expect(preview.blockers).toEqual([]);
  return preview.confirmation?.token as string;
}

describe('resolveServerDataRoot', () => {
  it('builds <base>/servers/<uuid>', () => {
    expect(resolveServerDataRoot(base, SERVER)).toBe(join(base, 'servers', SERVER));
  });

  it.each([
    '',
    'not-a-uuid',
    '11111111-1111-1111-8111-111111111111',
    '11111111-1111-4111-8111-11111111111A',
    `../${SERVER}`,
    `${SERVER}/..`,
  ])('rejects server id %j', (id) => {
    expect(() => resolveServerDataRoot(base, id)).toThrow(
      expect.objectContaining({ code: 'invalid-server-id' }),
    );
  });

  it('rejects relative, non-normalized and filesystem-root bases', () => {
    for (const bad of ['relative/base', `${base}/../userData`, `${base}/`, '/', `${base}\0x`])
      expect(() => resolveServerDataRoot(bad, SERVER)).toThrow(
        expect.objectContaining({ code: 'invalid-base' }),
      );
  });
});

describe('ensureServerDataRoot', () => {
  it('creates a root with a strict, private marker and is idempotent', async () => {
    const first = await ensureServerDataRoot(base, SERVER);
    expect(first.created).toBe(true);
    expect(first.root).toBe(join(base, 'servers', SERVER));
    const marker = JSON.parse(await readFile(join(first.root, ROOT_MARKER_FILE), 'utf8'));
    expect(marker).toMatchObject({ format: 'torchlauncher-server-data-root', version: 1 });
    expect(marker.serverId).toBe(SERVER);
    const second = await ensureServerDataRoot(base, SERVER);
    expect(second).toMatchObject({ created: false, marker: first.marker });
    expect(await exists(join(first.root, '.torchlauncher-server-lock'))).toBe(false);
  });

  it('requires an existing, non-link base', async () => {
    await expectCode(ensureServerDataRoot(join(temp, 'missing'), SERVER), 'invalid-base');
    if (isWindows) return;
    await symlink(base, join(temp, 'linked-base'));
    await expectCode(ensureServerDataRoot(join(temp, 'linked-base'), SERVER), 'invalid-base');
  });

  it('refuses to adopt an existing unmarked folder unless asked', async () => {
    const root = resolveServerDataRoot(base, SERVER);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'smoke.log'), 'dev');
    await expectCode(ensureServerDataRoot(base, SERVER), 'unmarked-root');
    expect(await exists(join(root, ROOT_MARKER_FILE))).toBe(false);
    const adopted = await ensureServerDataRoot(base, SERVER, { adoptExisting: true });
    expect(adopted.created).toBe(false);
    expect(await exists(join(root, ROOT_MARKER_FILE))).toBe(true);
  });

  it('adopts an empty existing root', async () => {
    await mkdir(resolveServerDataRoot(base, SERVER), { recursive: true });
    await expect(ensureServerDataRoot(base, SERVER)).resolves.toMatchObject({ created: false });
  });

  it('rejects mismatched, malformed, oversized and linked markers', async () => {
    const other = await ensureServerDataRoot(base, OTHER);
    const root = resolveServerDataRoot(base, SERVER);
    await mkdir(root, { recursive: true });
    const markerPath = join(root, ROOT_MARKER_FILE);

    await writeFile(markerPath, await readFile(join(other.root, ROOT_MARKER_FILE)));
    await expectCode(ensureServerDataRoot(base, SERVER), 'marker-mismatch');

    await writeFile(markerPath, '{"format":"torchlauncher-server-data-root"');
    await expectCode(ensureServerDataRoot(base, SERVER), 'marker-invalid');

    const valid = JSON.parse(await readFile(join(other.root, ROOT_MARKER_FILE), 'utf8'));
    await writeFile(markerPath, JSON.stringify({ ...valid, serverId: SERVER, extra: 1 }));
    await expectCode(ensureServerDataRoot(base, SERVER), 'marker-invalid');

    await writeFile(markerPath, ' '.repeat(5000));
    await expectCode(ensureServerDataRoot(base, SERVER), 'marker-invalid');

    if (isWindows) return;
    await rm(markerPath);
    await writeFile(join(outside, 'marker.json'), JSON.stringify({ ...valid, serverId: SERVER }));
    await symlink(join(outside, 'marker.json'), markerPath);
    await expectCode(ensureServerDataRoot(base, SERVER), 'marker-invalid');
  });
});

describe('getServerDataUsage', () => {
  it('counts bytes, files and directories without following links', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    const markerBytes = (await readFile(join(root, ROOT_MARKER_FILE))).length;
    if (!isWindows) {
      await symlink(outside, join(root, 'outside-dir'));
      await symlink(join(outside, 'keep.bin'), join(root, 'outside-file'));
      await link(join(root, 'mods', 'a.jar'), join(root, 'mods', 'hard.jar'));
    }
    const progress = vi.fn();
    const usage = await getServerDataUsage(base, SERVER, { onProgress: progress });
    expect(usage).toMatchObject({
      status: 'complete',
      root,
      bytes: 100 + 250 + 8 + markerBytes,
      files: isWindows ? 4 : 5,
      directories: 4,
      links: isWindows ? 0 : 2,
      others: 0,
    });
    expect(progress).toHaveBeenCalled();
  });

  it('reports limits explicitly instead of partial totals', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    expect(await getServerDataUsage(base, SERVER, { limits: { maxEntries: 3 } })).toEqual({
      status: 'limit-exceeded',
      limit: 'entries',
      root,
    });
    expect(await getServerDataUsage(base, SERVER, { limits: { maxDepth: 2 } })).toMatchObject({
      status: 'limit-exceeded',
      limit: 'depth',
    });
    expect(await getServerDataUsage(base, SERVER, { limits: { maxDepth: 4 } })).toMatchObject({
      status: 'complete',
    });
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
    expect(await getServerDataUsage(base, SERVER, { limits: { timeoutMs: 1500 } })).toMatchObject({
      status: 'limit-exceeded',
      limit: 'time',
    });
  });

  it('honours cancellation', async () => {
    await populate((await ensureServerDataRoot(base, SERVER)).root);
    const controller = new AbortController();
    controller.abort();
    await expectCode(getServerDataUsage(base, SERVER, { signal: controller.signal }), 'aborted');
  });

  it.skipIf(isWindows)('refuses a root that is itself a link', async () => {
    await mkdir(join(base, 'servers'));
    await symlink(outside, resolveServerDataRoot(base, SERVER));
    await expectCode(getServerDataUsage(base, SERVER), 'unsafe-path');
  });
});

describe('previewServerDataDeletion', () => {
  it('describes the target and issues a token without side effects', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    const before = (await readdir(root)).sort();
    const preview = await previewServerDataDeletion(base, SERVER);
    expect(preview).toMatchObject({
      root,
      exists: true,
      marker: 'valid',
      deletionInProgress: false,
      lock: { state: 'unlocked' },
      usage: { status: 'complete', files: 4 },
      deletable: true,
      blockers: [],
    });
    expect(preview.confirmation?.token).toMatch(/^[\w-]{43}$/u);
    expect((await readdir(root)).sort()).toEqual(before);
  });

  it('reports missing roots, unmarked roots, locks and limits as blockers', async () => {
    expect(await previewServerDataDeletion(base, SERVER)).toMatchObject({
      exists: false,
      deletable: false,
      blockers: ['root-not-found'],
    });
    const root = resolveServerDataRoot(base, SERVER);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'smoke.log'), 'dev');
    const unmarked = await previewServerDataDeletion(base, SERVER);
    expect(unmarked).toMatchObject({ marker: 'missing', blockers: ['marker-missing'] });
    expect(unmarked.confirmation).toBeUndefined();

    await ensureServerDataRoot(base, OTHER);
    const lease = await acquireServerDataLock(resolveServerDataRoot(base, OTHER), 'game');
    const locked = await previewServerDataDeletion(base, OTHER);
    expect(locked).toMatchObject({
      lock: { state: 'locked', purpose: 'game', pid: process.pid },
      deletable: false,
      blockers: ['locked'],
    });
    await lease.release();
    await populate(resolveServerDataRoot(base, OTHER));
    expect(
      await previewServerDataDeletion(base, OTHER, { limits: { maxEntries: 1 } }),
    ).toMatchObject({ blockers: ['limit-exceeded'], deletable: false });
  });
});

describe('deleteServerData', () => {
  it('deletes only the confirmed marked root and preserves everything else', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    const other = await ensureServerDataRoot(base, OTHER);
    await populate(root);
    await populate(other.root);
    await mkdir(join(base, '.minecraft'));
    await writeFile(join(base, '.minecraft', 'options.txt'), 'keep');
    await mkdir(join(base, 'accounts'));
    await writeFile(join(base, 'accounts', 'cache.bin'), 'keep');
    await mkdir(join(base, 'servers-backup'));
    await writeFile(join(base, 'servers', 'notes.txt'), 'keep');
    if (!isWindows) {
      await symlink(outside, join(root, 'mods', 'outside-dir'));
      await symlink(join(outside, 'keep.bin'), join(root, 'outside-file'));
      await symlink(other.root, join(root, 'other-server'));
      await symlink(base, join(root, 'saves', 'base-link'));
    }

    const preview = await previewServerDataDeletion(base, SERVER);
    const progress = vi.fn();
    const result = await deleteServerData(base, SERVER, preview.confirmation?.token as string, {
      onProgress: progress,
    });
    expect(result).toMatchObject({ status: 'deleted', root, removedBytes: 358 });
    expect(await exists(root)).toBe(false);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finalizing' }));

    expect((await readFile(join(outside, 'keep.bin'))).length).toBe(5000);
    expect(await readFile(join(base, '.minecraft', 'options.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(base, 'accounts', 'cache.bin'), 'utf8')).toBe('keep');
    expect(await exists(join(base, 'servers-backup'))).toBe(true);
    expect(await exists(join(base, 'servers', 'notes.txt'))).toBe(true);
    expect(await exists(join(other.root, ROOT_MARKER_FILE))).toBe(true);
    const otherMarker = (await readFile(join(other.root, ROOT_MARKER_FILE))).length;
    expect(await getServerDataUsage(base, OTHER)).toMatchObject({
      files: 4,
      bytes: 358 + otherMarker,
    });
  });

  it('requires a fresh, matching, single-use confirmation', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await ensureServerDataRoot(base, OTHER);
    await populate(root);
    await expectCode(deleteServerData(base, SERVER, 'forged'), 'confirmation-required');
    const otherToken = await previewToken(OTHER);
    await expectCode(deleteServerData(base, SERVER, otherToken), 'confirmation-required');
    const expiring = await previewServerDataDeletion(base, SERVER, { confirmationTtlMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expectCode(
      deleteServerData(base, SERVER, expiring.confirmation?.token as string),
      'confirmation-required',
    );
    const token = await previewToken();
    await deleteServerData(base, SERVER, token);
    await ensureServerDataRoot(base, SERVER);
    await expectCode(deleteServerData(base, SERVER, token), 'confirmation-required');
    expect(await exists(join(root, ROOT_MARKER_FILE))).toBe(true);
  });

  it('refuses while the game or installer holds the lock', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    const token = await previewToken();
    const lease = await acquireServerDataLock(root, 'game');
    await expectCode(deleteServerData(base, SERVER, token), 'locked');
    await lease.release();
    expect(await getServerDataUsage(base, SERVER)).toMatchObject({ files: 4 });
  });

  it('refuses when the root was replaced or unmarked after the preview', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    let token = await previewToken();
    await rm(root, { recursive: true });
    await ensureServerDataRoot(base, SERVER);
    await populate(root);
    await expectCode(deleteServerData(base, SERVER, token), 'target-changed');

    token = await previewToken();
    await rm(join(root, ROOT_MARKER_FILE));
    await expectCode(deleteServerData(base, SERVER, token), 'marker-missing');
    expect(await getServerDataUsage(base, SERVER)).toMatchObject({ files: 3 });
  });

  it('does nothing when cancelled before starting', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    const token = await previewToken();
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      deleteServerData(base, SERVER, token, { signal: controller.signal }),
      'aborted',
    );
    expect(await exists(join(root, DELETION_MARKER_FILE))).toBe(false);
    expect(await getServerDataUsage(base, SERVER)).toMatchObject({ files: 4 });
  });

  it('reports a cancelled deletion as incomplete and resumes on retry', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await mkdir(join(root, 'many'));
    for (let index = 0; index < 400; index += 1)
      await writeFile(join(root, 'many', `${index}.txt`), 'x');
    const controller = new AbortController();
    const error = await expectCode(
      deleteServerData(base, SERVER, await previewToken(), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.removedEntries >= 128) controller.abort();
        },
      }),
      'deletion-incomplete',
    );
    expect((error.cause as ServerDataError).code).toBe('aborted');
    expect(await exists(join(root, DELETION_MARKER_FILE))).toBe(true);
    expect(await exists(join(root, '.torchlauncher-server-lock'))).toBe(false);
    const remaining = (await readdir(join(root, 'many'))).length;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(400);

    await expectCode(ensureServerDataRoot(base, SERVER), 'deletion-incomplete');
    const listing = await listServerData(base);
    expect(listing.servers).toMatchObject([{ serverId: SERVER, deletionInProgress: true }]);
    const preview = await previewServerDataDeletion(base, SERVER);
    expect(preview).toMatchObject({ deletionInProgress: true, deletable: true });
    await deleteServerData(base, SERVER, preview.confirmation?.token as string);
    expect(await exists(root)).toBe(false);
  });

  it.skipIf(!canTestPermissions)('resumes after a filesystem failure', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    await chmod(join(root, 'mods'), 0o500);
    const error = await expectCode(
      deleteServerData(base, SERVER, await previewToken()),
      'deletion-incomplete',
    );
    expect((error.cause as ServerDataError).code).toBe('io-error');
    expect(await exists(join(root, ROOT_MARKER_FILE))).toBe(true);
    await chmod(join(root, 'mods'), 0o700);
    await deleteServerData(base, SERVER, await previewToken());
    expect(await exists(root)).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')(
    'removes a Windows junction without touching its target',
    async () => {
      const { root } = await ensureServerDataRoot(base, SERVER);
      await symlink(outside, join(root, 'junction'), 'junction');
      await deleteServerData(base, SERVER, await previewToken());
      expect(await exists(root)).toBe(false);
      expect((await readFile(join(outside, 'keep.bin'))).length).toBe(5000);
    },
  );
});

describe('listServerData', () => {
  it('lists marked roots and only reports unrecognized entries', async () => {
    const { root } = await ensureServerDataRoot(base, SERVER);
    await populate(root);
    const servers = join(base, 'servers');
    await mkdir(join(servers, OTHER));
    await mkdir(join(servers, 'smoke'));
    await writeFile(join(servers, '44444444-4444-4444-8444-444444444444'), 'file');
    if (!isWindows) await symlink(outside, join(servers, '55555555-5555-4555-8555-555555555555'));

    const listing = await listServerData(base, { includeUsage: true });
    expect(listing.servers).toMatchObject([
      { serverId: SERVER, root, lock: { state: 'unlocked' }, usage: { files: 4 } },
    ]);
    expect(listing.unrecognized.map(({ name, reason }) => [name, reason])).toEqual(
      expect.arrayContaining([
        [OTHER, 'marker-missing'],
        ['smoke', 'not-server-id'],
        ['44444444-4444-4444-8444-444444444444', 'not-directory'],
        ...(isWindows ? [] : [['55555555-5555-4555-8555-555555555555', 'unsafe-path']]),
      ]),
    );
    expect(await exists(join(servers, OTHER, ROOT_MARKER_FILE))).toBe(false);
    expect(await listServerData(join(temp, 'outside'))).toEqual({
      serversPath: join(outside, 'servers'),
      servers: [],
      unrecognized: [],
    });
  });
});
