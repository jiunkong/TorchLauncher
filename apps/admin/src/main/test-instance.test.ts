import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testInstance } from '@torchlauncher/core';
import { afterEach, expect, it } from 'vitest';
import { applyTestInstance, recoverTestInstance } from './test-instance.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'studio-test-instance-'));
  roots.push(base);
  const sourceRoot = join(base, 'source');
  const instanceRoot = join(base, 'instance');
  await mkdir(sourceRoot);
  await mkdir(instanceRoot);
  await writeFile(join(sourceRoot, 'a.txt'), 'first');
  await writeFile(join(sourceRoot, 'b.txt'), 'second');
  const candidateFiles = [
    { path: 'a.txt', policy: 'always' as const },
    { path: 'b.txt', policy: 'initial-only' as const },
  ];
  const plan = () => testInstance.planTestInstance({ sourceRoot, instanceRoot, candidateFiles });
  return { base, sourceRoot, instanceRoot, candidateFiles, plan };
}
it('applies a verified plan and ledger while preserving modified and unowned files', async () => {
  const h = await setup();
  await applyTestInstance(h.instanceRoot, await h.plan(), new AbortController().signal);
  expect(await readFile(join(h.instanceRoot, 'a.txt'), 'utf8')).toBe('first');
  const ledger = testInstance.parseTestInstanceLedger(
    await readFile(join(h.instanceRoot, testInstance.TEST_INSTANCE_LEDGER_PATH), 'utf8'),
  );
  expect(ledger.files).toHaveLength(2);
  await writeFile(join(h.instanceRoot, 'a.txt'), 'personal');
  await writeFile(join(h.instanceRoot, 'b.txt'), 'personal-initial');
  await writeFile(join(h.sourceRoot, 'a.txt'), 'source-update');
  await applyTestInstance(h.instanceRoot, await h.plan(), new AbortController().signal);
  expect(await readFile(join(h.instanceRoot, 'a.txt'), 'utf8')).toBe('personal');
  expect(await readFile(join(h.instanceRoot, 'b.txt'), 'utf8')).toBe('personal-initial');
  expect(await readFile(join(h.sourceRoot, 'a.txt'), 'utf8')).toBe('source-update');
});

