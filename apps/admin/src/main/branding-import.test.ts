import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRANDING_LIMITS } from '../../../../packages/core/src/branding/index.js';
import { fakeDecode, fakeJpeg, fakePng, fakeRaster } from './fixtures/fake-raster.js';
import { createProjectAt } from './fixtures/projects.js';
import { StudioService } from './fixtures/signing.js';
import { PROJECT_FILE_NAME } from './project-folder.js';
import type { StudioDialogs } from './studio.js';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-img-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
  };
  const s = new StudioService(
    d,
    undefined,
    fakeDecode,
    undefined,
    undefined,
    undefined,
    fakeRaster({ failing: (bytes) => bytes.includes(Buffer.from('TRUNCATED')) }),
  );
  const projDir = join(await temp(), 'proj');
  await createProjectAt(s, d, projDir);
  const input = await temp();
  return { d, s, projDir, input };
}
const names = async (dir: string) => (await readdir(dir)).sort();

describe('Studio branding image import', () => {
  it('stores converted bytes, metadata and the project copy for an oversized icon', async () => {
    const { d, s, projDir, input } = await setup();
    const file = join(input, 'big.png');
    await writeFile(file, fakePng(2000, 2000, 5000));
    d.open.mockResolvedValueOnce([file]);
    expect((await s.request({ action: 'brandingSelect', role: 'icon' })).ok).toBe(true);
    const stored = await readFile(join(projDir, 'branding', 'icon.png'));
    expect(fakeDecode(stored)).toEqual({ width: 512, height: 512 });
    const icon = s.snapshot().project?.branding?.icon;
    expect(icon).toEqual({
      sha256: createHash('sha256').update(stored).digest('hex'),
      length: stored.length,
      mediaType: 'image/png',
    });
    expect(icon?.length).toBeLessThanOrEqual(BRANDING_LIMITS.icon.length);
  });
  it('keeps a valid image unchanged', async () => {
    const { d, s, projDir, input } = await setup();
    const source = fakePng(100, 100, 700);
    const file = join(input, 'small.png');
    await writeFile(file, source);
    d.open.mockResolvedValueOnce([file]);
    expect((await s.request({ action: 'brandingSelect', role: 'icon' })).ok).toBe(true);
    expect(await readFile(join(projDir, 'branding', 'icon.png'))).toEqual(source);
    expect(s.snapshot().project?.branding?.icon?.sha256).toBe(
      createHash('sha256').update(source).digest('hex'),
    );
  });
  it('removes the project copy and saves on brandingRemove, leaving other roles', async () => {
    const { d, s, projDir, input } = await setup();
    const icon = join(input, 'icon.png');
    const background = join(input, 'bg.jpg');
    await writeFile(icon, fakePng(64, 64));
    await writeFile(background, fakeJpeg(5000, 3000, 900));
    d.open.mockResolvedValueOnce([icon]);
    await s.request({ action: 'brandingSelect', role: 'icon' });
    d.open.mockResolvedValueOnce([background]);
    await s.request({ action: 'brandingSelect', role: 'background' });
    expect(await names(join(projDir, 'branding'))).toEqual(['background.jpg', 'icon.png']);
    expect((await s.request({ action: 'brandingRemove', role: 'icon' })).ok).toBe(true);
    expect(await names(join(projDir, 'branding'))).toEqual(['background.jpg']);
    expect(s.snapshot().dirty).toBe(false);
    const saved = await readFile(join(projDir, PROJECT_FILE_NAME), 'utf8');
    expect(saved).not.toContain('"icon":{');
  });
  it('reports the exact cause and leaves the project unchanged on failure', async () => {
    const { d, s, projDir, input } = await setup();
    const good = join(input, 'good.png');
    await writeFile(good, fakePng(32, 32));
    d.open.mockResolvedValueOnce([good]);
    await s.request({ action: 'brandingSelect', role: 'icon' });
    const before = s.snapshot().project;
    const copyBefore = await readFile(join(projDir, 'branding', 'icon.png'));
    const text = join(input, 'text.png');
    await writeFile(text, 'plain text');
    const truncated = join(input, 'cut.png');
    await writeFile(truncated, Buffer.concat([fakePng(800, 600, 100), Buffer.from('TRUNCATED')]));
    const cases: [string, unknown][] = [
      [text, { reason: 'unsupported', name: 'text.png' }],
      [truncated, { reason: 'corrupt', part: 'data', format: 'PNG', width: 800, height: 600 }],
      [join(input, 'missing.png'), { reason: 'unreadable', cause: 'notFound' }],
      [input, { reason: 'unreadable', cause: 'notFile' }],
    ];
    for (const [path, expected] of cases) {
      d.open.mockResolvedValueOnce([path]);
      const reply = await s.request({ action: 'brandingSelect', role: 'icon' });
      expect(reply).toMatchObject({ ok: false, code: 'IMAGE_FAILED', image: expected });
      expect(JSON.stringify(reply)).not.toContain(input);
    }
    expect(s.snapshot().project).toEqual(before);
    expect(await readFile(join(projDir, 'branding', 'icon.png'))).toEqual(copyBefore);
  });
  it('reports a project folder that cannot take the copy', async () => {
    const { d, s, projDir, input } = await setup();
    await writeFile(join(projDir, 'branding'), 'not a folder');
    const file = join(input, 'a.png');
    await writeFile(file, fakePng(32, 32));
    d.open.mockResolvedValueOnce([file]);
    const reply = await s.request({ action: 'brandingSelect', role: 'icon' });
    expect(reply).toMatchObject({
      ok: false,
      code: 'IMAGE_FAILED',
      image: { reason: 'storeFailed' },
    });
  });
});
