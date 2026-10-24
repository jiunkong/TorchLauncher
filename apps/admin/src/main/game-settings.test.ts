import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import { parseSettingsPolicy } from '../../../../packages/core/src/instance/settings/index.js';
import type { StudioGameSettings } from '../shared/studio.js';
import { StudioService } from './fixtures/signing.js';
import {
  addPack,
  generatePolicy,
  mergeOptions,
  PACK_LIMIT,
  parseGameSettings,
  parseOptionsText,
  readPreset,
  validatePackName,
} from './game-settings.js';
import { parseProject } from './project.js';
import { decodeProjectFile, encodeProjectFile } from './project-file.js';
import { PROJECT_DATA_DIR, PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-set-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const signal = new AbortController().signal;
const zipBytes = (extra = '') =>
  Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from(extra)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('options.txt parsing', () => {
  it('keeps key:value lines, tolerates CRLF/CR/BOM and values with colons', () => {
    const text =
      '﻿key_key.inventory:key.keyboard.e\r\nlastServer:play.example.org:25565\rmusic:0.5\n\n';
    const { entries, ignored } = parseOptionsText(Buffer.from(text));
    expect(entries.map((e) => [e.key, e.value, e.policy])).toEqual([
      ['key_key.inventory', 'key.keyboard.e', 'none'],
      ['lastServer', 'play.example.org:25565', 'none'],
      ['music', '0.5', 'none'],
    ]);
    expect(ignored).toBe(0);
  });
  it('ignores malformed, duplicate, game-owned and control-character lines', () => {
    const lines = [
      'noColon',
      ':emptyKey',
      'bad key:1',
      'dup:1',
      'dup:2',
      'version:3955',
      'resourcePacks:["vanilla"]',
      'incompatibleResourcePacks:[]',
      'ctrl:a\u0007b',
      `long:${'x'.repeat(2049)}`,
      'good:ok',
    ];
    const { entries, ignored } = parseOptionsText(Buffer.from(lines.join('\n')));
    expect(entries.map((e) => e.key)).toEqual(['dup', 'good']);
    expect(entries[0]?.value).toBe('1');
    expect(ignored).toBe(9);
  });
  it('rejects NUL, invalid UTF-8 and oversized files', () => {
    expect(() => parseOptionsText(Buffer.from('a:1\0b:2'))).toThrow(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => parseOptionsText(Buffer.from([0x61, 0x3a, 0xff, 0xfe]))).toThrow(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => parseOptionsText(Buffer.alloc(1024 * 1024 + 1, 97))).toThrow(
      expect.objectContaining({ code: 'TOO_LARGE' }),
    );
  });
  it('merges a re-import: keeps set policies, even for keys that vanished', () => {
    const merged = mergeOptions(
      [
        { key: 'a', value: '1', policy: 'required' },
        { key: 'gone', value: '1', policy: 'initial' },
        { key: 'unset', value: '1', policy: 'none' },
      ],
      [
        { key: 'a', value: '2', policy: 'none' },
        { key: 'b', value: '3', policy: 'none' },
      ],
    );
    expect(merged).toEqual([
      { key: 'a', value: '2', policy: 'required' },
      { key: 'b', value: '3', policy: 'none' },
      { key: 'gone', value: '1', policy: 'initial' },
    ]);
  });
});

describe('preset files', () => {
  it('reads a game folder, detects configs and packs, and refuses wrong names, links and folders without options', async () => {
    const root = await temp();
    await writeFile(join(root, 'options.txt'), 'a:1\n');
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config', 'sodium.json'), '{}');
    await writeFile(join(root, 'config', 'readme.bin'), '');
    await mkdir(join(root, 'resourcepacks'));
    await writeFile(join(root, 'resourcepacks', 'p.zip'), zipBytes());
    const { preview } = await readPreset(root, 'folder');
    expect(preview).toMatchObject({
      source: 'folder',
      optionCount: 1,
      detected: { modConfigs: ['sodium.json'], resourcePacks: ['p.zip'], shaderPacks: [] },
    });
    await writeFile(join(root, 'other.txt'), 'a:1');
    await expect(readPreset(join(root, 'other.txt'), 'file')).rejects.toMatchObject({
      code: 'INVALID',
    });
    const empty = await temp();
    await expect(readPreset(empty, 'folder')).rejects.toBeDefined();
    const linked = await temp();
    await symlink(join(root, 'options.txt'), join(linked, 'options.txt'));
    await expect(readPreset(linked, 'folder')).rejects.toBeDefined();
    await expect(readPreset(join(root, 'options.txt'), 'file')).resolves.toMatchObject({
      preview: { source: 'file' },
    });
  });
});

describe('pack names and files', () => {
  it('validates pack names', () => {
    for (const bad of [
      '../a.zip',
      'a/b.zip',
      'a\\b.zip',
      '.hidden.zip',
      'a.txt',
      'a.zip.exe',
      'CON.zip',
      'nul.zip',
      ' a.zip',
      'a .zip',
      'a..b.zip',
      `${'x'.repeat(130)}.zip`,
      'a\u0000.zip',
      'a:b.zip',
      '',
    ])
      expect(() => validatePackName(bad), bad).toThrow();
    for (const good of ['Faithful 32x.zip', '서버 팩 v1.2.zip', 'pack(1)+x.zip', 'a.zip'])
      expect(() => validatePackName(good), good).not.toThrow();
    for (const bad of ['a.zip', 'a.jar.exe', '../a.jar'])
      expect(() => validatePackName(bad, 'mod'), bad).toThrow();
    for (const good of ['fabric-api.jar', '모드 1.2.jar'])
      expect(() => validatePackName(good, 'mod'), good).not.toThrow();
  });
  it('copies a pack into the source folder, verifies the hash, and never overwrites a different file', async () => {
    const source = await temp();
    const other = await temp();
    const bytes = zipBytes('one');
    await writeFile(join(other, 'pack.zip'), bytes);
    const pack = await addPack(source, 'resourcepack', join(other, 'pack.zip'), signal);
    expect(pack).toEqual({
      name: 'pack.zip',
      sha256: sha(bytes),
      length: bytes.length,
      policy: 'none',
    });
    expect(await readFile(join(source, 'resourcepacks', 'pack.zip'))).toEqual(bytes);
    expect(await readdir(join(source, 'resourcepacks'))).toEqual(['pack.zip']);
    // same bytes again: fine; in place: fine
    await expect(
      addPack(source, 'resourcepack', join(other, 'pack.zip'), signal),
    ).resolves.toMatchObject({
      sha256: sha(bytes),
    });
    await expect(
      addPack(source, 'resourcepack', join(source, 'resourcepacks', 'pack.zip'), signal),
    ).resolves.toMatchObject({ sha256: sha(bytes) });
    // different content, same name
    const changed = await temp();
    await writeFile(join(changed, 'pack.zip'), zipBytes('two'));
    await expect(
      addPack(source, 'resourcepack', join(changed, 'pack.zip'), signal),
    ).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(await readFile(join(source, 'resourcepacks', 'pack.zip'))).toEqual(bytes);
  });
  it('copies jar mods to mods and applies their selected deployment policy', async () => {
    const h = await harness();
    const picked = join(h.root, 'fabric-api.jar');
    const jar = zipBytes('mod');
    await writeFile(picked, jar);
    h.d.open.mockResolvedValueOnce([picked]);
    expect(await h.s.request({ action: 'settingsPackAdd', kind: 'mod' })).toMatchObject({
      ok: true,
    });
    expect(await readFile(join(h.source, 'mods', 'fabric-api.jar'))).toEqual(jar);
    expect(h.s.snapshot().project?.gameSettings?.mods).toMatchObject([
      { name: 'fabric-api.jar', policy: 'initial' },
    ]);
    expect([...(await h.readPack()).keys()]).toContain('mods/fabric-api.jar|initial-only');
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'mod',
      name: 'fabric-api.jar',
      policy: 'required',
    });
    expect([...(await h.readPack()).keys()]).toContain('mods/fabric-api.jar|always');
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'mod',
      name: 'fabric-api.jar',
      policy: 'none',
    });
    expect([...(await h.readPack()).keys()]).not.toContain('mods/fabric-api.jar|always');
    await h.reopenWithFiles([{ path: 'mods/fabric-api.jar', policy: 'always' }]);
    expect([...(await h.readPack()).keys()]).not.toContain('mods/fabric-api.jar|always');
  });
  it('rejects non-zip, oversized, badly named and linked packs and leaves no files', async () => {
    const source = await temp();
    const other = await temp();
    await writeFile(join(other, 'text.zip'), 'plain text');
    await expect(
      addPack(source, 'shaderpack', join(other, 'text.zip'), signal),
    ).rejects.toMatchObject({
      code: 'INVALID',
    });
    await writeFile(join(other, 'big.zip'), zipBytes());
    await truncate(join(other, 'big.zip'), PACK_LIMIT + 1);
    await expect(
      addPack(source, 'shaderpack', join(other, 'big.zip'), signal),
    ).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await writeFile(join(other, 'bad name?.zip'), zipBytes());
    await expect(
      addPack(source, 'shaderpack', join(other, 'bad name?.zip'), signal),
    ).rejects.toMatchObject({
      code: 'INVALID',
    });
    await writeFile(join(other, 'real.zip'), zipBytes());
    await symlink(join(other, 'real.zip'), join(other, 'link.zip'));
    await expect(
      addPack(source, 'shaderpack', join(other, 'link.zip'), signal),
    ).rejects.toBeDefined();
    expect(await readdir(source)).not.toContain('shaderpacks');
  });
  it('accepts a pack exactly at the size limit', async () => {
    const source = await temp();
    const other = await temp();
    await writeFile(join(other, 'edge.zip'), zipBytes());
    await truncate(join(other, 'edge.zip'), PACK_LIMIT);
    const pack = await addPack(source, 'resourcepack', join(other, 'edge.zip'), signal);
    expect(pack.length).toBe(PACK_LIMIT);
  });
});