it('streams files larger than a copy buffer without truncating or repeating bytes', async () => {
  const h = await setup();
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await writeFile(join(h.sourceRoot, 'a.txt'), bytes);
  await applyTestInstance(h.instanceRoot, await h.plan(), new AbortController().signal);
  expect((await readFile(join(h.instanceRoot, 'a.txt'))).equals(bytes)).toBe(true);
});
it('rejects an oversized rollback journal before attempting source reads or publication', async () => {
  const h = await setup();
  const plan = await h.plan();
  const file = plan.copies[0];
  if (!file) throw new Error('Missing planned copy');
  plan.copies = Array.from({ length: 10000 }, (_, i) => ({
    ...file,
    path: `${i}-${'x'.repeat(1000)}`,
  }));
  await expect(
    applyTestInstance(h.instanceRoot, plan, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  await expect(
    readFile(join(h.instanceRoot, testInstance.TEST_INSTANCE_LEDGER_PATH)),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rolls back all published files and ledger on cancellation at an application boundary', async () => {
  const h = await setup();
  const controller = new AbortController();
  await expect(
    applyTestInstance(h.instanceRoot, await h.plan(), controller.signal, () => controller.abort()),
  ).rejects.toThrow();
  await expect(readFile(join(h.instanceRoot, 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(
    readFile(join(h.instanceRoot, testInstance.TEST_INSTANCE_LEDGER_PATH)),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await recoverTestInstance(h.instanceRoot);
  await applyTestInstance(h.instanceRoot, await h.plan(), new AbortController().signal);
});
it('restores replaced and removed owned files when a later operation fails', async () => {
  const h = await setup();
  h.candidateFiles[1] = { path: 'b.txt', policy: 'always' };
  await applyTestInstance(h.instanceRoot, await h.plan(), new AbortController().signal);
  const original = await readFile(
    join(h.instanceRoot, testInstance.TEST_INSTANCE_LEDGER_PATH),
    'utf8',
  );
  h.candidateFiles.pop();
  await writeFile(join(h.sourceRoot, 'a.txt'), 'updated');
  const controller = new AbortController();
  await expect(
    applyTestInstance(h.instanceRoot, await h.plan(), controller.signal, (count) => {
      if (count === 2) controller.abort();
    }),
  ).rejects.toThrow();
  expect(await readFile(join(h.instanceRoot, 'a.txt'), 'utf8')).toBe('first');
  expect(await readFile(join(h.instanceRoot, 'b.txt'), 'utf8')).toBe('second');
  expect(await readFile(join(h.instanceRoot, testInstance.TEST_INSTANCE_LEDGER_PATH), 'utf8')).toBe(
    original,
  );
});
it('rejects source or destination changes since planning and preserves other directories', async () => {
  const h = await setup();
  const plan = await h.plan();
  await writeFile(join(h.sourceRoot, 'a.txt'), 'changed-after-planning');
  await expect(
    applyTestInstance(h.instanceRoot, plan, new AbortController().signal),
  ).rejects.toThrow();
  expect(await readFile(join(h.sourceRoot, 'b.txt'), 'utf8')).toBe('second');
  const fresh = await h.plan();
  await writeFile(join(h.instanceRoot, 'a.txt'), 'unowned-race');
  await expect(
    applyTestInstance(h.instanceRoot, fresh, new AbortController().signal),
  ).rejects.toThrow();
  expect(await readFile(join(h.instanceRoot, 'a.txt'), 'utf8')).toBe('unowned-race');
});
it('fails closed on a corrupt interrupted journal without guessing ownership', async () => {
  const h = await setup();
  await mkdir(join(h.instanceRoot, '.torchlauncher-test/transaction'), { recursive: true });
  await writeFile(join(h.instanceRoot, '.torchlauncher-test/transaction/journal.json'), '{}');
  await expect(recoverTestInstance(h.instanceRoot)).rejects.toThrow();
  expect(await readFile(join(h.sourceRoot, 'a.txt'), 'utf8')).toBe('first');
});

it('recovers a persisted interrupted transaction in a fresh invocation without deleting local edits', async () => {
  const h = await setup();
  const plan = await h.plan();
  const directory = join(h.instanceRoot, '.torchlauncher-test/transaction');
  await mkdir(directory, { recursive: true });
  const file = plan.copies[0];
  if (!file) throw new Error('Missing planned copy');
  await writeFile(join(h.instanceRoot, file.path), 'first');
  await writeFile(
    join(directory, 'journal.json'),
    JSON.stringify({
      version: 1,
      phase: 'applying',
      previous: null,
      next: plan.nextLedger,
      operations: [
        {
          path: file.path,
          before: null,
          after: { sha256: file.after.sha256, length: file.after.length },
        },
      ],
    }),
  );
  await writeFile(join(h.instanceRoot, file.path), 'later-local-edit');
  await expect(recoverTestInstance(h.instanceRoot)).rejects.toThrow();
  expect(await readFile(join(h.instanceRoot, file.path), 'utf8')).toBe('later-local-edit');
  await writeFile(join(h.instanceRoot, file.path), 'first');
  await recoverTestInstance(h.instanceRoot);
  await expect(readFile(join(h.instanceRoot, file.path))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.skipIf(process.platform === 'win32')(
  'rejects a destination parent replaced by an external link',
  async () => {
    const h = await setup();
    await mkdir(join(h.sourceRoot, 'config'));
    await writeFile(join(h.sourceRoot, 'config/a.properties'), 'a=true');
    const plan = await testInstance.planTestInstance({
      sourceRoot: h.sourceRoot,
      instanceRoot: h.instanceRoot,
      candidateFiles: [{ path: 'config/a.properties', policy: 'always' }],
    });
    await symlink(h.sourceRoot, join(h.instanceRoot, 'config'));
    await expect(
      applyTestInstance(h.instanceRoot, plan, new AbortController().signal),
    ).rejects.toThrow();
    expect(await readFile(join(h.sourceRoot, 'config/a.properties'), 'utf8')).toBe('a=true');
  },
);
