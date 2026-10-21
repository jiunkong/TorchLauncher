import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applySettingsPolicy, getResourcePacks, SettingsError } from './index.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/options-1.21.1.txt');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function setup(policy: unknown, options?: Buffer | string) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'torch-profile-'));
  roots.push(dir);
  await mkdir(join(dir, 'torchlauncher'), { recursive: true });
  await writeFile(join(dir, 'torchlauncher/settings-policy.json'), JSON.stringify(policy));
  await writeFile(join(dir, 'options.txt'), options ?? (await readFile(fixture)));
  return dir;
}
const base = { version: 1, file: 'options.txt' };
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof SettingsError) return e.code;
    throw e;
  }
  return 'none';
}

describe('real Minecraft 1.21.1 options.txt (data version 3955)', () => {
  it('fixture is the untouched client file', async () => {
    const raw = await readFile(fixture, 'latin1');
    expect(raw.startsWith('version:3955\r\n')).toBe(true);
    expect(raw.split('\r\n')).toHaveLength(141);
    expect(raw).toContain('resourcePacks:[]\r\n');
  });

  it('does not write when the policy is already satisfied', async () => {
    const dir = await setup({
      ...base,
      required: { autoJump: 'false', 'key_key.jump': 'key.keyboard.space' },
    });
    const before = await readFile(join(dir, 'options.txt'));
    const result = await applySettingsPolicy(dir);
    expect(result.optionsChanged).toBe(false);
    expect(result.formatProfile).toBe('java-1.21.1');
    expect(await readFile(join(dir, 'options.txt'))).toEqual(before);
  });

  it('changes only the targeted lines and keeps CRLF, order and the version line', async () => {
    const dir = await setup({
      ...base,
      required: { renderDistance: '16', brandNew: 'x' },
      initial: { soundCategory_music: '0.2', newInitial: 'y' },
      resourcePacks: { required: ['file/server.zip'] },
    });
    const original = (await readFile(fixture, 'utf8')).split('\r\n');
    const result = await applySettingsPolicy(dir);
    expect(result.resourcePacks.added).toEqual(['file/server.zip']);
    const out = (await readFile(join(dir, 'options.txt'), 'utf8')).split('\r\n');
    expect(out[0]).toBe('version:3955');
    expect(out).toHaveLength(original.length + 2); // two keys appended before the final empty element
    const expected = original.map((l) =>
      l.startsWith('renderDistance:')
        ? 'renderDistance:16'
        : l === 'resourcePacks:[]'
          ? 'resourcePacks:["file/server.zip"]'
          : l,
    );
    expected.splice(expected.length - 1, 0, 'brandNew:x', 'newInitial:y');
    expect(out).toEqual(expected);
    expect(await readFile(join(dir, 'options.txt'), 'utf8')).not.toMatch(/[^\r]\n/);
    // Idempotent.
    const before = await readFile(join(dir, 'options.txt'));
    const again = await applySettingsPolicy(dir);
    expect(again.optionsChanged).toBe(false);
    expect(await readFile(join(dir, 'options.txt'))).toEqual(before);
    const packs = await getResourcePacks(dir);
    expect(packs.packs).toEqual([{ id: 'file/server.zip', required: true }]);
  });

  it('absent resourcePacks defaults to an empty list without vanilla', async () => {
    const dir = await setup(
      { ...base, resourcePacks: { required: ['file/a.zip'] } },
      'version:3955\r\nfov:0.5\r\n',
    );
    await applySettingsPolicy(dir);
    expect(await readFile(join(dir, 'options.txt'), 'utf8')).toBe(
      'version:3955\r\nfov:0.5\r\nresourcePacks:["file/a.zip"]\r\n',
    );
  });
});

