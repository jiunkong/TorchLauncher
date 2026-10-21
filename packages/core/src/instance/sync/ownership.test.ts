import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanTemporary, deploy, serverId, temporary } from '../mods/fixtures.js';
import { readSyncOwnership } from './ownership.js';

afterEach(cleanTemporary);
const first = '22222222-2222-4222-8222-222222222222';

describe('readSyncOwnership', () => {
  it('returns null before any deployment and for a missing sync directory', async () => {
    const root = await temporary();
    expect(await readSyncOwnership(root, serverId)).toBeNull();
    await mkdir(join(root, '.torchlauncher-sync'));
    expect(await readSyncOwnership(root, serverId)).toBeNull();
  });

  it('reports the ledger written by a real synchronization', async () => {
    const root = await temporary();
    await deploy(
      root,
      [
        { path: 'mods/a.jar', data: 'a' },
        { path: 'config/x.toml', data: 'x', policy: 'initial-only' },
      ],
      first,
    );
    const owned = await readSyncOwnership(root, serverId);
    expect(owned).toMatchObject({ serverId, deploymentId: first, initialized: true });
    expect(owned?.files.map((f) => [f.path, f.policy, f.length]).sort()).toEqual([
      ['config/x.toml', 'initial-only', 1],
      ['mods/a.jar', 'always', 1],
    ]);
    expect(owned?.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects corrupt ledgers, other servers and interrupted transactions', async () => {
    const root = await temporary();
    await deploy(root, [{ path: 'mods/a.jar', data: 'a' }], first);
    await expect(
      readSyncOwnership(root, '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'server-mismatch' });
    await expect(readSyncOwnership(root, 'nope')).rejects.toMatchObject({ code: 'invalid-state' });
    await writeFile(join(root, '.torchlauncher-sync', 'journal.json'), '{}');
    await expect(readSyncOwnership(root, serverId)).rejects.toMatchObject({
      code: 'recovery-required',
    });
    await rm(join(root, '.torchlauncher-sync', 'journal.json'));
    await writeFile(join(root, '.torchlauncher-sync', 'ledger.json'), '{"broken":');
    await expect(readSyncOwnership(root, serverId)).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });
});