describe('policy generation', () => {
  const base = (): StudioGameSettings => ({
    options: [
      { key: 'renderDistance', value: '12', policy: 'required' },
      { key: 'musicVolume', value: '0.2', policy: 'initial' },
      { key: 'gamma', value: '1', policy: 'none' },
    ],
    resourcePacks: [
      { name: 'a.zip', sha256: 'a'.repeat(64), length: 1, policy: 'required' },
      { name: 'b.zip', sha256: 'b'.repeat(64), length: 1, policy: 'initial' },
      { name: 'c.zip', sha256: 'c'.repeat(64), length: 1, policy: 'none' },
    ],
    shaderPacks: [],
  });
  it('produces a v1 policy that core accepts, in operator order', () => {
    const text = generatePolicy(base())?.text ?? '';
    const policy = parseSettingsPolicy(Buffer.from(text));
    expect(policy.required).toEqual([['renderDistance', '12']]);
    expect(policy.initial).toEqual([['musicVolume', '0.2']]);
    expect(policy.resourcePacks).toEqual({ required: ['file/a.zip'], initial: ['file/b.zip'] });
  });
  it('is null when nothing is set and rejects more than 512 keys per map', () => {
    expect(generatePolicy({ options: [], resourcePacks: [], shaderPacks: [] })).toBeNull();
    const many = base();
    many.options = Array.from({ length: 513 }, (_, i) => ({
      key: `k${i}`,
      value: '1',
      policy: 'required' as const,
    }));
    expect(() => generatePolicy(many)).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => parseGameSettings(many)).not.toThrow();
  });
  it('rejects malformed stored settings', () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...base(), extra: 1 },
      { ...base(), options: [{ key: 'a', value: 1, policy: 'none' }] },
      { ...base(), options: [{ key: 'resourcePacks', value: '[]', policy: 'required' }] },
      { ...base(), options: [{ key: 'a', value: 'x', policy: 'always' }] },
      {
        ...base(),
        resourcePacks: [{ name: '../x.zip', sha256: 'a'.repeat(64), length: 1, policy: 'none' }],
      },
      {
        ...base(),
        resourcePacks: [{ name: 'x.zip', sha256: 'zz', length: 1, policy: 'none' }],
      },
      {
        ...base(),
        resourcePacks: [
          { name: 'x.zip', sha256: 'a'.repeat(64), length: PACK_LIMIT + 1, policy: 'none' },
        ],
      },
    ];
    for (const input of bad) expect(() => parseGameSettings(input)).toThrow();
    expect(parseGameSettings(base())).toEqual(base());
  });
});

