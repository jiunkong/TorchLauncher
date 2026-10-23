import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseTestInstanceLedger,
  planTestInstance,
  TEST_INSTANCE_LEDGER_PATH,
  type TestOwnedFile,
} from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'torch-test-plan-'));
  roots.push(root);
  const sourceRoot = join(root, 'source');
  const instanceRoot = join(root, 'instance');
  await mkdir(sourceRoot);
  await mkdir(instanceRoot);
  return { sourceRoot, instanceRoot };
}
async function put(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}
function owned(
  path: string,
  text: string,
  policy: TestOwnedFile['policy'] = 'always',
): TestOwnedFile {
  return {
    path,
    policy,
    sha256: createHash('sha256').update(text).digest('hex'),
    length: Buffer.byteLength(text),
  };
}
const ledger = (root: string, files: TestOwnedFile[]) =>
  put(root, TEST_INSTANCE_LEDGER_PATH, JSON.stringify({ version: 1, files }));

describe('planTestInstance', () => {
  it('plans copies and owned removals without changing any file', async () => {
    const env = await setup();
    await put(env.sourceRoot, 'mods/new.jar', 'new');
    await put(env.instanceRoot, 'mods/old.jar', 'old');
    await put(env.instanceRoot, 'options.txt', 'game');
    await ledger(env.instanceRoot, [owned('mods/old.jar', 'old')]);
    const result = await planTestInstance({
      ...env,
      candidateFiles: [{ path: 'mods/new.jar', policy: 'always' }],
    });
    expect(result.copies.map((file) => file.path)).toEqual(['mods/new.jar']);
    expect(result.removals.map((file) => file.path)).toEqual(['mods/old.jar']);
    expect(parseTestInstanceLedger(JSON.stringify(result.nextLedger))).toEqual(result.nextLedger);
    expect(await readFile(join(env.instanceRoot, 'mods/old.jar'), 'utf8')).toBe('old');
    expect(await readdir(join(env.instanceRoot, 'mods'))).toEqual(['old.jar']);
    expect(await readFile(join(env.instanceRoot, 'options.txt'), 'utf8')).toBe('game');
  });
  it('preserves unowned and modified files, initial-only changes and game data', async () => {
    const env = await setup();
    for (const path of [
      'mods/unowned.jar',
      'mods/modified.jar',
      'mods/initial.jar',
      'config/game.txt',
      'saves/world/data',
      'options.txt',
    ])
      await put(env.instanceRoot, path, 'changed');
    await ledger(
      env.instanceRoot,
      [
        'mods/modified.jar',
        'mods/initial.jar',
        'mods/deleted.jar',
        'config/game.txt',
        'saves/world/data',
        'options.txt',
      ].map((path) =>
        owned(
          path,
          path.includes('modified') ? 'original' : 'changed',
          path.includes('initial') || path.includes('deleted') ? 'initial-only' : 'always',
        ),
      ),
    );
    const result = await planTestInstance({
      ...env,
      candidateFiles: [
        'mods/unowned.jar',
        'mods/modified.jar',
        'mods/initial.jar',
        'mods/deleted.jar',
      ].map((path) => ({ path, policy: 'always' })),
    });
    expect(result.copies).toEqual([]);
    expect(result.removals).toEqual([]);
    expect(result.skipped.map((item) => item.reason)).toEqual([
      'unowned',
      'modified',
      'initial-only',
      'initial-only',
      'game-data',
      'game-data',
      'game-data',
    ]);
  });
  it('does not adopt an existing unowned file even if its bytes match', async () => {
    const env = await setup();
    await put(env.instanceRoot, 'mods/same.jar', 'same');
    await put(env.sourceRoot, 'mods/same.jar', 'same');
    const plan = await planTestInstance({
      ...env,
      candidateFiles: [{ path: 'mods/same.jar', policy: 'always' }],
    });
    expect(plan.nextLedger.files).toEqual([]);
    expect(plan.skipped).toEqual([{ path: 'mods/same.jar', reason: 'unowned' }]);
  });
  it('updates owned files, skips identical ones and filters excluded candidates', async () => {
    const env = await setup();
    await put(env.sourceRoot, 'mods/a.jar', 'new');
    await put(env.instanceRoot, 'mods/a.jar', 'old');
    await ledger(env.instanceRoot, [owned('mods/a.jar', 'old')]);
    const plan = await planTestInstance({
      ...env,
      candidateFiles: [
        { path: 'mods/a.jar', policy: 'always' },
        { path: 'ignore.jar', policy: 'exclude' },
      ],
    });
    expect(plan.copies[0]?.before).toMatchObject({ sha256: owned('mods/a.jar', 'old').sha256 });
    await put(env.instanceRoot, 'mods/a.jar', 'new');
    await ledger(env.instanceRoot, plan.nextLedger.files);
    expect(
      (
        await planTestInstance({
          ...env,
          candidateFiles: [{ path: 'mods/a.jar', policy: 'always' }],
        })
      ).skipped,
    ).toEqual([{ path: 'mods/a.jar', reason: 'unchanged' }]);
  });
  it('supports a missing instance without creating directories', async () => {
    const env = await setup();
    await rm(env.instanceRoot, { recursive: true });
    await put(env.sourceRoot, 'mods/a.jar', 'a');
    const result = await planTestInstance({
      ...env,
      candidateFiles: [{ path: 'mods/a.jar', policy: 'initial-only' }],
    });
    expect(result.copies).toHaveLength(1);
    expect(await readdir(dirname(env.instanceRoot))).toEqual(['source']);
  });
  it.each([
    '../escape',
    '/absolute',
    'C:/escape',
    'mods/../escape',
    'mods\\escape',
    '.torchlauncher-test/ledger.json',
    'mods//a',
    'mods/a:stream',
    'mods/CON',
    'mods/a.',
  ])('rejects unsafe candidate %s', async (path) => {
    await expect(
      planTestInstance({ ...(await setup()), candidateFiles: [{ path, policy: 'always' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });
  it('rejects case aliases, path prefix conflicts and overlapping roots', async () => {
    const env = await setup();
    for (const paths of [
      ['mods/A.jar', 'mods/a.jar'],
      ['mods', 'mods/a.jar'],
    ])
      await expect(
        planTestInstance({
          ...env,
          candidateFiles: paths.map((path) => ({ path, policy: 'always' })),
        }),
      ).rejects.toMatchObject({ code: 'unsafe-path' });
    await expect(
      planTestInstance({
        ...env,
        instanceRoot: join(env.sourceRoot, 'inside'),
        candidateFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });
  it('refuses symlink ancestors, file symlinks, hardlinks and linked ledger', async () => {
    const env = await setup();
    await put(env.sourceRoot, 'real/a.jar', 'a');
    await symlink(join(env.sourceRoot, 'real'), join(env.sourceRoot, 'mods'), 'dir');
    await expect(
      planTestInstance({ ...env, candidateFiles: [{ path: 'mods/a.jar', policy: 'always' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
    await symlink(join(env.sourceRoot, 'real/a.jar'), join(env.sourceRoot, 'symlink.jar'));
    await expect(
      planTestInstance({ ...env, candidateFiles: [{ path: 'symlink.jar', policy: 'always' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
    await link(join(env.sourceRoot, 'real/a.jar'), join(env.sourceRoot, 'hard.jar'));
    await expect(
      planTestInstance({ ...env, candidateFiles: [{ path: 'hard.jar', policy: 'always' }] }),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
    await mkdir(join(env.instanceRoot, '.torchlauncher-test'));
    await symlink(
      join(env.sourceRoot, 'real/a.jar'),
      join(env.instanceRoot, TEST_INSTANCE_LEDGER_PATH),
    );
    await expect(planTestInstance({ ...env, candidateFiles: [] })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });
  it.each([
    '{broken',
    '{"version":2,"files":[]}',
    '{"version":1,"files":[{"path":"../escape","policy":"always","sha256":"bad","length":0}]}',
    '{"version":1,"version":1,"files":[]}',
    '{"version":1,"files":[],"extra":true}',
  ])('safely rejects corrupt ledger %s', async (text) => {
    const env = await setup();
    await put(env.instanceRoot, TEST_INSTANCE_LEDGER_PATH, text);
    await expect(planTestInstance({ ...env, candidateFiles: [] })).rejects.toMatchObject({
      code: 'invalid-ledger',
    });
  });
  it('rejects oversized and malicious valid-looking ledger', async () => {
    const env = await setup();
    await put(env.instanceRoot, TEST_INSTANCE_LEDGER_PATH, ' '.repeat(1024 * 1024 + 1));
    await expect(planTestInstance({ ...env, candidateFiles: [] })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    expect(() =>
      parseTestInstanceLedger(JSON.stringify({ version: 1, files: [owned('../escape', '')] })),
    ).toThrowError('invalid-ledger');
    expect(() =>
      parseTestInstanceLedger(
        JSON.stringify({ version: 1, files: [owned('mods/a.jar', ''), owned('mods/A.jar', '')] }),
      ),
    ).toThrowError('invalid-ledger');
  });
});
