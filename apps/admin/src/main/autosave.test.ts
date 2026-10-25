import { link, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectAt } from './fixtures/projects.js';
import { StudioService } from './fixtures/signing.js';
import { PACK_LIMIT } from './game-settings.js';
import { decodeProjectFile } from './project-file.js';
import { PROJECT_DATA_DIR, PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const zipBytes = (extra = '') =>
  Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from(extra)]);

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'autosave-'));
  roots.push(base);
  const root = join(base, 'proj');
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
  };
  const s = new StudioService(d);
  await createProjectAt(s, d, root);
  const source = join(root, PROJECT_DATA_DIR);
  const picked = join(base, 'picked');
  await mkdir(picked);
  const pick = async (name: string, content = 'x') => {
    await writeFile(join(picked, name), zipBytes(content));
    return join(picked, name);
  };
  const add = async (kind: 'mod' | 'resourcepack' | 'shaderpack', name: string) => {
    d.open.mockResolvedValueOnce([await pick(name)]);
    return s.request({ action: 'settingsPackAdd', kind });
  };
  const onDisk = async () =>
    decodeProjectFile(await readFile(join(root, PROJECT_FILE_NAME)), () => {
      throw new Error('no images expected');
    }).project;
  const reopen = async () => {
    const fresh = new StudioService(d);
    d.open.mockResolvedValueOnce([root]);
    expect(await fresh.request({ action: 'open' })).toMatchObject({ ok: true });
    return fresh;
  };
  return { base, root, source, d, s, pick, add, onDisk, reopen };
}
const names = (list: { name: string }[] | undefined) => list?.map((p) => p.name);

describe('automatic save after file adds', () => {
  it('persists an added mod without save and leaves the project clean', async () => {
    const h = await setup();
    const reply = await h.add('mod', 'a.jar');
    expect(reply).toMatchObject({ ok: true, state: { dirty: false } });
    expect(h.s.snapshot().dirty).toBe(false);
    expect((await h.onDisk()).gameSettings?.mods?.map((m) => [m.name, m.policy])).toEqual([
      ['a.jar', 'required'],
    ]);
    const fresh = await h.reopen();
    expect(names(fresh.snapshot().project?.gameSettings?.mods)).toEqual(['a.jar']);
  });

  it('also saves other pending edits', async () => {
    const h = await setup();
    await h.s.request({ action: 'brandingName', appName: 'Pending Name' });
    expect(h.s.snapshot().dirty).toBe(true);
    await h.add('mod', 'a.jar');
    expect(h.s.snapshot().dirty).toBe(false);
    expect((await h.onDisk()).branding?.appName).toBe('Pending Name');
  });

  it('persists resource and shader packs and keeps their first-install policy', async () => {
    const h = await setup();
    await h.add('resourcepack', 'r.zip');
    await h.add('shaderpack', 's.zip');
    expect(h.s.snapshot().dirty).toBe(false);
    const saved = (await h.onDisk()).gameSettings;
    expect(saved?.resourcePacks.map((p) => [p.name, p.policy])).toEqual([['r.zip', 'initial']]);
    expect(saved?.shaderPacks.map((p) => [p.name, p.policy])).toEqual([['s.zip', 'initial']]);
  });

  it('persists a pack removal (and removes the file so it cannot reappear)', async () => {
    const h = await setup();
    await h.add('mod', 'a.jar');
    await h.add('mod', 'b.jar');
    expect(
      await h.s.request({ action: 'settingsPackRemove', kind: 'mod', name: 'a.jar' }),
    ).toMatchObject({ ok: true, state: { dirty: false } });
    expect(names((await h.onDisk()).gameSettings?.mods)).toEqual(['b.jar']);
    const fresh = await h.reopen();
    expect(names(fresh.snapshot().project?.gameSettings?.mods)).toEqual(['b.jar']);
  });

  it('persists a Files page add', async () => {
    const h = await setup();
    await writeFile(join(h.base, 'extra.txt'), 'hello');
    h.d.open.mockResolvedValueOnce([join(h.base, 'extra.txt')]);
    expect(await h.s.request({ action: 'files' })).toMatchObject({
      ok: true,
      state: { dirty: false },
    });
    expect((await h.onDisk()).files.map((f) => f.path)).toContain('extra.txt');
  });

  it('keeps the list and the dirty flag when the automatic save fails, and says so', async () => {
    const h = await setup();
    // A directory in place of project.torchproj makes the atomic write refuse.
    await rm(join(h.root, PROJECT_FILE_NAME));
    await mkdir(join(h.root, PROJECT_FILE_NAME));
    const reply = await h.add('mod', 'a.jar');
    expect(reply).toMatchObject({
      ok: true,
      state: { dirty: true, result: { key: 'packsAdded', added: 1, saveFailed: true } },
    });
    expect(names(h.s.snapshot().project?.gameSettings?.mods)).toEqual(['a.jar']);
    // The same failure on a Files add is reported as its own result, the add itself stays.
    await writeFile(join(h.base, 'extra.txt'), 'hello');
    h.d.open.mockResolvedValueOnce([join(h.base, 'extra.txt')]);
    expect(await h.s.request({ action: 'files' })).toMatchObject({
      ok: true,
      state: { dirty: true, result: { key: 'autosaveFailed' } },
    });
    expect(h.s.snapshot().project?.files.map((f) => f.path)).toContain('extra.txt');
  });

  it('does not save when the add is cancelled', async () => {
    const h = await setup();
    h.d.open.mockResolvedValueOnce(null);
    expect(await h.s.request({ action: 'settingsPackAdd', kind: 'mod' })).toMatchObject({
      ok: false,
    });
    expect(h.s.snapshot().dirty).toBe(false);
    expect((await h.onDisk()).gameSettings).toBeUndefined();
  });
});