async function harness() {
  const root = await temp();
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
  };
  const s = new StudioService(d);
  d.open.mockResolvedValueOnce([root]);
  await s.request({ action: 'new', discard: true });
  const source = join(root, PROJECT_DATA_DIR);
  const game = join(root, 'game');
  await mkdir(game);
  await writeFile(
    join(game, 'options.txt'),
    'renderDistance:12\nmusicVolume:0.5\nkey_key.inventory:key.keyboard.e\nfov:70.0\n',
  );
  /** Reopens a current project with an explicit file list. */
  const reopenWithFiles = async (files: { path: string; policy: 'always' | 'initial-only' }[]) => {
    const project = parseProject(s.snapshot().project);
    project.files = files;
    await writeFile(join(root, PROJECT_FILE_NAME), encodeProjectFile(project, {}));
    d.open.mockResolvedValueOnce([root]);
    await s.request({ action: 'open', discard: true });
  };
  const importFolder = async () => {
    d.open.mockResolvedValueOnce([game]);
    return s.request({ action: 'settingsImport', source: 'folder' });
  };
  const addPackFile = async (kind: 'resourcepack' | 'shaderpack', name: string, content = 'x') => {
    const dir = join(root, 'picked');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), zipBytes(content));
    d.open.mockResolvedValueOnce([join(dir, name)]);
    return s.request({ action: 'settingsPackAdd', kind });
  };
  const readPack = async (): Promise<Map<string, Buffer>> => {
    const pack = join(root, 'out.torchpack');
    d.save.mockResolvedValueOnce(pack);
    const reply = await s.request({ action: 'build' });
    if (!reply.ok) throw new Error(`build failed ${reply.code}`);
    const bytes = await readFile(pack);
    const snapshot = { totalLength: bytes.length, etag: '"t"', lastModified: null };
    const src = {
      kind: 'https',
      sourceId: 't',
      generation: 0,
      snapshot,
      async getRange(range: { start: number; end: number }) {
        return {
          sourceId: 't',
          sourceGeneration: 0,
          range,
          bytes: bytes.subarray(range.start, range.end + 1),
          snapshot,
        };
      },
      reset() {},
    } as unknown as DownloadSource;
    const reader = await openDeploymentReader(src, {
      expectedServerId: s.snapshot().project?.serverId ?? '',
    });
    const files = new Map<string, Buffer>();
    const stage = await mkdtemp(join(root, 'stage-'));
    for (const f of reader.index.files) {
      const out = join(stage, `f-${files.size}`);
      await reader.stageFile(f.path, out);
      files.set(`${f.path}|${f.policy}`, await readFile(out));
    }
    return files;
  };
  return { root, source, game, d, s, reopenWithFiles, importFolder, addPackFile, readPack };
}

