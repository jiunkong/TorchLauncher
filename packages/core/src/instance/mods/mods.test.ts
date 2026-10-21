import { link, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import { SynchronizationError } from '../sync/types.js';
import {
  cleanTemporary,
  deploy,
  fabricJar,
  neoForgeJar,
  serverId,
  temporary,
  zip,
} from './fixtures.js';
import {
  adoptUnregistered,
  listMods,
  recoverUserMods,
  registerUserMod,
  removeUnregistered,
  removeUserMod,
  UserModError,
} from './index.js';
import { clearIntent, userPaths, writeIntent } from './registry.js';

afterEach(cleanTemporary);

async function setup() {
  const root = await temporary('torch-mods-root-');
  const inbox = await temporary('torch-mods-inbox-');
  const base = { root, serverId };
  const jar = async (name: string, bytes: Buffer) => {
    const path = join(inbox, name);
    await writeFile(path, bytes);
    return path;
  };
  return { root, inbox, base, jar };
}
const read = (root: string, path: string) => readFile(join(root, path));
const dep = (n: number) => `2222222${n}-2222-4222-8222-222222222222`;

describe('register / remove / list', () => {
  it('copies a jar into mods, records it, and removes only that file', async () => {
    const { root, base, jar } = await setup();
    const bytes = fabricJar('usermod');
    const progress: string[] = [];
    const result = await registerUserMod({
      ...base,
      sourcePath: await jar('usermod.jar', bytes),
      onProgress: (p) => void progress.push(p.phase),
    });
    expect(result).toMatchObject({
      copied: true,
      warnings: [],
      mod: { path: 'mods/usermod.jar', modIds: ['usermod'] },
    });
    expect(await read(root, 'mods/usermod.jar')).toEqual(bytes);
    expect(progress).toContain('copying');
    expect(await readdir(userPaths(root).tmp)).toEqual([]);

    await writeFile(join(root, 'mods/other.jar'), 'keep me');
    const listing = await listMods(base);
    expect(listing.recoveryRequired).toBe(false);
    expect(listing.entries.map((e) => [e.path, e.source, e.state])).toEqual([
      ['mods/other.jar', 'unregistered', 'ok'],
      ['mods/usermod.jar', 'user', 'ok'],
    ]);

    expect(await removeUserMod({ ...base, path: 'mods/usermod.jar' })).toEqual({
      path: 'mods/usermod.jar',
      fileDeleted: true,
    });
    await expect(read(root, 'mods/usermod.jar')).rejects.toThrow();
    expect(await read(root, 'mods/other.jar')).toEqual(Buffer.from('keep me'));
    await expect(removeUserMod({ ...base, path: 'mods/usermod.jar' })).rejects.toMatchObject({
      code: 'not-registered',
    });
  });

  it('allows registration with a warning when the id cannot be read', async () => {
    const { base, jar } = await setup();
    const result = await registerUserMod({
      ...base,
      sourcePath: await jar('plain.jar', zip([{ name: 'a', data: 'b' }])),
    });
    expect(result.warnings).toEqual(['mod-id-unavailable']);
    expect(result.mod.modIds).toEqual([]);
  });

  it('rejects non-jar, missing, symlinked, oversized-structure and corrupt sources without touching mods', async () => {
    const { root, base, jar, inbox } = await setup();
    await expect(
      registerUserMod({ ...base, sourcePath: await jar('a.zip', fabricJar('a')) }),
    ).rejects.toMatchObject({ code: 'invalid-extension' });
    await expect(
      registerUserMod({ ...base, sourcePath: join(inbox, 'missing.jar') }),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    const real = await jar('real.jar', fabricJar('real'));
    await symlink(real, join(inbox, 'link.jar')).catch(() => undefined);
    await expect(
      registerUserMod({ ...base, sourcePath: join(inbox, 'link.jar') }),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    await expect(
      registerUserMod({
        ...base,
        sourcePath: await jar('bad.jar', Buffer.from('not a zip at all, sorry!!')),
      }),
    ).rejects.toMatchObject({ code: 'invalid-jar' });
    await expect(
      registerUserMod({ ...base, serverId: 'nope', sourcePath: real }),
    ).rejects.toMatchObject({ code: 'invalid-server-id' });
    expect(await readdir(join(root, 'mods')).catch(() => [])).toEqual([]);
    expect(await readdir(userPaths(root).tmp)).toEqual([]);
  });

  it('refuses duplicate registration, mod-id conflicts and different existing files', async () => {
    const { root, base, jar } = await setup();
    const first = await jar('a.jar', fabricJar('shared'));
    await registerUserMod({ ...base, sourcePath: first });
    await expect(registerUserMod({ ...base, sourcePath: first })).rejects.toMatchObject({
      code: 'already-registered',
    });
    const clash = await jar('b.jar', neoForgeJar('shared'));
    await expect(registerUserMod({ ...base, sourcePath: clash })).rejects.toMatchObject({
      code: 'mod-id-conflict',
      detail: { conflictsWith: ['mods/a.jar'] },
    });
    await expect(read(root, 'mods/b.jar')).rejects.toThrow();
    // A different unregistered file at the target path is never overwritten.
    await writeFile(join(root, 'mods/c.jar'), 'someone else');
    await expect(
      registerUserMod({ ...base, sourcePath: await jar('c.jar', fabricJar('c')) }),
    ).rejects.toMatchObject({ code: 'path-conflict' });
    expect(await read(root, 'mods/c.jar')).toEqual(Buffer.from('someone else'));
    // An identical unregistered file is registered in place.
    const same = fabricJar('d');
    await writeFile(join(root, 'mods/d.jar'), same);
    expect(await registerUserMod({ ...base, sourcePath: await jar('d.jar', same) })).toMatchObject({
      copied: false,
    });
  });

  it('detects case-insensitive path collisions', async () => {
    const { root, base, jar } = await setup();
    await writeFile(join(root, 'mods', 'x.jar'), 'x').catch(async () => {
      await mkdir(join(root, 'mods'));
      await writeFile(join(root, 'mods', 'x.jar'), 'x');
    });
    await expect(
      registerUserMod({ ...base, sourcePath: await jar('X.jar', fabricJar('x')) }),
    ).rejects.toMatchObject({ code: 'path-conflict' });
  });

  it('refuses a symlinked mods directory and hard-linked targets', async () => {
    const { root, base, jar } = await setup();
    const outside = await temporary('torch-mods-outside-');
    await symlink(outside, join(root, 'mods'), 'dir').catch(() => undefined);
    const source = await jar('s.jar', fabricJar('s'));
    await expect(registerUserMod({ ...base, sourcePath: source })).rejects.toBeInstanceOf(
      UserModError,
    );
    expect(await readdir(outside)).toEqual([]);
    await rm(join(root, 'mods'), { force: true, recursive: true });
    await mkdir(join(root, 'mods'));
    await writeFile(join(outside, 'h.jar'), fabricJar('s'));
    await link(join(outside, 'h.jar'), join(root, 'mods/s.jar'));
    await expect(registerUserMod({ ...base, sourcePath: source })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
  });

  it('refuses to delete a modified file unless forced, and handles a missing file', async () => {
    const { root, base, jar } = await setup();
    await registerUserMod({ ...base, sourcePath: await jar('m.jar', fabricJar('m')) });
    await writeFile(join(root, 'mods/m.jar'), 'edited by user');
    expect((await listMods(base)).entries[0]).toMatchObject({ state: 'modified' });
    await expect(removeUserMod({ ...base, path: 'mods/m.jar' })).rejects.toMatchObject({
      code: 'local-changed',
    });
    expect(await read(root, 'mods/m.jar')).toEqual(Buffer.from('edited by user'));
    await removeUserMod({ ...base, path: 'mods/m.jar', force: true });
    await registerUserMod({ ...base, sourcePath: await jar('n.jar', fabricJar('n')) });
    await rm(join(root, 'mods/n.jar'));
    expect((await listMods(base)).entries[0]).toMatchObject({ source: 'user', state: 'missing' });
    expect(await removeUserMod({ ...base, path: 'mods/n.jar' })).toMatchObject({
      fileDeleted: false,
    });
  });

  it('rejects traversal and non-mods paths for remove/adopt', async () => {
    const { base } = await setup();
    for (const path of [
      '../x.jar',
      'mods/../x.jar',
      '/etc/passwd',
      'config/x.jar',
      'mods',
      '.torchlauncher-user/mods.json',
    ])
      await expect(removeUserMod({ ...base, path })).rejects.toMatchObject({
        code: 'invalid-path',
      });
    await expect(adoptUnregistered({ ...base, path: '../x.jar' })).rejects.toMatchObject({
      code: 'invalid-path',
    });
    await expect(removeUnregistered({ ...base, path: 'mods/../../x' })).rejects.toMatchObject({
      code: 'invalid-path',
    });
  });

  it('honours abort before copying completes and leaves nothing behind', async () => {
    const { root, base, jar } = await setup();
    const controller = new AbortController();
    await expect(
      registerUserMod({
        ...base,
        sourcePath: await jar('z.jar', fabricJar('z', {}, 'x'.repeat(600_000))),
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'copying') controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(join(root, 'mods')).catch(() => [])).toEqual([]);
    expect(await readdir(userPaths(root).tmp)).toEqual([]);
    expect((await listMods(base)).entries).toEqual([]);
  });
});

describe('unregistered files', () => {
  it('lists, adopts and deletes only on explicit request', async () => {
    const { root, base } = await setup();
    await mkdir(join(root, 'mods/sub'), { recursive: true });
    await writeFile(join(root, 'mods/lib.jar'), fabricJar('lib'));
    await writeFile(join(root, 'mods/sub/deep.jar'), fabricJar('deep'));
    await writeFile(join(root, 'mods/readme.txt'), 'hello');
    let listing = await listMods(base);
    expect(listing.entries.every((e) => e.source === 'unregistered')).toBe(true);
    expect(listing.entries).toHaveLength(3);

    expect(await adoptUnregistered({ ...base, path: 'mods/lib.jar' })).toMatchObject({
      mod: { modIds: ['lib'] },
    });
    await expect(adoptUnregistered({ ...base, path: 'mods/lib.jar' })).rejects.toMatchObject({
      code: 'already-registered',
    });
    await expect(adoptUnregistered({ ...base, path: 'mods/readme.txt' })).rejects.toMatchObject({
      code: 'invalid-extension',
    });
    await expect(adoptUnregistered({ ...base, path: 'mods/nothing.jar' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(removeUnregistered({ ...base, path: 'mods/lib.jar' })).rejects.toMatchObject({
      code: 'not-unregistered',
    });
    await expect(
      removeUnregistered({ ...base, path: 'mods/readme.txt', expectedSha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'local-changed' });
    expect(await removeUnregistered({ ...base, path: 'mods/readme.txt' })).toMatchObject({
      fileDeleted: true,
    });
    listing = await listMods(base);
    expect(listing.entries.map((e) => [e.path, e.source])).toEqual([
      ['mods/lib.jar', 'user'],
      ['mods/sub/deep.jar', 'unregistered'],
    ]);
    expect(await read(root, 'mods/sub/deep.jar')).toEqual(fabricJar('deep'));
  });

  it('refuses to adopt a jar whose mod id is already owned', async () => {
    const { root, base, jar } = await setup();
    await registerUserMod({ ...base, sourcePath: await jar('one.jar', fabricJar('dup')) });
    await writeFile(join(root, 'mods/two.jar'), fabricJar('dup', {}, 'other'));
    await expect(adoptUnregistered({ ...base, path: 'mods/two.jar' })).rejects.toMatchObject({
      code: 'mod-id-conflict',
    });
    expect(await read(root, 'mods/two.jar')).toEqual(fabricJar('dup', {}, 'other'));
  });
});

describe('locking', () => {
  it('rejects every mutation while the data lock is held, but lists freely', async () => {
    const { root, base, jar } = await setup();
    const source = await jar('l.jar', fabricJar('l'));
    const lease = await acquireServerDataLock(root, 'game');
    try {
      await expect(registerUserMod({ ...base, sourcePath: source })).rejects.toMatchObject({
        code: 'locked',
      });
      await expect(removeUserMod({ ...base, path: 'mods/l.jar' })).rejects.toMatchObject({
        code: 'locked',
      });
      await expect(adoptUnregistered({ ...base, path: 'mods/l.jar' })).rejects.toMatchObject({
        code: 'locked',
      });
      await expect(removeUnregistered({ ...base, path: 'mods/l.jar' })).rejects.toMatchObject({
        code: 'locked',
      });
      await expect(recoverUserMods(base)).rejects.toMatchObject({ code: 'locked' });
      expect((await listMods(base)).entries).toEqual([]);
    } finally {
      await lease.release();
    }
    await registerUserMod({ ...base, sourcePath: source });
    expect(await readdir(root)).not.toContain('.torchlauncher-server-lock');
  });
});

describe('registry hardening', () => {
  const file = (root: string) => userPaths(root).registry;
  const entry = (path: string, ids: string[] = []) => ({
    path,
    sha256: 'a'.repeat(64),
    length: 1,
    modIds: ids,
    addedAt: '2026-01-01T00:00:00.000Z',
  });
  const write = async (root: string, text: string) => {
    await mkdir(userPaths(root).dir, { recursive: true });
    await writeFile(file(root), text);
  };

  it.each([
    ['malformed json', '{"version":1,'],
    ['duplicate keys', `{"version":1,"serverId":"${serverId}","mods":[],"mods":[]}`],
    [
      'wrong server',
      JSON.stringify({ version: 1, serverId: '33333333-3333-4333-8333-333333333333', mods: [] }),
    ],
    ['extra field', JSON.stringify({ version: 1, serverId, mods: [], extra: 1 })],
    ['traversal path', JSON.stringify({ version: 1, serverId, mods: [entry('mods/../x.jar')] })],
    ['non-mods path', JSON.stringify({ version: 1, serverId, mods: [entry('config/x.jar')] })],
    [
      'duplicate paths',
      JSON.stringify({ version: 1, serverId, mods: [entry('mods/a.jar'), entry('mods/A.jar')] }),
    ],
    [
      'duplicate mod ids',
      JSON.stringify({
        version: 1,
        serverId,
        mods: [entry('mods/a.jar', ['x']), entry('mods/b.jar', ['x'])],
      }),
    ],
    [
      'bad hash',
      JSON.stringify({ version: 1, serverId, mods: [{ ...entry('mods/a.jar'), sha256: 'zz' }] }),
    ],
  ])('treats %s as invalid-state and does not modify anything', async (_n, text) => {
    const { root, base, jar } = await setup();
    await write(root, text);
    await expect(listMods(base)).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(
      registerUserMod({ ...base, sourcePath: await jar('q.jar', fabricJar('q')) }),
    ).rejects.toMatchObject({ code: 'invalid-state' });
    expect(await readFile(file(root), 'utf8')).toBe(text);
    await expect(read(root, 'mods/q.jar')).rejects.toThrow();
  });

  it('rejects an oversized registry', async () => {
    const { root, base } = await setup();
    await write(root, ' '.repeat(3 * 1024 ** 2));
    await expect(listMods(base)).rejects.toMatchObject({ code: 'invalid-state' });
  });
});

describe('interrupted operations', () => {
  it('completes an interrupted registration (file placed, registry missing)', async () => {
    const { root, base, jar } = await setup();
    await registerUserMod({ ...base, sourcePath: await jar('keep.jar', fabricJar('keep')) });
    const bytes = fabricJar('half');
    await writeFile(join(root, 'mods/half.jar'), bytes);
    const { createHash } = await import('node:crypto');
    await writeIntent(root, {
      version: 1,
      op: 'register',
      entry: {
        path: 'mods/half.jar',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        length: bytes.length,
        modIds: ['half'],
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await mkdir(userPaths(root).tmp, { recursive: true });
    await writeFile(join(userPaths(root).tmp, 'stale.jar'), 'partial');
    expect((await listMods(base)).recoveryRequired).toBe(true);
    expect(await recoverUserMods(base)).toEqual({ outcome: 'registered', temporaryRemoved: 1 });
    const listing = await listMods(base);
    expect(listing.recoveryRequired).toBe(false);
    expect(listing.entries.map((e) => [e.path, e.source])).toEqual([
      ['mods/half.jar', 'user'],
      ['mods/keep.jar', 'user'],
    ]);
    expect(await recoverUserMods(base)).toEqual({ outcome: 'none', temporaryRemoved: 0 });
  });

  it('discards an interrupted registration whose file never arrived or differs', async () => {
    const { root, base } = await setup();
    await mkdir(join(root, 'mods'));
    await writeFile(join(root, 'mods/foreign.jar'), 'foreign');
    const entry = {
      path: 'mods/foreign.jar',
      sha256: 'b'.repeat(64),
      length: 7,
      modIds: [],
      addedAt: 'x',
    };
    await writeIntent(root, { version: 1, op: 'register', entry });
    expect((await recoverUserMods(base)).outcome).toBe('discarded');
    expect(await read(root, 'mods/foreign.jar')).toEqual(Buffer.from('foreign'));
    expect((await listMods(base)).entries[0]).toMatchObject({ source: 'unregistered' });
  });

  it('completes an interrupted removal on the next mutation and keeps changed files', async () => {
    const { root, base, jar } = await setup();
    const reg = await registerUserMod({
      ...base,
      sourcePath: await jar('gone.jar', fabricJar('gone')),
    });
    await writeIntent(root, { version: 1, op: 'remove', entry: reg.mod });
    // Next mutating call repairs first.
    await registerUserMod({ ...base, sourcePath: await jar('next.jar', fabricJar('next')) });
    await expect(read(root, 'mods/gone.jar')).rejects.toThrow();
    expect((await listMods(base)).entries.map((e) => e.path)).toEqual(['mods/next.jar']);

    const second = await registerUserMod({
      ...base,
      sourcePath: await jar('edited.jar', fabricJar('edited')),
    });
    await writeFile(join(root, 'mods/edited.jar'), 'user edited');
    await writeIntent(root, { version: 1, op: 'remove', entry: second.mod });
    expect((await recoverUserMods(base)).outcome).toBe('removed');
    expect(await read(root, 'mods/edited.jar')).toEqual(Buffer.from('user edited'));
    expect((await listMods(base)).entries.find((e) => e.path === 'mods/edited.jar')?.source).toBe(
      'unregistered',
    );
    await clearIntent(root);
  });
});

describe('integration with synchronizeDeployment', () => {
  it('preserves user mods across server updates and reports operator path collisions', async () => {
    const { root, base, jar } = await setup();
    await deploy(
      root,
      [
        { path: 'mods/operator.jar', data: fabricJar('operatormod') },
        { path: 'config/a.txt', data: '1' },
      ],
      dep(1),
    );
    const bytes = fabricJar('usermod');
    await registerUserMod({ ...base, sourcePath: await jar('user.jar', bytes) });
    await writeFile(join(root, 'mods/stray.jar'), 'stray');

    // Operator ids are visible to registration.
    await expect(
      registerUserMod({
        ...base,
        sourcePath: await jar('op2.jar', fabricJar('operatormod', {}, 'v2')),
      }),
    ).rejects.toMatchObject({ code: 'mod-id-conflict' });
    await expect(
      registerUserMod({ ...base, sourcePath: await jar('operator.jar', fabricJar('different')) }),
    ).rejects.toMatchObject({ code: 'path-conflict' });

    // Server update: operator mod replaced and one removed.
    await deploy(
      root,
      [
        { path: 'mods/operator.jar', data: fabricJar('operatormod', {}, 'v2') },
        { path: 'mods/extra.jar', data: fabricJar('extra') },
      ],
      dep(2),
    );
    expect(await read(root, 'mods/user.jar')).toEqual(bytes);
    expect(await read(root, 'mods/stray.jar')).toEqual(Buffer.from('stray'));
    let entries = (await listMods(base)).entries;
    expect(entries.map((e) => [e.path, e.source, e.state])).toEqual([
      ['mods/extra.jar', 'operator', 'ok'],
      ['mods/operator.jar', 'operator', 'ok'],
      ['mods/stray.jar', 'unregistered', 'ok'],
      ['mods/user.jar', 'user', 'ok'],
    ]);

    // Operator now ships a file at the user's path: sync reports a conflict and nothing is overwritten.
    const conflict = deploy(root, [{ path: 'mods/user.jar', data: 'operator version' }], dep(3));
    await expect(conflict).rejects.toBeInstanceOf(SynchronizationError);
    await expect(conflict).rejects.toMatchObject({ code: 'conflict' });
    expect(await read(root, 'mods/user.jar')).toEqual(bytes);
    entries = (await listMods(base)).entries;
    expect(entries.find((e) => e.path === 'mods/user.jar')).toMatchObject({
      source: 'user',
      state: 'ok',
      conflicts: [],
    });
    expect(entries.find((e) => e.path === 'mods/operator.jar')?.source).toBe('operator');
  });

  it('flags a user entry that shares a path with the operator ledger and never deletes it', async () => {
    const { root, base, jar } = await setup();
    await deploy(root, [{ path: 'config/a.txt', data: '1' }], dep(1));
    await registerUserMod({ ...base, sourcePath: await jar('shared.jar', fabricJar('shared')) });
    // Simulate the ledger claiming the path (e.g. restored/older client state).
    const { writeFile: wf, readFile: rf } = await import('node:fs/promises');
    const ledgerPath = join(root, '.torchlauncher-sync/ledger.json');
    const ledger = JSON.parse(await rf(ledgerPath, 'utf8'));
    const own = fabricJar('shared');
    const { createHash } = await import('node:crypto');
    ledger.files.push({
      path: 'mods/shared.jar',
      policy: 'always',
      sha256: createHash('sha256').update(own).digest('hex'),
      length: own.length,
    });
    await wf(ledgerPath, JSON.stringify(ledger));
    const entry = (await listMods(base)).entries.find(
      (e) => e.path === 'mods/shared.jar' && e.source === 'user',
    );
    expect(entry).toMatchObject({
      source: 'user',
      conflicts: [{ kind: 'path', with: 'mods/shared.jar' }],
    });
    expect(await removeUserMod({ ...base, path: 'mods/shared.jar' })).toMatchObject({
      fileDeleted: false,
    });
    expect(await read(root, 'mods/shared.jar')).toEqual(own);
  });
});