describe('reconcile project files', () => {
  const drop = async (h: Awaited<ReturnType<typeof setup>>, dir: string, name: string) => {
    await mkdir(join(h.source, dir), { recursive: true });
    await writeFile(join(h.source, dir, name), zipBytes(name));
  };
  it('lists hand-dropped valid files on open without marking the project dirty', async () => {
    const h = await setup();
    await h.add('mod', 'listed.jar');
    await h.s.request({ action: 'brandingName', appName: null });
    await h.s.request({ action: 'save' });
    await drop(h, 'mods', 'zeta.jar');
    await drop(h, 'mods', 'Alpha.jar');
    await drop(h, 'resourcepacks', 'rp.zip');
    await drop(h, 'shaderpacks', 'sh.zip');
    const fresh = await h.reopen();
    const settings = fresh.snapshot().project?.gameSettings;
    // Existing first, then the new ones sorted by name.
    expect(settings?.mods?.map((m) => [m.name, m.policy])).toEqual([
      ['listed.jar', 'required'],
      ['Alpha.jar', 'required'],
      ['zeta.jar', 'required'],
    ]);
    expect(settings?.resourcePacks.map((p) => [p.name, p.policy])).toEqual([['rp.zip', 'initial']]);
    expect(settings?.shaderPacks.map((p) => [p.name, p.policy])).toEqual([['sh.zip', 'initial']]);
    expect(fresh.snapshot().dirty).toBe(false);
    // Hash and length come from the file.
    const zeta = settings?.mods?.find((m) => m.name === 'zeta.jar');
    expect(zeta?.length).toBe(zipBytes('zeta.jar').length);
    expect(zeta?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips invalid files without failing the open', async () => {
    const h = await setup();
    await mkdir(join(h.source, 'mods'), { recursive: true });
    await writeFile(join(h.source, 'mods', 'plain.jar'), 'not a zip');
    await writeFile(join(h.source, 'mods', 'wrong.txt'), zipBytes());
    await writeFile(join(h.source, 'mods', 'wrong.zip'), zipBytes());
    await writeFile(join(h.source, 'mods', 'bad..name.jar'), zipBytes());
    await writeFile(join(h.base, 'outside.jar'), zipBytes('o'));
    await symlink(join(h.base, 'outside.jar'), join(h.source, 'mods', 'link.jar'));
    await link(join(h.base, 'outside.jar'), join(h.source, 'mods', 'hard.jar'));
    await mkdir(join(h.source, 'mods', 'dir.jar'));
    await writeFile(join(h.source, 'mods', 'big.jar'), zipBytes());
    await truncate(join(h.source, 'mods', 'big.jar'), PACK_LIMIT + 1);
    await drop(h, 'mods', 'good.jar');
    const fresh = await h.reopen();
    expect(names(fresh.snapshot().project?.gameSettings?.mods)).toEqual(['good.jar']);
    expect(fresh.snapshot().dirty).toBe(false);
  });

  it('keeps entries whose file is missing and preserves policies', async () => {
    const h = await setup();
    await h.add('resourcepack', 'keep.zip');
    await h.s.request({
      action: 'settingsPackPolicy',
      kind: 'resourcepack',
      name: 'keep.zip',
      policy: 'required',
    });
    await h.s.request({ action: 'save' });
    await rm(join(h.source, 'resourcepacks', 'keep.zip'));
    await drop(h, 'resourcepacks', 'new.zip');
    const fresh = await h.reopen();
    expect(
      fresh.snapshot().project?.gameSettings?.resourcePacks.map((p) => [p.name, p.policy]),
    ).toEqual([
      ['keep.zip', 'required'],
      ['new.zip', 'initial'],
    ]);
  });

  it('does nothing for a project without pack files', async () => {
    const h = await setup();
    const fresh = await h.reopen();
    expect(fresh.snapshot().project?.gameSettings).toBeUndefined();
    expect(fresh.snapshot().dirty).toBe(false);
  });

  it('picks up a file dropped while running on rescan, keeping an existing dirty flag', async () => {
    const h = await setup();
    await h.s.request({ action: 'touch' });
    await drop(h, 'mods', 'late.jar');
    expect(await h.s.request({ action: 'rescan' })).toMatchObject({ ok: true });
    expect(names(h.s.snapshot().project?.gameSettings?.mods)).toEqual(['late.jar']);
    expect(h.s.snapshot().dirty).toBe(true);
    await h.s.request({ action: 'save' });
    const clean = await h.reopen();
    expect(names(clean.snapshot().project?.gameSettings?.mods)).toEqual(['late.jar']);
  });

  it('rescan alone does not dirty a clean project', async () => {
    const h = await setup();
    await drop(h, 'mods', 'late.jar');
    await h.s.request({ action: 'rescan' });
    expect(h.s.snapshot().dirty).toBe(false);
  });
});
