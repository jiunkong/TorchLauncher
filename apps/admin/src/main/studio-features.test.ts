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
import { RangeNotSupportedError } from '../../../../packages/core/src/download/http/range-client.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import type { StudioFileEntry, StudioState } from '../shared/studio.js';
import { createProjectAt } from './fixtures/projects.js';
import { StudioService } from './fixtures/signing.js';
import { readZip } from './fixtures/zip.js';
import { parseProject } from './project.js';
import { decodeProjectFile } from './project-file.js';
import { PROJECT_DATA_DIR, PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';
import { writeZip } from './zip.js';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-feat-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function memorySource(bytes: Buffer): DownloadSource {
  const snapshot = { totalLength: bytes.length, etag: '"test"', lastModified: null };
  let generation = 0;
  return {
    kind: 'https',
    sourceId: 'test-pack',
    get generation() {
      return generation;
    },
    snapshot,
    async getRange(range, options) {
      options?.signal?.throwIfAborted();
      return {
        sourceId: this.sourceId,
        sourceGeneration: this.generation,
        range,
        bytes: bytes.subarray(range.start, range.end + 1),
        snapshot,
      };
    },
    reset() {
      generation++;
    },
  };
}
type Remote = Buffer | Error | null;
async function harness(files: Record<string, string> = { 'a.txt': 'aaaa', 'b.txt': 'bbbb' }) {
  const root = await temp();
  const projDir = join(root, 'proj');
  await mkdir(projDir);
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
    reveal: vi.fn<NonNullable<StudioDialogs['reveal']>>(),
  };
  const remote: { value: Remote } = { value: null };
  const s = new StudioService(d, () => {
    if (remote.value instanceof Error) {
      const error = remote.value;
      return {
        ...memorySource(Buffer.alloc(0)),
        async getRange() {
          throw error;
        },
      } as DownloadSource;
    }
    return memorySource(remote.value ?? Buffer.alloc(0));
  });
  await createProjectAt(s, d, projDir);
  const source = join(projDir, PROJECT_DATA_DIR);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), content);
  }
  await s.request({ action: 'rescan' });
  /** Adds source files through the file picker, as a user would. New files start as `always`. */
  const add = async (paths: string[]) => {
    d.open.mockResolvedValueOnce(paths.map((path) => join(source, path)));
    return s.request({ action: 'files' });
  };
  /** Adds the files that are not in the project yet, then sets their policy. */
  const include = async (paths: string[], policy: 'always' | 'initial-only') => {
    const known = new Set((s.snapshot().project?.files ?? []).map((f) => f.path));
    const fresh = paths.filter((path) => !known.has(path));
    if (fresh.length > 0) {
      const added = await add(fresh);
      if (!added.ok) return added;
    }
    return s.request({ action: 'filesPolicy', paths, policy });
  };
  const edit = async (change: (p: ReturnType<typeof parseProject>) => void) => {
    const p = parseProject(s.snapshot().project);
    change(p);
    return s.request({ action: 'update', project: p });
  };
  const build = async (name = 'server.torchpack') => {
    const pack = join(root, name);
    d.save.mockResolvedValueOnce(pack);
    const reply = await s.request({ action: 'build' });
    expect(reply.ok).toBe(true);
    remote.value = await readFile(pack);
    return pack;
  };
  await edit((p) => {
    p.sourceUrl = 'https://example.org/pack';
  });
  return { root, projDir, source, d, s, remote, add, include, edit, build };
}
const entry = (state: StudioState, path: string): StudioFileEntry => {
  const found = state.files?.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no entry ${path}`);
  return found;
};

describe('files diff against the last build', () => {
  it('lists unmanaged source files as unassigned until added, with no change marks before a first build', async () => {
    const h = await harness({ 'a.txt': 'aaaa', 'sub/b.txt': 'bb' });
    const state = h.s.snapshot();
    expect(state.files?.counts).toMatchObject({ total: 2, excluded: 2, added: 0 });
    expect(entry(state, 'a.txt')).toMatchObject({
      policy: 'excluded',
      targetPath: null,
      change: null,
      size: 4,
    });
    expect(state.deploy).toMatchObject({ status: 'none', lastBuild: null });
    expect((await h.add(['a.txt', 'sub/b.txt'])).ok).toBe(true);
    expect(h.s.snapshot().files?.counts).toMatchObject({ excluded: 0, total: 2 });
    expect(entry(h.s.snapshot(), 'sub/b.txt')).toMatchObject({
      policy: 'always',
      targetPath: 'sub/b.txt',
    });
    expect(h.s.snapshot().project?.files).toEqual([
      { path: 'a.txt', targetPath: 'a.txt', policy: 'always' },
      { path: 'sub/b.txt', targetPath: 'sub/b.txt', policy: 'always' },
    ]);
  });
  it('reports added, modified (same size), policy-modified and removed correctly', async () => {
    const h = await harness({ 'a.txt': 'aaaa', 'b.txt': 'bbbb', 'c.txt': 'cccc', 'd.txt': 'dddd' });
    await h.include(['a.txt', 'b.txt', 'd.txt'], 'always');
    await h.build();
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'upToDate', reasons: [] });
    expect(h.s.snapshot().project?.version).toBe(1);
    // same size, different bytes -> modified; touching without changing bytes -> unchanged
    await writeFile(join(h.source, 'a.txt'), 'AAAA');
    await writeFile(join(h.source, 'b.txt'), 'bbbb');
    await h.include(['c.txt'], 'initial-only');
    await h.include(['d.txt'], 'initial-only');
    await h.s.request({ action: 'filesRemove', path: 'b.txt' });
    await h.s.request({ action: 'rescan' });
    const state = h.s.snapshot();
    expect(entry(state, 'a.txt')).toMatchObject({ policy: 'always', change: 'modified' });
    // Delete removed b.txt from the project and from files/; the diff keeps it as a removal.
    expect(entry(state, 'b.txt')).toMatchObject({
      policy: 'excluded',
      change: 'removed',
      size: null,
    });
    expect(state.project?.files.map((f) => f.path)).not.toContain('b.txt');
    expect(entry(state, 'c.txt')).toMatchObject({ policy: 'initial-only', change: 'added' });
    expect(entry(state, 'd.txt')).toMatchObject({ policy: 'initial-only', change: 'modified' });
    expect(state.files?.counts).toMatchObject({ added: 1, modified: 2, removed: 1 });
    expect(state.deploy).toMatchObject({
      status: 'changed',
      reasons: ['files'],
      changes: { added: 1, modified: 2, removed: 1 },
    });
  });
  it('detects a file deleted from the source and missing included files', async () => {
    const h = await harness();
    await h.include(['a.txt', 'b.txt'], 'always');
    await h.build();
    await rm(join(h.source, 'b.txt'));
    await h.s.request({ action: 'rescan' });
    const state = h.s.snapshot();
    expect(entry(state, 'b.txt')).toMatchObject({ missing: true, size: null, change: 'modified' });
    expect(state.files?.counts.missing).toBe(1);
    await h.s.request({ action: 'filesRemove', path: 'b.txt' });
    expect(entry(h.s.snapshot(), 'b.txt')).toMatchObject({ change: 'removed', size: null });
    expect(h.s.snapshot().deploy?.status).toBe('changed');
  });
  it('rejects reserved, unknown, malformed and unsafe paths in the bulk policy command', async () => {
    const h = await harness({ 'a.txt': 'a', 'options.txt': 'x', 'resourcepacks/p.zip': 'z' });
    const reply = async (paths: string[], policy: 'always' | 'initial-only' = 'always') =>
      h.s.request({ action: 'filesPolicy', paths, policy });
    expect(await reply(['options.txt'])).toEqual({ ok: false, code: 'INVALID' });
    expect(await reply(['resourcepacks/p.zip'])).toEqual({ ok: false, code: 'INVALID' });
    expect(await reply(['nope.txt'])).toEqual({ ok: false, code: 'INVALID' });
    expect(await reply(['../escape.txt'])).toEqual({ ok: false, code: 'INVALID' });
    expect(await reply(['/etc/passwd'])).toEqual({ ok: false, code: 'INVALID' });
    expect(await reply([])).toEqual({ ok: false, code: 'INVALID' });
    expect(await h.s.request({ action: 'filesPolicy', paths: ['a.txt'], policy: 'x' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(await h.s.request({ action: 'filesPolicy', paths: [1], policy: 'always' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(h.s.snapshot().project?.files).toEqual([]);
    expect(entry(h.s.snapshot(), 'options.txt').policy).toBe('managed');
  });
  it('does not list or follow links', async () => {
    const h = await harness({ 'a.txt': 'a' });
    const outside = join(h.root, 'outside.txt');
    await writeFile(outside, 'secret');
    await symlink(outside, join(h.source, 'link.txt'));
    await h.s.request({ action: 'rescan' });
    const state = h.s.snapshot();
    expect(state.files?.skipped).toBe(1);
    expect(state.files?.entries.map((e) => e.path)).toEqual(['a.txt']);
    expect(await h.include(['link.txt'], 'always')).toEqual({ ok: false, code: 'INVALID' });
  });
  it('keeps scanning state: reopening reloads files and diff immediately upToDate', async () => {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    await h.s.request({ action: 'save' });
    h.d.open.mockResolvedValueOnce([h.projDir]);
    await h.s.request({ action: 'open', discard: true });
    expect(h.s.snapshot().deploy?.status).toBe('upToDate');
    expect(h.s.snapshot().files?.counts.total).toBe(2);
  });
  it('marks game and branding differences as reasons and cannot be forged through update', async () => {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    await h.edit((p) => {
      p.game = { ...p.game, minecraftVersion: '1.21.2' };
    });
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'changed', reasons: ['game'] });
    const forged = parseProject(h.s.snapshot().project);
    if (!forged.lastBuild) throw new Error('missing lastBuild');
    forged.lastBuild = { ...forged.lastBuild, files: [] };
    expect(await h.s.request({ action: 'update', project: forged })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  });
});

describe('file targets, policies and deletion', () => {
  const rejected = { ok: false, code: 'INVALID' };
  const savedFiles = async (h: Awaited<ReturnType<typeof harness>>) =>
    decodeProjectFile(await readFile(join(h.projDir, PROJECT_FILE_NAME)), () => {
      throw new Error('no images expected');
    }).project.files;
  const target = (h: Awaited<ReturnType<typeof harness>>, path: string, targetPath: string) =>
    h.s.request({ action: 'filesTarget', path, targetPath });
  const readIndex = async (h: Awaited<ReturnType<typeof harness>>) =>
    openDeploymentReader(memorySource(await readFile(await h.build())), {
      expectedServerId: parseProject(h.s.snapshot().project).serverId,
    });

  it('retargets a source file; the index carries targetPath while the payload comes from the source path', async () => {
    const h = await harness({ 'a.txt': 'from source', 'b.txt': 'bbbb' });
    await h.include(['a.txt', 'b.txt'], 'always');
    expect((await target(h, 'a.txt', 'config/nested/renamed.cfg')).ok).toBe(true);
    expect(h.s.snapshot().project?.files).toEqual([
      { path: 'a.txt', targetPath: 'config/nested/renamed.cfg', policy: 'always' },
      { path: 'b.txt', targetPath: 'b.txt', policy: 'always' },
    ]);
    expect(entry(h.s.snapshot(), 'a.txt')).toMatchObject({
      targetPath: 'config/nested/renamed.cfg',
    });
    const reader = await readIndex(h);
    expect(reader.index.files.map((f) => f.path).sort()).toEqual([
      'b.txt',
      'config/nested/renamed.cfg',
    ]);
    await reader.stageFile('config/nested/renamed.cfg', join(h.root, 'staged'));
    expect(await readFile(join(h.root, 'staged'), 'utf8')).toBe('from source');
    // The record keeps both paths, and the diff follows the source path.
    expect(h.s.snapshot().project?.lastBuild?.files.map((f) => [f.sourcePath, f.path])).toEqual([
      ['a.txt', 'config/nested/renamed.cfg'],
      ['b.txt', 'b.txt'],
    ]);
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'upToDate', reasons: [] });
    await h.s.request({ action: 'rescan' });
    expect(entry(h.s.snapshot(), 'a.txt')).toMatchObject({ change: 'unchanged' });
    // Changing only the target is a change; changing it back is not.
    expect((await target(h, 'a.txt', 'other.cfg')).ok).toBe(true);
    expect(entry(h.s.snapshot(), 'a.txt')).toMatchObject({ change: 'modified' });
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'changed', reasons: ['files'] });
    expect((await target(h, 'a.txt', 'config/nested/renamed.cfg')).ok).toBe(true);
    expect(h.s.snapshot().deploy?.status).toBe('upToDate');
  });
  it('saves a target change automatically', async () => {
    const h = await harness({ 'a.txt': 'a' });
    await h.include(['a.txt'], 'always');
    await h.s.request({ action: 'save' });
    expect(await target(h, 'a.txt', 'x/a.txt')).toMatchObject({
      ok: true,
      state: { dirty: false },
    });
    expect(await savedFiles(h)).toEqual([
      { path: 'a.txt', targetPath: 'x/a.txt', policy: 'always' },
    ]);
  });
  it('rejects unsafe, duplicate, managed and unknown targets and leaves the project untouched', async () => {
    const h = await harness({ 'a.txt': 'a', 'b.txt': 'b', 'options.txt': 'o', 'sub/c.txt': 'c' });
    await h.include(['a.txt', 'b.txt', 'sub/c.txt'], 'always');
    const before = h.s.snapshot().project?.files;
    const bad = [
      '../escape.txt',
      '/etc/passwd',
      'C:/x.txt',
      'x\\y.txt',
      'a//b.txt',
      './a.txt',
      'dir/../a.txt',
      'dir/',
      '.torchlauncher/state',
      'a\u0000b',
      // managed destinations
      'options.txt',
      'OPTIONS.TXT',
      'mods/x.jar',
      'resourcepacks/x.zip',
      'shaderpacks/x.zip',
      'torchlauncher/settings-policy.json',
      // another file's target, also with different case
      'b.txt',
      'B.TXT',
      'sub/c.txt',
    ];
    for (const targetPath of bad)
      expect(await target(h, 'a.txt', targetPath), targetPath).toEqual(rejected);
    expect(await target(h, 'nope.txt', 'z.txt')).toEqual(rejected);
    // a managed or unlisted source cannot be retargeted
    expect(await target(h, 'options.txt', 'z.txt')).toEqual(rejected);
    expect(await h.s.request({ action: 'filesTarget', path: 'a.txt' })).toEqual(rejected);
    expect(await h.s.request({ action: 'filesTarget', path: 'a.txt', targetPath: 1 })).toEqual(
      rejected,
    );
    expect(await h.s.request({ action: 'filesTarget', path: '', targetPath: 'z' })).toEqual(
      rejected,
    );
    expect(h.s.snapshot().project?.files).toEqual(before);
    // A target equal to the file's own target is a no-op and stays valid.
    expect((await target(h, 'a.txt', 'a.txt')).ok).toBe(true);
  });
  it('does not retarget through a link or for a file that left the source folder', async () => {
    const h = await harness({ 'a.txt': 'a', 'b.txt': 'b' });
    await h.include(['a.txt', 'b.txt'], 'always');
    await rm(join(h.source, 'b.txt'));
    expect(await target(h, 'b.txt', 'moved.txt')).toEqual(rejected);
    await writeFile(join(h.root, 'outside.txt'), 'secret');
    await symlink(join(h.root, 'outside.txt'), join(h.source, 'link.txt'));
    expect(
      await h.s.request({ action: 'filesPolicy', paths: ['link.txt'], policy: 'always' }),
    ).toEqual(rejected);
    expect(await target(h, 'link.txt', 'x.txt')).toEqual(rejected);
  });
  it('rejects project files with a managed or duplicate source or target on load, with no legacy reader', async () => {
    const h = await harness({ 'a.txt': 'a' });
    const project = parseProject(h.s.snapshot().project);
    const withFiles = (files: unknown) => ({ ...project, files });
    const f = (path: string, targetPath: string) => ({ path, targetPath, policy: 'always' });
    expect(() => parseProject(withFiles([f('a.txt', 'a.txt')]))).not.toThrow();
    expect(() => parseProject(withFiles([f('a.txt', 'options.txt')]))).toThrow();
    expect(() => parseProject(withFiles([f('options.txt', 'x.txt')]))).toThrow();
    expect(() => parseProject(withFiles([f('mods/a.jar', 'a.jar')]))).toThrow();
    expect(() => parseProject(withFiles([f('a.txt', 'x.txt'), f('b.txt', 'X.txt')]))).toThrow();
    expect(() => parseProject(withFiles([f('a.txt', 'x.txt'), f('a.txt', 'y.txt')]))).toThrow();
    // earlier shapes: no targetPath, or the removed excluded policy
    expect(() => parseProject(withFiles([{ path: 'a.txt', policy: 'always' }]))).toThrow();
    expect(() =>
      parseProject(withFiles([{ path: 'a.txt', targetPath: 'a.txt', policy: 'excluded' }])),
    ).toThrow();
  });
  it('sets always and initial-only per file and carries them into the deployment', async () => {
    const h = await harness({ 'a.txt': 'a', 'b.txt': 'b' });
    expect((await h.add(['a.txt', 'b.txt'])).ok).toBe(true);
    expect(h.s.snapshot().project?.files.map((f) => f.policy)).toEqual(['always', 'always']);
    expect((await h.include(['b.txt'], 'initial-only')).ok).toBe(true);
    expect(
      await h.s.request({ action: 'filesPolicy', paths: ['a.txt'], policy: 'excluded' }),
    ).toEqual(rejected);
    const reader = await readIndex(h);
    expect(reader.index.files.map((f) => [f.path, f.policy])).toEqual([
      ['a.txt', 'always'],
      ['b.txt', 'initial-only'],
    ]);
    // Switching the policy alone is a change against the last build.
    await h.include(['b.txt'], 'always');
    expect(entry(h.s.snapshot(), 'b.txt')).toMatchObject({ policy: 'always', change: 'modified' });
  });
  it('does not set a policy for a file that is not in the project yet', async () => {
    const h = await harness({ 'a.txt': 'a' });
    expect(
      await h.s.request({ action: 'filesPolicy', paths: ['a.txt'], policy: 'always' }),
    ).toEqual(rejected);
  });
  it('deletes the entry and the file from files/ and saves automatically', async () => {
    const h = await harness({ 'a.txt': 'a', 'sub/b.txt': 'b' });
    await h.include(['a.txt', 'sub/b.txt'], 'always');
    await h.build();
    await h.s.request({ action: 'save' });
    const reply = await h.s.request({ action: 'filesRemove', path: 'sub/b.txt' });
    expect(reply).toMatchObject({ ok: true, state: { dirty: false } });
    expect(await readdir(join(h.source, 'sub'))).toEqual([]);
    expect(await readFile(join(h.source, 'a.txt'), 'utf8')).toBe('a');
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toEqual(['a.txt']);
    expect((await savedFiles(h)).map((f) => f.path)).toEqual(['a.txt']);
    expect(entry(h.s.snapshot(), 'sub/b.txt')).toMatchObject({ change: 'removed', size: null });
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'changed', reasons: ['files'] });
    // The file is gone, so a rescan never brings the entry back.
    await h.s.request({ action: 'rescan' });
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toEqual(['a.txt']);
    // Deleting a file that is already gone from disk still drops the entry.
    await rm(join(h.source, 'a.txt'));
    expect((await h.s.request({ action: 'filesRemove', path: 'a.txt' })).ok).toBe(true);
    expect(h.s.snapshot().project?.files).toEqual([]);
  });
  it('rejects deleting managed, unknown, unlisted and linked files and keeps them', async () => {
    const h = await harness({
      'a.txt': 'a',
      'unlisted.txt': 'u',
      'options.txt': 'o',
      'resourcepacks/p.zip': 'z',
    });
    await h.include(['a.txt'], 'always');
    for (const path of ['options.txt', 'resourcepacks/p.zip', 'unlisted.txt', 'nope.txt', '../x'])
      expect(await h.s.request({ action: 'filesRemove', path }), path).toEqual(rejected);
    expect(await h.s.request({ action: 'filesRemove', path: 1 })).toEqual(rejected);
    expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toBe('o');
    expect(await readFile(join(h.source, 'unlisted.txt'), 'utf8')).toBe('u');
    expect(await readFile(join(h.source, 'resourcepacks/p.zip'), 'utf8')).toBe('z');
    // a source replaced by a link is never followed or removed
    await writeFile(join(h.root, 'outside.txt'), 'secret');
    await rm(join(h.source, 'a.txt'));
    await symlink(join(h.root, 'outside.txt'), join(h.source, 'a.txt'));
    expect(await h.s.request({ action: 'filesRemove', path: 'a.txt' })).toEqual(rejected);
    expect(await readFile(join(h.root, 'outside.txt'), 'utf8')).toBe('secret');
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toEqual(['a.txt']);
  });
  it('keeps the removal and flags a failed automatic save', async () => {
    const h = await harness({ 'a.txt': 'a' });
    await h.include(['a.txt'], 'always');
    await rm(join(h.projDir, PROJECT_FILE_NAME));
    await mkdir(join(h.projDir, PROJECT_FILE_NAME));
    expect(await h.s.request({ action: 'filesRemove', path: 'a.txt' })).toMatchObject({
      ok: true,
      state: { dirty: true, result: { key: 'autosaveFailed' } },
    });
    expect(h.s.snapshot().project?.files).toEqual([]);
  });
  it('lists reconciled pack files as managed so the Files page does not show them, and keeps plain files out of managed paths', async () => {
    const h = await harness({ 'a.txt': 'a' });
    await h.include(['a.txt'], 'always');
    const zip = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('p')]);
    await mkdir(join(h.source, 'resourcepacks'), { recursive: true });
    await mkdir(join(h.source, 'mods'), { recursive: true });
    await writeFile(join(h.source, 'resourcepacks', 'rp.zip'), zip);
    await writeFile(join(h.source, 'mods', 'm.jar'), zip);
    await h.s.request({ action: 'rescan' });
    const settings = h.s.snapshot().project?.gameSettings;
    expect(settings?.resourcePacks.map((p) => p.name)).toEqual(['rp.zip']);
    expect(settings?.mods?.map((p) => [p.name, p.policy])).toEqual([['m.jar', 'required']]);
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toEqual(['a.txt']);
    const state = h.s.snapshot();
    expect(entry(state, 'resourcepacks/rp.zip')).toMatchObject({ policy: 'managed' });
    expect(entry(state, 'mods/m.jar')).toMatchObject({ policy: 'managed' });
    // Add-by-picker skips managed locations, and a target in them is refused.
    h.d.open.mockResolvedValueOnce([
      join(h.source, 'resourcepacks', 'rp.zip'),
      join(h.source, 'mods', 'm.jar'),
    ]);
    expect((await h.s.request({ action: 'files' })).ok).toBe(true);
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(await target(h, 'a.txt', 'resourcepacks/rp.zip')).toEqual(rejected);
    expect(await target(h, 'a.txt', 'mods/m.jar')).toEqual(rejected);
    const reader = await readIndex(h);
    expect(reader.index.files.map((f) => f.path).sort()).toEqual([
      'a.txt',
      'mods/m.jar',
      'resourcepacks/rp.zip',
      'torchlauncher/settings-policy.json',
    ]);
  });
  it('skips an external file whose name is a managed path without copying it', async () => {
    const h = await harness({});
    const outside = join(h.root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'options.txt'), 'o');
    h.d.open.mockResolvedValueOnce([join(outside, 'options.txt')]);
    expect((await h.s.request({ action: 'files' })).ok).toBe(true);
    expect(await readdir(h.source)).toEqual([]);
    expect(h.s.snapshot().project?.files).toEqual([]);
  });
});

describe('url check and export', () => {
  it.each([
    { action: 'export', target: 'darwin' },
    { action: 'export', allowCached: 'yes' },
    { action: 'export', cachedVersion: 12 },
    { action: 'export', binary: '/untrusted/path.exe' },
  ])('rejects invalid export arguments: %j', async (command) => {
    const h = await harness();
    expect(await h.s.request(command)).toEqual({ ok: false, code: 'INVALID' });
  });
  it('records a structured result per item', async () => {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    expect((await h.s.request({ action: 'check' })).ok).toBe(true);
    const check = h.s.snapshot().urlCheck;
    expect(check).toMatchObject({
      serverId: 'ok',
      game: 'ok',
      range: 'ok',
      deployment: 'current',
      stale: false,
      fileList: { state: 'ok', count: 1 },
    });
    expect(check?.remoteGame).toEqual(h.s.snapshot().project?.game);
    await h.edit((p) => {
      p.sourceUrl = 'https://example.org/other';
    });
    expect(h.s.snapshot().urlCheck?.stale).toBe(true);
  });
  it('reports a mismatching game, a different server and range failures without throwing away the detail', async () => {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    await h.edit((p) => {
      p.game = { ...p.game, loader: { kind: 'neoforge', version: '21.1.1' } };
    });
    expect(await h.s.request({ action: 'check' })).toEqual({ ok: false, code: 'MISMATCH' });
    expect(h.s.snapshot().urlCheck).toMatchObject({
      serverId: 'ok',
      game: 'mismatch',
      remoteGame: { loader: { kind: 'fabric' } },
    });
    h.remote.value = new RangeNotSupportedError('no ranges');
    expect(await h.s.request({ action: 'check' })).toEqual({ ok: false, code: 'IO' });
    expect(h.s.snapshot().urlCheck).toMatchObject({
      range: 'failed',
      fileList: { state: 'failed', count: null },
    });
    h.remote.value = new Error('offline');
    await h.s.request({ action: 'check' });
    expect(h.s.snapshot().urlCheck).toMatchObject({ range: 'unknown', serverId: 'unknown' });
    const other = await harness();
    await other.include(['a.txt'], 'always');
    await other.build();
    // Keep the key trusted so this exercises server identity rejection, not a key mismatch.
    const otherProject = parseProject(other.s.snapshot().project);
    const trusted = await other.s.testKeys.status(otherProject.serverId);
    vi.spyOn(h.s.testKeys, 'status').mockResolvedValue(trusted);
    h.remote.value = other.remote.value;
    await h.s.request({ action: 'check' });
    expect(h.s.snapshot().urlCheck).toMatchObject({ serverId: 'mismatch', game: 'unknown' });
  });
  async function exportReady() {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    const binary = join(h.root, 'Torch.exe');
    await writeFile(binary, 'MZ launcher');
    const zip = join(h.root, 'out.zip');
    return { ...h, binary, zip };
  }
  const reasons = (s: StudioService) =>
    Object.fromEntries((s.snapshot().export?.checks ?? []).map((c) => [c.id, c.reasons]));
  it('exports exactly one ZIP with the launcher and server config', async () => {
    const h = await exportReady();
    h.s.testLauncherPath = h.binary;
    h.d.save.mockResolvedValueOnce(h.zip);
    const openCalls = h.d.open.mock.calls.length;
    expect((await h.s.request({ action: 'export', target: 'windows' })).ok).toBe(true);
    expect(h.d.open).toHaveBeenCalledTimes(openCalls);
    expect((await readdir(h.root)).filter((n) => n.endsWith('.zip'))).toEqual(['out.zip']);
    expect((await readdir(h.root)).some((n) => n.startsWith('.torchstudio-'))).toBe(false);
    const zip = readZip(await readFile(h.zip));
    expect([...zip.keys()].sort()).toEqual(['Torch.exe', 'torchlauncher-server.json']);
    expect(zip.get('Torch.exe')?.data.toString()).toBe('MZ launcher');
    const state = h.s.snapshot();
    expect(state.export).toMatchObject({ blocked: false, done: { fileName: 'out.zip' } });
    expect(state.export?.done?.size).toBe((await readFile(h.zip)).length);
    expect((await h.s.request({ action: 'revealExport' })).ok).toBe(true);
    expect(h.d.reveal).toHaveBeenCalledWith(h.zip);
    expect((await h.s.request({ action: 'revealPack' })).ok).toBe(true);
  });
  it('writes only the present default memory fields and never needs a rebuild for them', async () => {
    const h = await exportReady();
    h.s.testLauncherPath = h.binary;
    const exported = async (name: string) => {
      const destination = join(h.root, name);
      h.d.save.mockResolvedValueOnce(destination);
      expect((await h.s.request({ action: 'export', target: 'windows' })).ok).toBe(true);
      const zip = readZip(await readFile(destination));
      return JSON.parse(zip.get('torchlauncher-server.json')?.data.toString('utf8') ?? '');
    };
    // New projects start with Xmx 2 GB and no Xms.
    expect((await exported('default.zip')).memory).toEqual({ maxMiB: 2048 });
    const packBefore = h.s.snapshot().project?.lastBuild;
    expect(
      (
        await h.edit((p) => {
          p.memory = { maxMiB: 4096, initialMiB: 1024 };
        })
      ).ok,
    ).toBe(true);
    // Memory is server-config only: deployment and export checks stay ready.
    expect(h.s.snapshot().export?.blocked).toBe(false);
    expect(h.s.snapshot().project?.lastBuild).toEqual(packBefore);
    expect((await exported('both.zip')).memory).toEqual({ maxMiB: 4096, initialMiB: 1024 });
    expect(
      (
        await h.edit((p) => {
          delete p.memory;
        })
      ).ok,
    ).toBe(true);
    expect(await exported('none.zip')).not.toHaveProperty('memory');
    for (const memory of [
      { maxMiB: 511 },
      { maxMiB: 2048, initialMiB: 4096 },
      { maxMiB: 2048, initialMiB: 255 },
      { initialMiB: 1024 },
      { maxMiB: 2048, extra: 1 },
    ])
      expect(
        (
          await h.edit((p) => {
            (p as { memory?: unknown }).memory = memory;
          })
        ).ok,
      ).toBe(false);
  });
  it('blocks with a structured reason before asking for any file', async () => {
    const h = await exportReady();
    const attempt = async () => {
      h.d.open.mockClear();
      h.d.save.mockClear();
      const reply = await h.s.request({ action: 'export' });
      expect(h.d.open).not.toHaveBeenCalled();
      expect(h.d.save).not.toHaveBeenCalled();
      return reply;
    };
    // files changed since the build
    await writeFile(join(h.source, 'a.txt'), 'CHANGED');
    expect(await attempt()).toEqual({ ok: false, code: 'BLOCKED' });
    expect(reasons(h.s)).toMatchObject({
      deployment: ['deployment-changed'],
      url: [],
      serverId: [],
    });
    expect(h.s.snapshot().export?.blocked).toBe(true);
    // the public pack is the previous deployment
    await writeFile(join(h.source, 'a.txt'), 'aaaa');
    const old = h.remote.value;
    await h.build('second.torchpack');
    h.remote.value = old;
    expect(await attempt()).toEqual({ ok: false, code: 'BLOCKED' });
    expect(reasons(h.s).deployment).toEqual(['deployment-outdated']);
    // game environment differs
    h.remote.value = await readFile(join(h.root, 'second.torchpack'));
    await h.edit((p) => {
      p.game = { ...p.game, minecraftVersion: '1.21.2' };
    });
    expect(await attempt()).toEqual({ ok: false, code: 'BLOCKED' });
    expect(reasons(h.s).game).toEqual(['game']);
    // unreachable / no range support / other server
    h.remote.value = new RangeNotSupportedError('x');
    expect(await attempt()).toEqual({ ok: false, code: 'BLOCKED' });
    expect(reasons(h.s).url).toEqual(['range']);
    h.remote.value = new Error('offline');
    await attempt();
    expect(reasons(h.s).url).toEqual(['url-failed']);
    const other = await harness();
    await other.include(['a.txt'], 'always');
    await other.build();
    // Keep the key trusted so this exercises server identity rejection, not a key mismatch.
    const otherProject = parseProject(other.s.snapshot().project);
    const trusted = await other.s.testKeys.status(otherProject.serverId);
    vi.spyOn(h.s.testKeys, 'status').mockResolvedValue(trusted);
    h.remote.value = other.remote.value;
    await attempt();
    expect(reasons(h.s).serverId).toEqual(['server-id']);
    await expect(readdir(h.root)).resolves.not.toContain('out.zip');
  });
  it('blocks when the project was never built, and exportCheck evaluates without network', async () => {
    const h = await harness();
    await h.s.request({ action: 'exportCheck' });
    expect(reasons(h.s)).toMatchObject({
      deployment: ['no-deployment'],
      url: ['url-unchecked'],
      serverId: ['url-unchecked'],
    });
    expect(await h.s.request({ action: 'export' })).toEqual({ ok: false, code: 'BLOCKED' });
    expect(reasons(h.s).deployment).toEqual(['no-deployment']);
  });
  it('leaves nothing behind when export is interrupted or the launcher is invalid', async () => {
    const h = await exportReady();
    await writeFile(h.zip, 'previous export');
    h.s.testLauncherPath = h.binary;
    h.d.save.mockResolvedValueOnce(h.zip);
    await truncate(h.binary, 0);
    await writeFile(h.binary, 'not a launcher');
    expect(await h.s.request({ action: 'export' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await readFile(h.zip, 'utf8')).toBe('previous export');
    expect((await readdir(h.root)).some((n) => n.startsWith('.torchstudio-'))).toBe(false);
  });
});

describe('zip writer', () => {
  it('rejects traversal, absolute, backslash, duplicate and non-zip targets', async () => {
    const root = await temp();
    const signal = new AbortController().signal;
    const ok = (name: string) => ({ name, mode: 0o644, data: Buffer.from('x') });
    for (const name of ['../x', '/abs', 'a//b', 'a\\b', 'C:x', 'a/./b', 'a/', '', 'x\u0000y'])
      await expect(writeZip(join(root, 'o.zip'), [ok(name)], signal)).rejects.toMatchObject({
        code: 'INVALID',
      });
    await expect(
      writeZip(join(root, 'o.zip'), [ok('A.txt'), ok('a.TXT')], signal),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(writeZip(join(root, 'o.bin'), [ok('a')], signal)).rejects.toMatchObject({
      code: 'INVALID',
    });
    await expect(writeZip(join(root, 'o.zip'), [], signal)).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(await readdir(root)).toEqual([]);
  });
  it('round-trips deflated and stored entries with modes and unicode names', async () => {
    const root = await temp();
    const file = join(root, 'big.bin');
    const content = Buffer.from('0123456789'.repeat(300_000));
    await writeFile(file, content);
    await writeZip(
      join(root, 'o.zip'),
      [
        { name: 'big.bin', mode: 0o755, path: file, maxSize: 10_000_000 },
        { name: '설정/서버.json', mode: 0o644, data: Buffer.from('{"a":1}'.repeat(100)) },
      ],
      new AbortController().signal,
    );
    const zip = readZip(await readFile(join(root, 'o.zip')));
    expect(zip.get('big.bin')).toMatchObject({ mode: 0o755, method: 0 });
    expect(zip.get('big.bin')?.data.equals(content)).toBe(true);
    expect(zip.get('설정/서버.json')?.method).toBe(8);
  });
  it('refuses oversized, linked and missing sources without leaving files', async () => {
    const root = await temp();
    const file = join(root, 'f.bin');
    await writeFile(file, Buffer.alloc(100));
    const link = join(root, 'l.bin');
    await symlink(file, link);
    const signal = new AbortController().signal;
    await expect(
      writeZip(join(root, 'o.zip'), [{ name: 'f', mode: 0o644, path: file, maxSize: 99 }], signal),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      writeZip(join(root, 'o.zip'), [{ name: 'f', mode: 0o644, path: link, maxSize: 999 }], signal),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      writeZip(
        join(root, 'o.zip'),
        [{ name: 'f', mode: 0o644, path: join(root, 'missing'), maxSize: 999 }],
        signal,
      ),
    ).rejects.toBeDefined();
    expect((await readdir(root)).sort()).toEqual(['f.bin', 'l.bin']);
  });
  it('removes the temporary file and keeps an existing target when aborted mid-write', async () => {
    const root = await temp();
    const file = join(root, 'f.bin');
    await writeFile(file, Buffer.alloc(3 * 1024 * 1024, 7));
    await writeFile(join(root, 'o.zip'), 'old');
    const controller = new AbortController();
    await expect(
      writeZip(
        join(root, 'o.zip'),
        [{ name: 'f', mode: 0o644, path: file, maxSize: 1e9 }],
        controller.signal,
        (bytes) => {
          if (bytes > 2 * 1024 * 1024) controller.abort();
        },
      ),
    ).rejects.toBeDefined();
    expect((await readdir(root)).sort()).toEqual(['f.bin', 'o.zip']);
    expect(await readFile(join(root, 'o.zip'), 'utf8')).toBe('old');
  });
});

describe('in-app discard confirmation', () => {
  it('requires an explicit discard flag only for dirty projects and validates its shape', async () => {
    const h = await harness();
    expect(await h.s.request({ action: 'new', name: 'n' })).toEqual({
      ok: false,
      code: 'UNSAVED',
    });
    expect(await h.s.request({ action: 'new', name: 'n', discard: 'yes' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(await h.s.request({ action: 'new', name: 'n', discard: true, x: 1 })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    const dir1 = await temp();
    h.d.open.mockResolvedValueOnce([dir1]);
    expect((await h.s.request({ action: 'new', name: 'one', discard: true })).ok).toBe(true);
    await h.s.request({ action: 'touch' });
    expect(h.s.snapshot().dirty).toBe(true);
    await h.s.request({ action: 'save' });
    expect(h.s.snapshot().dirty).toBe(false);
    const dir2 = await temp();
    h.d.open.mockResolvedValueOnce([dir2]);
    expect((await h.s.request({ action: 'new', name: 'two' })).ok).toBe(true);
  });
  it('answers a close request only when main asked, and never closes on its own for dirty projects', async () => {
    const h = await harness();
    const confirm = vi.fn();
    const cancel = vi.fn();
    h.s.onCloseAnswer({ confirm, cancel });
    expect(await h.s.request({ action: 'closeConfirm' })).toEqual({ ok: false, code: 'INVALID' });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.s.beginClose()).toBe(false);
    expect((await h.s.request({ action: 'closeCancel' })).ok).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await h.s.request({ action: 'closeConfirm' })).toEqual({ ok: false, code: 'INVALID' });
    expect(h.s.beginClose()).toBe(false);
    h.s.abandonClose();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(h.s.beginClose()).toBe(false);
    expect((await h.s.request({ action: 'closeConfirm' })).ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    const clean = new StudioService({ open: vi.fn(), save: vi.fn() });
    expect(clean.beginClose()).toBe(true);
  });
  it('accepts save and the close answers while a close request is outstanding', async () => {
    const h = await harness();
    const confirm = vi.fn();
    h.s.onCloseAnswer({ confirm, cancel: vi.fn() });
    await h.s.close();
    expect(await h.s.request({ action: 'save' })).toEqual({ ok: false, code: 'BUSY' });
    h.s.resume();
    await h.s.close();
    expect(h.s.beginClose()).toBe(false);
    h.d.save.mockResolvedValueOnce(join(h.root, 'p.torchproj'));
    expect((await h.s.request({ action: 'save' })).ok).toBe(true);
    expect(h.s.snapshot().dirty).toBe(false);
    expect((await h.s.request({ action: 'closeConfirm' })).ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