describe('service: game settings preset', () => {
  it('imports, edits policies, and builds settings-policy.json plus pack files without options.txt', async () => {
    const h = await harness();
    // Plain options.txt remains an ordinary payload until a settings preset owns it.
    await writeFile(join(h.source, 'options.txt'), 'old');
    expect((await h.importFolder()).ok).toBe(true);
    expect(h.s.snapshot().preset).toMatchObject({ source: 'folder', optionCount: 4 });
    expect(h.s.snapshot().project?.version).toBe(1);
    expect(
      (
        await h.s.request({
          action: 'settingsOptions',
          changes: [
            { key: 'renderDistance', policy: 'required' },
            { key: 'musicVolume', policy: 'initial', value: '0.1' },
            { key: 'key_key.inventory', policy: 'initial' },
          ],
        })
      ).ok,
    ).toBe(true);
    expect((await h.addPackFile('resourcepack', 'server pack.zip', 'rp')).ok).toBe(true);
    expect((await h.addPackFile('resourcepack', 'second.zip', 'rp2')).ok).toBe(true);
    expect((await h.addPackFile('shaderpack', 'Complementary.zip', 'sp')).ok).toBe(true);
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'resourcepack',
      name: 'server pack.zip',
      policy: 'required',
    });
    await h.s.request({
      action: 'settingsPackMove',
      kind: 'resourcepack',
      name: 'second.zip',
      index: 0,
    });
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'shaderpack',
      name: 'Complementary.zip',
      policy: 'required',
    });
    const files = await h.readPack();
    expect([...files.keys()].sort()).toEqual([
      'resourcepacks/second.zip|initial-only',
      'resourcepacks/server pack.zip|always',
      'shaderpacks/Complementary.zip|always',
      'torchlauncher/settings-policy.json|always',
    ]);
    const policy = parseSettingsPolicy(
      files.get('torchlauncher/settings-policy.json|always') ?? Buffer.alloc(0),
    );
    expect(policy.required).toEqual([['renderDistance', '12']]);
    expect(policy.initial).toEqual([
      ['key_key.inventory', 'key.keyboard.e'],
      ['musicVolume', '0.1'],
    ]);
    expect(policy.resourcePacks).toEqual({
      required: ['file/server pack.zip'],
      initial: ['file/second.zip'],
    });
    const entries = h.s.snapshot().files?.entries ?? [];
    expect(entries.find((e) => e.path === 'torchlauncher/settings-policy.json')?.policy).toBe(
      'managed',
    );
    expect(h.s.snapshot().deploy?.status).toBe('upToDate');
    // a policy edit changes the generated file and marks the deployment changed through settings
    await h.s.request({ action: 'settingsOptions', changes: [{ key: 'fov', policy: 'required' }] });
    await h.s.request({ action: 'rescan' });
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'changed', reasons: ['settings'] });
    expect(
      h.s.snapshot().files?.entries.find((e) => e.path === 'torchlauncher/settings-policy.json')
        ?.change,
    ).toBe('modified');
  });
  it('keeps plain options.txt entries working for projects that never used game settings', async () => {
    const h = await harness();
    await writeFile(join(h.source, 'options.txt'), 'old');
    // Current projects can list options.txt as a plain file.
    await h.reopenWithFiles([{ path: 'options.txt', policy: 'initial-only' }]);
    expect(h.s.snapshot().files?.entries[0]).toMatchObject({
      path: 'options.txt',
      policy: 'managed',
    });
    expect([...(await h.readPack()).keys()]).toEqual(['options.txt|initial-only']);
  });
  it('drops a plain options.txt entry from the build once game settings own it', async () => {
    const h = await harness();
    await writeFile(join(h.source, 'options.txt'), 'old');
    await writeFile(join(h.source, 'keep.txt'), 'k');
    await h.reopenWithFiles([
      { path: 'options.txt', policy: 'always' },
      { path: 'keep.txt', policy: 'always' },
    ]);
    await h.importFolder();
    await h.s.request({ action: 'settingsOptions', changes: [{ key: 'fov', policy: 'initial' }] });
    expect([...(await h.readPack()).keys()].sort()).toEqual([
      'keep.txt|always',
      'torchlauncher/settings-policy.json|always',
    ]);
  });
  it('replaces a same-named pack keeping policy and position, and removes without deleting the file', async () => {
    const h = await harness();
    await h.addPackFile('resourcepack', 'a.zip', '1');
    await h.addPackFile('resourcepack', 'b.zip', '2');
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'resourcepack',
      name: 'a.zip',
      policy: 'required',
    });
    // a different file named a.zip cannot silently replace the one in the source folder
    expect((await h.addPackFile('resourcepack', 'a.zip', 'changed')).ok).toBe(false);
    const packs = h.s.snapshot().project?.gameSettings?.resourcePacks;
    expect(packs?.map((p) => [p.name, p.policy])).toEqual([
      ['a.zip', 'required'],
      ['b.zip', 'initial'],
    ]);
    expect(
      await h.s.request({ action: 'settingsPackRemove', kind: 'resourcepack', name: 'a.zip' }),
    ).toMatchObject({ ok: true });
    expect(h.s.snapshot().project?.gameSettings?.resourcePacks.map((p) => p.name)).toEqual([
      'b.zip',
    ]);
    expect(await readdir(join(h.source, 'resourcepacks'))).toContain('a.zip');
  });
  it('refuses a pack that changed on disk after it was added, before writing anything', async () => {
    const h = await harness();
    await h.addPackFile('resourcepack', 'a.zip', '1');
    await writeFile(join(h.source, 'resourcepacks', 'a.zip'), zipBytes('tampered'));
    const pack = join(h.root, 'out.torchpack');
    h.d.save.mockResolvedValueOnce(pack);
    expect(await h.s.request({ action: 'build' })).toEqual({ ok: false, code: 'MISMATCH' });
    expect(await readdir(h.root)).not.toContain('out.torchpack');
    await expect(readdir(join(h.source, 'torchlauncher'))).rejects.toBeDefined();
  });
  it('validates settings commands: shapes, unknown keys, traversal names, limits', async () => {
    const h = await harness();
    const bad: unknown[] = [
      { action: 'settingsImport' },
      { action: 'settingsImport', source: 'path' },
      { action: 'settingsImport', source: 'file', path: '/x' },
      { action: 'settingsOptions', changes: [] },
      { action: 'settingsOptions', changes: [{ key: 1, policy: 'none' }] },
      { action: 'settingsOptions', changes: [{ key: 'a', policy: 'always' }] },
      { action: 'settingsOptions', changes: [{ key: 'a', policy: 'none', extra: 1 }] },
      {
        action: 'settingsOptions',
        changes: Array.from({ length: 513 }, () => ({ key: 'a', policy: 'none' })),
      },
      { action: 'settingsPackAdd', kind: 'unsupported' },
      { action: 'settingsPackPolicy', kind: 'resourcepack', name: 'a.zip' },
      { action: 'settingsPackMove', kind: 'resourcepack', name: 'a.zip', index: 1.5 },
      { action: 'settingsPackRemove', kind: 'resourcepack', name: 'a.zip', path: 'x' },
    ];
    for (const b of bad) expect(await h.s.request(b)).toEqual({ ok: false, code: 'INVALID' });
    // semantically invalid but well-formed
    expect(
      await h.s.request({ action: 'settingsOptions', changes: [{ key: 'a', policy: 'none' }] }),
    ).toEqual({ ok: false, code: 'INVALID' });
    await h.importFolder();
    expect(
      await h.s.request({
        action: 'settingsOptions',
        changes: [{ key: 'missing', policy: 'required' }],
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    expect(
      await h.s.request({
        action: 'settingsPackPolicy',
        kind: 'resourcepack',
        name: '../a.zip',
        policy: 'none',
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    expect(
      await h.s.request({
        action: 'settingsPackRemove',
        kind: 'resourcepack',
        name: 'nothere.zip',
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    expect(
      await h.s.request({
        action: 'settingsOptions',
        changes: [{ key: 'fov', policy: 'required', value: 'a\u0000b' }],
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
  });
  it('cancels an import dialog without changing the project', async () => {
    const h = await harness();
    h.d.open.mockResolvedValueOnce(null);
    expect(await h.s.request({ action: 'settingsImport', source: 'file' })).toEqual({
      ok: false,
      code: 'CANCELLED',
    });
    expect(h.s.snapshot().project?.gameSettings).toBeUndefined();
    expect(h.s.snapshot().dirty).toBe(false);
  });
  it('cannot be changed through update and survives save and reopen with lastBuild', async () => {
    const h = await harness();
    await h.importFolder();
    await h.s.request({ action: 'settingsOptions', changes: [{ key: 'fov', policy: 'required' }] });
    await h.addPackFile('shaderpack', 's.zip');
    await h.readPack();
    const forged = parseProject(h.s.snapshot().project);
    if (!forged.gameSettings) throw new Error('missing settings');
    forged.gameSettings.options[0] = { key: 'fov', value: '1', policy: 'required' };
    expect(await h.s.request({ action: 'update', project: forged })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    const saved = join(h.root, 'p.torchproj');
    h.d.save.mockResolvedValueOnce(saved);
    await h.s.request({ action: 'save' });
    const before = h.s.snapshot().project;
    h.d.open.mockResolvedValueOnce([saved]);
    await h.s.request({ action: 'open', discard: true });
    expect(h.s.snapshot().project).toEqual(before);
    expect(before?.version).toBe(1);
  });
});

describe('project schema', () => {
  const v1 = () => {
    const raw = decodeProjectFile(
      encodeProjectFile(
        parseProject({
          format: 'torchlauncher-project',
          version: 1,
          serverId: '44444444-4444-4444-8444-444444444444',
          name: 'S',
          address: 'localhost:25565',
          sourceUrl: '',
          game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
          files: [{ path: 'a.txt', policy: 'always' }],
        }),
        {},
      ),
      () => ({ width: 1, height: 1 }),
    ).project;
    return raw;
  };
  it('reads the current schema and rejects earlier or unknown versions', () => {
    const raw = v1();
    expect(parseProject(raw).version).toBe(1);
    expect(() => parseProject({ ...v1(), version: 2 })).toThrow(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(() => parseProject({ ...v1(), version: 0 })).toThrow();
  });
  it('validates the optional fields strictly', () => {
    const empty = { options: [], resourcePacks: [], shaderPacks: [] };
    expect(parseProject({ ...v1(), gameSettings: empty }).gameSettings).toEqual(empty);
    expect(() => parseProject({ ...v1(), gameSettings: { ...empty, extra: 1 } })).toThrow();
    expect(() => parseProject({ ...v1(), lastBuild: { files: [] } })).toThrow();
  });
});

describe('service: mod configs and shaders', () => {
  async function folder(h: Awaited<ReturnType<typeof harness>>) {
    await mkdir(join(h.game, 'config'), { recursive: true });
    await mkdir(join(h.game, 'shaderpacks'), { recursive: true });
    await writeFile(
      join(h.game, 'config', 'sodium-extra.properties'),
      '# c\r\nfog=true\r\nlevel=3\r\n',
    );
    await writeFile(join(h.game, 'config', 'big.toml'), 'a = 1');
    await writeFile(join(h.game, 'config', 'bad.properties'), 'a=1\na=2\n');
    await writeFile(
      join(h.game, 'config', 'iris.properties'),
      'enableShaders=true\nshaderPack=BSL.zip\n',
    );
    await writeFile(join(h.game, 'shaderpacks', 'BSL.zip.txt'), 'SHADOW=2048\nCLOUDS=true\n');
    await writeFile(join(h.game, 'shaderpacks', 'BSL.zip'), zipBytes('s'));
  }
  const policyOf = async (h: Awaited<ReturnType<typeof harness>>) => {
    const files = await h.readPack();
    return parseSettingsPolicy(
      files.get('torchlauncher/settings-policy.json|always') ?? Buffer.alloc(0),
    );
  };
  it('imports config files, skips unsupported ones and reads the shader files', async () => {
    const h = await harness();
    await folder(h);
    expect((await h.importFolder()).ok).toBe(true);
    const state = h.s.snapshot();
    expect(state.preset).toMatchObject({
      importedConfigs: ['config/sodium-extra.properties'],
      shader: {
        configPath: 'config/iris.properties',
        packOptionFiles: ['shaderpacks/BSL.zip.txt'],
      },
    });
    expect(state.preset?.skippedConfigs).toEqual(
      expect.arrayContaining([
        { path: 'config/big.toml', reason: 'unsupported' },
        { path: 'config/bad.properties', reason: 'invalid-config' },
      ]),
    );
    const g = state.project?.gameSettings;
    expect(g?.configFiles?.[0]?.items).toEqual([
      { key: 'fog', value: 'true', policy: 'none', valueType: 'boolean' },
      { key: 'level', value: '3', policy: 'none', valueType: 'number' },
    ]);
    expect(g?.shader).toMatchObject({
      configPath: 'config/iris.properties',
      enabled: { policy: 'none', value: true },
      pack: { policy: 'none', value: 'BSL.zip' },
      packOptions: [{ pack: 'BSL.zip' }],
    });
    expect(g?.options.find((o) => o.key === 'key_key.inventory')).toMatchObject({
      kind: 'keybind',
      group: 'inventory',
    });
    expect(state.policy).toEqual({
      generated: false,
      configFiles: 0,
      bytes: 0,
      limit: 65536,
      error: null,
    });
  });
  it('adds config files to the policy only when an item is set, with all three states', async () => {
    const h = await harness();
    await folder(h);
    await h.importFolder();
    await h.s.request({ action: 'settingsOptions', changes: [{ key: 'fov', policy: 'required' }] });
    expect(h.s.snapshot().policy).toMatchObject({ generated: true, configFiles: 0, error: null });
    expect((await policyOf(h)).configFiles).toEqual([]);
    // items that stay "none" add no config file to the policy
    await h.s.request({
      action: 'settingsConfigItems',
      path: 'config/sodium-extra.properties',
      changes: [{ key: 'fog', policy: 'none' }],
    });
    expect(h.s.snapshot().policy?.configFiles).toBe(0);
    await h.s.request({
      action: 'settingsConfigItems',
      path: 'config/sodium-extra.properties',
      changes: [
        { key: 'fog', policy: 'required', value: 'false' },
        { key: 'brand_new', policy: 'initial', value: '7' },
      ],
    });
    await h.s.request({
      action: 'settingsShader',
      enabled: { policy: 'required', value: true },
      pack: { policy: 'initial', value: 'BSL.zip' },
    });
    await h.s.request({
      action: 'settingsShaderOptions',
      pack: 'BSL.zip',
      changes: [{ key: 'SHADOW', policy: 'initial', value: '4096' }],
    });
    expect(h.s.snapshot().policy).toMatchObject({ configFiles: 3, error: null });
    const policy = await policyOf(h);
    expect(policy.version).toBe(1);
    const byPath = Object.fromEntries(policy.configFiles.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual([
      'config/iris.properties',
      'config/sodium-extra.properties',
      'shaderpacks/BSL.zip.txt',
    ]);
    expect(byPath['config/sodium-extra.properties']).toMatchObject({
      required: [['fog', 'false']],
      initial: [['brand_new', '7']],
    });
    expect(byPath['config/iris.properties']).toMatchObject({
      required: [['enableShaders', 'true']],
      initial: [['shaderPack', 'BSL.zip']],
    });
    expect(byPath['shaderpacks/BSL.zip.txt']?.initial).toEqual([['SHADOW', '4096']]);
    const managed =
      h.s
        .snapshot()
        .files?.entries.filter((e) => e.policy === 'managed')
        .map((e) => e.path) ?? [];
    expect(managed).toContain('torchlauncher/settings-policy.json');
    // switching everything back to unset returns to v1 / no config files
    await h.s.request({ action: 'settingsConfigRemove', path: 'config/sodium-extra.properties' });
    await h.s.request({
      action: 'settingsShader',
      enabled: { policy: 'none', value: true },
      pack: { policy: 'none', value: 'BSL.zip' },
    });
    await h.s.request({ action: 'settingsShaderOptionsRemove', pack: 'BSL.zip' });
    expect(h.s.snapshot().policy?.configFiles).toBe(0);
  });
  it('rejects a policy over 64 KiB with a structured error and keeps the project unchanged', async () => {
    const h = await harness();
    await folder(h);
    await h.importFolder();
    const before = JSON.stringify(h.s.snapshot().project);
    const changes = Array.from({ length: 40 }, (_, i) => ({
      key: `key${i}`,
      policy: 'required' as const,
      value: 'v'.repeat(1900),
    }));
    expect(
      await h.s.request({ action: 'settingsConfigItems', path: 'config/big.properties', changes }),
    ).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(JSON.stringify(h.s.snapshot().project)).toBe(before);
    await h.s.request({ action: 'rescan' });
    expect(h.s.snapshot().policy?.error?.code).toBe('limit-exceeded');
    // a later valid change clears the rejection
    await h.s.request({ action: 'settingsOptions', changes: [{ key: 'fov', policy: 'initial' }] });
    expect(h.s.snapshot().policy?.error).toBeNull();
  });
  it('rejects values and paths the launcher would refuse', async () => {
    const h = await harness();
    await folder(h);
    await h.importFolder();
    const set = (changes: { key: string; policy: 'required'; value: string }[]) =>
      h.s.request({
        action: 'settingsConfigItems',
        path: 'config/sodium-extra.properties',
        changes,
      });
    expect(await set([{ key: 'fog', policy: 'required', value: 'caf\u00e9' }])).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(h.s.snapshot().policy?.error?.code).toBe('invalid-policy');
    expect(await set([{ key: 'fog', policy: 'required', value: ' padded' }])).toEqual({
      ok: false,
      code: 'INVALID',
    });
    for (const path of [
      'config/../options.txt',
      '../config/a.properties',
      '/config/a.properties',
      'config/a.toml',
      'config/iris.properties',
      'config/oculus.properties',
      'options.txt',
      'mods/a.properties',
      'shaderpacks/a.txt',
      'config\\a.properties',
    ])
      expect(
        await h.s.request({
          action: 'settingsConfigItems',
          path,
          changes: [{ key: 'a', policy: 'none', value: '1' }],
        }),
        path,
      ).toEqual({ ok: false, code: 'INVALID' });
    for (const pack of ['../x', 'a/b', '', '.hidden'])
      expect(
        await h.s.request({
          action: 'settingsShaderOptions',
          pack,
          changes: [{ key: 'a', policy: 'none', value: '1' }],
        }),
        pack,
      ).toEqual({ ok: false, code: 'INVALID' });
    // unknown key without a value, malformed shapes
    expect(await set([{ key: 'nothere', policy: 'required' } as never])).toEqual({
      ok: false,
      code: 'INVALID',
    });
    for (const bad of [
      { action: 'settingsShader' },
      { action: 'settingsShader', extra: 1 },
      { action: 'settingsShader', enabled: { policy: 'required', value: 'yes' } },
      { action: 'settingsShader', pack: { policy: 'required', value: 1 } },
      { action: 'settingsShader', configPath: 'config/other.properties' },
      { action: 'settingsConfigRemove' },
      { action: 'settingsConfigRemove', path: 'x', extra: 1 },
      { action: 'settingsShaderOptionsRemove', pack: 5 },
    ])
      expect(await h.s.request(bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'INVALID' });
    expect(
      await h.s.request({ action: 'settingsConfigRemove', path: 'config/none.properties' }),
    ).toEqual({ ok: false, code: 'INVALID' });
  });
  it('refuses a build when a plain always file is also edited by the policy, and the bulk command refuses such paths', async () => {
    const h = await harness();
    await folder(h);
    await h.importFolder();
    await h.s.request({
      action: 'settingsConfigItems',
      path: 'config/sodium-extra.properties',
      changes: [{ key: 'fog', policy: 'required' }],
    });
    await mkdir(join(h.source, 'config'), { recursive: true });
    await writeFile(join(h.source, 'config', 'sodium-extra.properties'), 'fog=true\n');
    expect(
      await h.s.request({
        action: 'filesPolicy',
        paths: ['config/sodium-extra.properties'],
        policy: 'always',
      }),
    ).toEqual({ ok: false, code: 'INVALID' });
    await h.reopenWithFiles([{ path: 'config/sodium-extra.properties', policy: 'always' }]);
    expect(h.s.snapshot().policy?.error?.code).toBe('config-owned-by-sync');
    h.d.save.mockResolvedValueOnce(join(h.root, 'x.torchpack'));
    expect(await h.s.request({ action: 'build' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await readdir(h.root)).not.toContain('x.torchpack');
    // initial-only for the same file is allowed
    await h.reopenWithFiles([{ path: 'config/sodium-extra.properties', policy: 'initial-only' }]);
    expect(h.s.snapshot().policy?.error).toBeNull();
  });
  it('re-import keeps chosen policies and saves/reopens the v2 schema; older settings without the new fields still open', async () => {
    const h = await harness();
    await folder(h);
    await h.importFolder();
    await h.s.request({ action: 'settingsShader', pack: { policy: 'required', value: 'BSL.zip' } });
    await h.s.request({
      action: 'settingsConfigItems',
      path: 'config/sodium-extra.properties',
      changes: [{ key: 'fog', policy: 'initial' }],
    });
    await h.importFolder();
    const g = h.s.snapshot().project?.gameSettings;
    expect(g?.shader?.pack).toEqual({ policy: 'required', value: 'BSL.zip' });
    expect(g?.configFiles?.[0]?.items.find((i) => i.key === 'fog')?.policy).toBe('initial');
    await h.s.request({ action: 'save' });
    const before = h.s.snapshot().project;
    h.d.open.mockResolvedValueOnce([h.root]);
    await h.s.request({ action: 'open', discard: true });
    expect(h.s.snapshot().project).toEqual(before);
    const saved = join(h.root, PROJECT_FILE_NAME);
    const old = structuredClone(
      decodeProjectFile(await readFile(saved), () => ({ width: 1, height: 1 })).project,
    ) as unknown as { gameSettings: Record<string, unknown> };
    delete old.gameSettings.configFiles;
    delete old.gameSettings.shader;
    expect(() => parseProject(old)).not.toThrow();
    old.gameSettings.shader = {
      configPath: 'config/other.properties',
      enabled: { policy: 'none', value: false },
      pack: { policy: 'none', value: '' },
      packOptions: [],
    };
    expect(() => parseProject(old)).toThrow();
  });
});
