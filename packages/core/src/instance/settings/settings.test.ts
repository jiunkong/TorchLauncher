import {
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
import { afterEach, describe, expect, it } from 'vitest';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import {
  applySettingsPolicy,
  classifySettingsPath,
  describeManagedFiles,
  getResourcePacks,
  parseSettingsPolicy,
  SETTINGS_LIMITS,
  SettingsError,
  type SyncOwnership,
  setUserResourcePacks,
} from './index.js';
import { mergeRequiredPacks } from './options.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function root(): Promise<string> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'torch-settings-'));
  roots.push(dir);
  return dir;
}
async function policy(dir: string, value: unknown | string): Promise<void> {
  await mkdir(join(dir, 'torchlauncher'), { recursive: true });
  await writeFile(
    join(dir, 'torchlauncher/settings-policy.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}
const base = { version: 1, file: 'options.txt' };
const text = (dir: string) => readFile(join(dir, 'options.txt'), 'utf8');
const ownership = (files: SyncOwnership['files'], initialized = true): SyncOwnership => ({
  serverId: 's',
  deploymentId: 'd',
  initialized,
  files,
});
const hash = 'a'.repeat(64);
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SettingsError) return error.code;
    throw error;
  }
  return 'none';
}

describe('required and initial keys', () => {
  it('enforces required keys while preserving unknown keys, order and CRLF', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { renderDistance: '12' } });
    await writeFile(join(dir, 'options.txt'), 'fov:0.5\r\n# note\r\nrenderDistance:4\r\nzzz:1\r\n');
    const result = await applySettingsPolicy(dir);
    expect(result.enforcedKeys).toEqual(['renderDistance']);
    expect(await text(dir)).toBe('fov:0.5\r\n# note\r\nrenderDistance:12\r\nzzz:1\r\n');
    const again = await applySettingsPolicy(dir);
    expect(again.status).toBe('unchanged');
    expect(again.optionsChanged).toBe(false);
  });

  it('appends missing keys using the file line ending and keeps a missing final newline sane', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    await writeFile(join(dir, 'options.txt'), 'x:1\r\ny:2');
    await applySettingsPolicy(dir);
    expect(await text(dir)).toBe('x:1\r\ny:2\r\na:1\r\n');
  });

  it('creates a minimal options.txt when missing', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' }, initial: { b: '2' } });
    const result = await applySettingsPolicy(dir);
    expect(result.optionsCreated).toBe(true);
    expect(await text(dir)).toBe('a:1\nb:2\n');
  });

  it('applies initial keys once and never restores user changes or deletions', async () => {
    const dir = await root();
    await policy(dir, { ...base, initial: { musicVolume: '0.2', gamma: '1.0' } });
    await writeFile(join(dir, 'options.txt'), 'gamma:0.3\n');
    const first = await applySettingsPolicy(dir);
    expect(first.initialApplied).toEqual(['musicVolume']);
    expect(first.initialSkipped).toEqual([{ key: 'gamma', reason: 'user-value-present' }]);
    await writeFile(join(dir, 'options.txt'), 'gamma:0.9\n');
    const second = await applySettingsPolicy(dir);
    expect(second.initialApplied).toEqual([]);
    expect(second.initialSkipped).toEqual([]);
    expect(await text(dir)).toBe('gamma:0.9\n');
    expect(
      JSON.parse(await readFile(join(dir, '.torchlauncher-user/settings.json'), 'utf8')),
    ).toEqual({
      version: 1,
      initial: { keys: ['gamma', 'musicVolume'], resourcePacks: false },
    });
  });

  it('reports initial-skipped for keys added after the first configuration', async () => {
    const dir = await root();
    await policy(dir, { ...base, initial: { a: '1' } });
    await applySettingsPolicy(dir);
    await policy(dir, { ...base, initial: { a: '1', b: '2' } });
    const result = await applySettingsPolicy(dir);
    expect(result.initialSkipped).toEqual([{ key: 'b', reason: 'already-configured' }]);
    expect(await text(dir)).toBe('a:1\n');
  });

  it('returns no-policy without touching anything', async () => {
    const dir = await root();
    expect((await applySettingsPolicy(dir)).status).toBe('no-policy');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('resource packs', () => {
  it('merges required packs preserving slots and user packs', () => {
    expect(mergeRequiredPacks(['vanilla', 'u1', 'u2'], ['r1', 'r2']).packs).toEqual([
      'vanilla',
      'u1',
      'u2',
      'r1',
      'r2',
    ]);
    expect(mergeRequiredPacks(['r2', 'u1', 'r1'], ['r1', 'r2'])).toMatchObject({
      packs: ['r1', 'u1', 'r2'],
      reordered: true,
    });
    expect(mergeRequiredPacks(['r1', 'u1', 'u2'], ['r1', 'r2']).packs).toEqual([
      'r1',
      'r2',
      'u1',
      'u2',
    ]);
  });

  it('sets the initial list once, restores required packs and keeps user packs', async () => {
    const dir = await root();
    await policy(dir, {
      ...base,
      resourcePacks: { required: ['file/req.zip'], initial: ['vanilla', 'file/def.zip'] },
    });
    await applySettingsPolicy(dir);
    expect(await text(dir)).toBe('resourcePacks:["vanilla","file/def.zip","file/req.zip"]\n');
    await writeFile(join(dir, 'options.txt'), 'resourcePacks:["vanilla","file/mine.zip"]\nfov:1\n');
    const result = await applySettingsPolicy(dir);
    expect(result.resourcePacks.added).toEqual(['file/req.zip']);
    expect(await text(dir)).toBe(
      'resourcePacks:["vanilla","file/mine.zip","file/req.zip"]\nfov:1\n',
    );
    const list = await getResourcePacks(dir);
    expect(list.packs).toEqual([
      { id: 'vanilla', required: false },
      { id: 'file/mine.zip', required: false },
      { id: 'file/req.zip', required: true },
    ]);
  });

  it('reports a disabled required pack and rejects removing or reordering it', async () => {
    const dir = await root();
    await policy(dir, { ...base, resourcePacks: { required: ['a', 'b'] } });
    await writeFile(join(dir, 'options.txt'), 'resourcePacks:["b","x","a"]\n');
    expect((await getResourcePacks(dir)).requiredOutOfOrder).toBe(true);
    expect(await code(setUserResourcePacks(dir, ['a', 'x']))).toBe('required-pack-removed');
    expect(await code(setUserResourcePacks(dir, ['b', 'a']))).toBe('required-pack-reordered');
    expect(await code(setUserResourcePacks(dir, ['a', 'a', 'b']))).toBe('invalid-argument');
    expect(await text(dir)).toBe('resourcePacks:["b","x","a"]\n');
    await applySettingsPolicy(dir);
    expect(await text(dir)).toBe('resourcePacks:["a","x","b"]\n');
    const set = await setUserResourcePacks(dir, ['u', 'a', 'b', 'v']);
    expect(set.changed).toBe(true);
    expect(await text(dir)).toBe('resourcePacks:["u","a","b","v"]\n');
  });
});

describe('invalid input', () => {
  const bad: [string, string | object][] = [
    ['corrupt JSON', '{"version":'],
    ['duplicate key', '{"version":1,"file":"options.txt","required":{"a":"1","a":"2"}}'],
    ['unknown field', { ...base, extra: 1 }],
    ['wrong file', { version: 1, file: 'servers.dat' }],
    ['wrong version', { version: 2, file: 'options.txt' }],
    ['key conflict', { ...base, required: { a: '1' }, initial: { a: '2' } }],
    ['newline in value', { ...base, required: { a: '1\nb:2' } }],
    ['resourcePacks as key', { ...base, required: { resourcePacks: '[]' } }],
    ['duplicate pack', { ...base, resourcePacks: { required: ['a', 'a'] } }],
    ['unknown pack field', { ...base, resourcePacks: { other: [] } }],
  ];
  it.each(bad)('rejects policy: %s', async (_name, value) => {
    const dir = await root();
    await policy(dir, value);
    expect(await code(applySettingsPolicy(dir))).toBe('invalid-policy');
    expect(await readdir(dir)).toEqual(['torchlauncher']);
  });

  it('rejects oversized policy and options', async () => {
    const dir = await root();
    await policy(dir, ' '.repeat(SETTINGS_LIMITS.policyBytes + 1));
    expect(await code(applySettingsPolicy(dir))).toBe('limit-exceeded');
    await policy(dir, { ...base, required: { a: '1' } });
    await writeFile(join(dir, 'options.txt'), 'a:'.padEnd(SETTINGS_LIMITS.optionsBytes + 1, 'x'));
    expect(await code(applySettingsPolicy(dir))).toBe('limit-exceeded');
    expect(() => parseSettingsPolicy(new Uint8Array(SETTINGS_LIMITS.policyBytes + 1))).toThrow();
  });

  it('rejects duplicate keys, invalid UTF-8 and bad resourcePacks in options.txt untouched', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    for (const content of [
      Buffer.from('a:1\na:2\n'),
      Buffer.from([0xff, 0xfe, 0x3a]),
      Buffer.from('resourcePacks:oops\n'),
    ]) {
      await writeFile(join(dir, 'options.txt'), content);
      expect(await code(applySettingsPolicy(dir))).toBe('invalid-options');
      expect(await readFile(join(dir, 'options.txt'))).toEqual(content);
    }
  });

  it('rejects corrupt state and linked options.txt', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    await mkdir(join(dir, '.torchlauncher-user'));
    await writeFile(join(dir, '.torchlauncher-user/settings.json'), '{"version":1,"x":1}');
    expect(await code(applySettingsPolicy(dir))).toBe('invalid-state');
    await rm(join(dir, '.torchlauncher-user'), { recursive: true });
    await writeFile(join(dir, 'real.txt'), 'a:0\n');
    await symlink(join(dir, 'real.txt'), join(dir, 'options.txt'));
    expect(await code(applySettingsPolicy(dir))).toBe('unsafe-path');
    expect(await readFile(join(dir, 'real.txt'), 'utf8')).toBe('a:0\n');
  });
});