describe('format profile selection', () => {
  const pol = { ...base, required: { a: '1' } };
  it('rejects unknown or unsupported data versions without touching the file', async () => {
    for (const v of ['1343', 'abc', '4080', '5023']) {
      const text = `version:${v}\r\nx:1\r\n`;
      const dir = await setup(pol, text);
      expect(await code(applySettingsPolicy(dir))).toBe('unsupported-options-version');
      expect(await readFile(join(dir, 'options.txt'), 'utf8')).toBe(text);
    }
  });
  it('researched profiles need an opt-in and report a warning', async () => {
    const text = 'version:3837\nx:1\n';
    const dir = await setup(pol, text);
    expect(await code(applySettingsPolicy(dir))).toBe('unsupported-options-version');
    const result = await applySettingsPolicy(dir, { versionPolicy: 'allow-researched' });
    expect(result.formatProfile).toBe('java-1.13-1.21');
    expect(result.warnings.length).toBe(1);
  });
  it('allow-any applies versions beyond the researched range with the newest layout and a warning', async () => {
    const dir = await setup(pol, 'version:5024\nx:1\n');
    expect(await code(applySettingsPolicy(dir, { versionPolicy: 'allow-researched' }))).toBe(
      'unsupported-options-version',
    );
    const result = await applySettingsPolicy(dir, { versionPolicy: 'allow-any' });
    expect(result.formatProfile).toBe('java-1.21.2+');
    expect(result.warnings[0]).toContain('5024');
    expect(await readFile(join(dir, 'options.txt'), 'utf8')).toBe('version:5024\nx:1\na:1\n');
  });
  // Research-based (no real files): data versions 3956-5023 = 1.21.2 .. 26.3.
  it('researched java-1.21.2+ profile covers 3956-5023 and needs an opt-in', async () => {
    for (const v of ['3956', '4080', '4325', '4671', '4786', '5023']) {
      const text = `version:${v}\r\nx:1\r\n`;
      const dir = await setup(pol, text);
      expect(await code(applySettingsPolicy(dir))).toBe('unsupported-options-version');
      expect(await readFile(join(dir, 'options.txt'), 'utf8')).toBe(text);
      const r = await applySettingsPolicy(dir, { versionPolicy: 'allow-researched' });
      expect(r.formatProfile).toBe('java-1.21.2+');
      expect(r.warnings.length).toBe(1);
      expect(await readFile(join(dir, 'options.txt'), 'utf8')).toBe(`${text}a:1\r\n`);
    }
  });
  it('java-1.21.2+ keeps named key codes and the 3955 profile stays separate', async () => {
    const d = await setup({ ...base, required: { 'key_key.jump': '57' } }, 'version:4080\n');
    expect(await code(applySettingsPolicy(d, { versionPolicy: 'allow-researched' }))).toBe(
      'invalid-policy',
    );
    const ok = await setup(
      { ...base, required: { 'key_key.jump': 'key.keyboard.space' } },
      'version:5023\n',
    );
    expect(
      (await applySettingsPolicy(ok, { versionPolicy: 'allow-researched' })).formatProfile,
    ).toBe('java-1.21.2+');
    const v = await setup(pol, 'version:3955\nx:1\n');
    expect((await applySettingsPolicy(v)).formatProfile).toBe('java-1.21.1');
  });
  it('selects java-1.21.2+ from the caller version and rejects mismatches', async () => {
    const dir = await setup(pol, 'x:1\n');
    expect(await code(applySettingsPolicy(dir, { minecraftVersion: '26.3' }))).toBe(
      'unsupported-options-version',
    );
    const r = await applySettingsPolicy(dir, {
      minecraftVersion: '26.3',
      versionPolicy: 'allow-researched',
    });
    expect(r.formatProfile).toBe('java-1.21.2+');
    const mism = await setup(pol, 'version:4080\nx:1\n');
    expect(
      await code(
        applySettingsPolicy(mism, {
          minecraftVersion: '1.21.1',
          versionPolicy: 'allow-researched',
        }),
      ),
    ).toBe('unsupported-options-version');
    expect(
      await code(
        applySettingsPolicy(mism, {
          minecraftVersion: '1.21.11',
          versionPolicy: 'allow-researched',
        }),
      ),
    ).toBe('none');
  });
  it('uses the caller Minecraft version only when the file has no version line', async () => {
    const dir = await setup(pol, 'x:1\n');
    expect(await code(applySettingsPolicy(dir, { minecraftVersion: '1.12.2' }))).toBe(
      'unsupported-options-version',
    );
    expect((await applySettingsPolicy(dir, { minecraftVersion: '1.21.1' })).formatProfile).toBe(
      'java-1.21.1',
    );
    const mismatch = await setup(pol, 'version:3955\nx:1\n');
    expect(await code(applySettingsPolicy(mismatch, { minecraftVersion: '1.20.5' }))).toBe(
      'unsupported-options-version',
    );
  });
  it('rejects legacy numeric key codes, version overrides and malformed file/ ids', async () => {
    const d1 = await setup({ ...base, required: { 'key_key.jump': '57' } });
    expect(await code(applySettingsPolicy(d1))).toBe('invalid-policy');
    const d2 = await setup({ ...base, required: { version: '1' } });
    expect(await code(applySettingsPolicy(d2))).toBe('invalid-policy');
    const d3 = await setup({ ...base, resourcePacks: { required: ['file/../x.zip'] } });
    expect(await code(applySettingsPolicy(d3))).toBe('invalid-policy');
  });
});
