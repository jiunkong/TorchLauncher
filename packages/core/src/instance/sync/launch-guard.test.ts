import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeploymentReader } from '../../deployment/reader/index.js';
import { assertSynchronizedForLaunch } from './launch-guard';

const roots: string[] = [];
const serverId = '11111111-1111-4111-8111-111111111111';
const deploymentId = '22222222-2222-4222-8222-222222222222';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'torch-launch-guard-'));
  roots.push(root);
  await mkdir(join(root, '.torchlauncher-sync'));
  const hash = createHash('sha256').update('required').digest('hex');
  const files = [
    { path: 'required.txt', policy: 'always' as const, sha256: hash, length: 8 },
    { path: 'options.txt', policy: 'initial-only' as const, sha256: hash, length: 8 },
  ];
  await writeFile(join(root, 'required.txt'), 'required');
  await writeFile(join(root, 'options.txt'), 'personal');
  const ledger = { version: 1, serverId, deploymentId, initialized: true, files };
  await writeFile(join(root, '.torchlauncher-sync/ledger.json'), JSON.stringify(ledger));
  const reader = {
    index: {
      serverId,
      deploymentId,
      files: files.map(({ length, ...file }) => ({ ...file, originalLength: length })),
    },
    assertCurrent: vi.fn(),
  } as unknown as DeploymentReader;
  return { root, reader, ledger };
}
it('accepts required hashes and leaves personal settings and all state unchanged', async () => {
  const data = await fixture();
  const before = await readFile(join(data.root, '.torchlauncher-sync/ledger.json'));
  await assertSynchronizedForLaunch({ ...data, expectedServerId: serverId });
  expect(await readFile(join(data.root, 'options.txt'), 'utf8')).toBe('personal');
  expect(await readFile(join(data.root, '.torchlauncher-sync/ledger.json'))).toEqual(before);
});
it('rejects modified required files', async () => {
  const data = await fixture();
  await writeFile(join(data.root, 'required.txt'), 'changed!');
  await expect(
    assertSynchronizedForLaunch({ ...data, expectedServerId: serverId }),
  ).rejects.toThrow('local-changed');
});
it.each(['journal.json', 'journal.pending', 'transaction'])(
  'rejects unresolved state %s',
  async (name) => {
    const data = await fixture();
    await writeFile(join(data.root, '.torchlauncher-sync', name), 'pending');
    await expect(
      assertSynchronizedForLaunch({ ...data, expectedServerId: serverId }),
    ).rejects.toThrow('recovery-required');
  },
);
it('rejects ledger identity mismatch and cancellation', async () => {
  const data = await fixture();
  await writeFile(
    join(data.root, '.torchlauncher-sync/ledger.json'),
    JSON.stringify({ ...data.ledger, deploymentId: serverId }),
  );
  await expect(
    assertSynchronizedForLaunch({ ...data, expectedServerId: serverId }),
  ).rejects.toThrow('local-changed');
  await expect(
    assertSynchronizedForLaunch({
      ...data,
      expectedServerId: serverId,
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
});
