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
import { RangeNotSupportedError } from '../../../../packages/core/src/download/http/range-client.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import type { StudioFileEntry, StudioState } from '../shared/studio.js';
import { readZip } from './fixtures/zip.js';
import { parseProject } from './project.js';
import { type StudioDialogs, StudioService } from './studio.js';
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
  const source = join(root, 'source');
  await mkdir(source);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), content);
  }
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
    discard: vi.fn<StudioDialogs['discard']>().mockResolvedValue(true),
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
  await s.request({ action: 'new' });
  d.open.mockResolvedValueOnce([source]);
  await s.request({ action: 'source' });
  const include = async (paths: string[], policy: 'always' | 'initial-only' | 'excluded') =>
    s.request({ action: 'filesPolicy', paths, policy });
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
  return { root, source, d, s, remote, include, edit, build };
}
const entry = (state: StudioState, path: string): StudioFileEntry => {
  const found = state.files?.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no entry ${path}`);
  return found;
};

describe('files diff against the last build', () => {
  it('lists source files as excluded until included, with no change marks before a first build', async () => {
    const h = await harness({ 'a.txt': 'aaaa', 'sub/b.txt': 'bb' });
    const state = h.s.snapshot();
    expect(state.files?.counts).toMatchObject({ total: 2, excluded: 2, added: 0 });
    expect(entry(state, 'a.txt')).toMatchObject({ policy: 'excluded', change: null, size: 4 });
    expect(state.deploy).toMatchObject({ status: 'none', lastBuild: null });
    expect((await h.include(['a.txt', 'sub/b.txt'], 'always')).ok).toBe(true);
    expect(h.s.snapshot().files?.counts).toMatchObject({ excluded: 0, total: 2 });
    expect(h.s.snapshot().project?.files).toEqual([
      { path: 'a.txt', policy: 'always' },
      { path: 'sub/b.txt', policy: 'always' },
    ]);
  });
  it('reports added, modified (same size), policy-modified, removed and excluded correctly', async () => {
    const h = await harness({ 'a.txt': 'aaaa', 'b.txt': 'bbbb', 'c.txt': 'cccc', 'd.txt': 'dddd' });
    await h.include(['a.txt', 'b.txt', 'd.txt'], 'always');
    await h.build();
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'upToDate', reasons: [] });
    expect(h.s.snapshot().project?.version).toBe(2);
    // same size, different bytes -> modified; touching without changing bytes -> unchanged
    await writeFile(join(h.source, 'a.txt'), 'AAAA');
    await writeFile(join(h.source, 'b.txt'), 'bbbb');
    await h.include(['c.txt'], 'initial-only');
    await h.include(['d.txt'], 'initial-only');
    await h.include(['b.txt'], 'excluded');
    await h.s.request({ action: 'rescan' });
    const state = h.s.snapshot();
    expect(entry(state, 'a.txt')).toMatchObject({ policy: 'always', change: 'modified' });
    expect(entry(state, 'b.txt')).toMatchObject({ policy: 'excluded', change: 'removed' });
    expect(entry(state, 'c.txt')).toMatchObject({ policy: 'initial-only', change: 'added' });
    expect(entry(state, 'd.txt')).toMatchObject({ policy: 'initial-only', change: 'modified' });
    expect(state.files?.counts).toMatchObject({ added: 1, modified: 2, removed: 1, excluded: 1 });
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
    await h.include(['b.txt'], 'excluded');
    expect(entry(h.s.snapshot(), 'b.txt')).toMatchObject({ change: 'removed', size: null });
    expect(h.s.snapshot().deploy?.status).toBe('changed');
  });
  it('rejects reserved, unknown, malformed and unsafe paths in the bulk policy command', async () => {
    const h = await harness({ 'a.txt': 'a', 'options.txt': 'x', 'resourcepacks/p.zip': 'z' });
    const reply = async (paths: string[], policy: 'always' | 'excluded' = 'always') =>
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
  it('keeps scanning state separate: reopening drops files and diff until a source is chosen', async () => {
    const h = await harness();
    await h.include(['a.txt'], 'always');
    await h.build();
    const projectPath = join(h.root, 'p.json');
    h.d.save.mockResolvedValueOnce(projectPath);
    await h.s.request({ action: 'save' });
    h.d.open.mockResolvedValueOnce([projectPath]);
    await h.s.request({ action: 'open' });
    expect(h.s.snapshot().files).toBeNull();
    expect(h.s.snapshot().deploy).toMatchObject({ status: 'unknown', lastBuild: { fileCount: 1 } });
    h.d.open.mockResolvedValueOnce([h.source]);
    await h.s.request({ action: 'source' });
    expect(h.s.snapshot().deploy?.status).toBe('upToDate');
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

describe('url check and export', () => {
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
    h.d.open.mockResolvedValueOnce([h.binary]);
    h.d.save.mockResolvedValueOnce(h.zip);
    expect((await h.s.request({ action: 'export' })).ok).toBe(true);
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
    h.d.open.mockResolvedValueOnce([h.binary]);
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