describe('locking and atomicity', () => {
  it('refuses while the server data is locked', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    const lease = await acquireServerDataLock(dir, 'game');
    expect(await code(applySettingsPolicy(dir))).toBe('locked');
    expect(await code(setUserResourcePacks(dir, ['vanilla']))).toBe('locked');
    await lease.release();
    expect((await applySettingsPolicy(dir)).status).toBe('applied');
  });

  it('keeps the existing file and leaves no temp file when the commit fails', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    await writeFile(join(dir, 'options.txt'), 'a:0\n');
    await expect(
      applySettingsPolicy(dir, {
        onBeforeCommit: () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toMatchObject({ code: 'io-error' });
    expect(await text(dir)).toBe('a:0\n');
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await readdir(dir)).includes('.torchlauncher-user')).toBe(false);
    expect(await code(applySettingsPolicy(dir, { signal: AbortSignal.abort() }))).toBe('aborted');
    expect(await text(dir)).toBe('a:0\n');
  });

  it('releases the lock after failures', async () => {
    const dir = await root();
    await policy(dir, '{bad');
    await code(applySettingsPolicy(dir));
    const lease = await acquireServerDataLock(dir, 'maintenance');
    await lease.release();
  });
});

describe('ownership', () => {
  const files: SyncOwnership['files'] = [
    { path: 'mods/a.jar', policy: 'always', sha256: hash, length: 1 },
    { path: 'config/Default.toml', policy: 'initial-only', sha256: hash, length: 1 },
  ];
  it('classifies paths as required, initial-default or user', () => {
    const o = ownership(files);
    expect(classifySettingsPath('mods/a.jar', o)).toBe('required');
    expect(classifySettingsPath('config/default.toml', o)).toBe('initial-default');
    expect(classifySettingsPath('options.txt', o)).toBe('user');
    expect(describeManagedFiles(o).map((f) => [f.path, f.classification])).toEqual([
      ['config/Default.toml', 'initial-default'],
      ['mods/a.jar', 'required'],
    ]);
  });

  it('rejects options.txt deployed as always and unfinished synchronization', async () => {
    const dir = await root();
    await policy(dir, { ...base, required: { a: '1' } });
    const owned = ownership([{ path: 'Options.txt', policy: 'always', sha256: hash, length: 1 }]);
    expect(await code(applySettingsPolicy(dir, { ownership: owned }))).toBe(
      'options-owned-by-sync',
    );
    expect(await code(applySettingsPolicy(dir, { ownership: ownership([], false) }))).toBe(
      'sync-not-initialized',
    );
    const ok = ownership([
      { path: 'options.txt', policy: 'initial-only', sha256: hash, length: 1 },
    ]);
    expect((await applySettingsPolicy(dir, { ownership: ok })).status).toBe('applied');
  });
});
