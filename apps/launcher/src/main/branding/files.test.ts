import { readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  atomicBrandingRecord,
  cleanupBrandingScratch,
  ensureBrandingDirectory,
  readBrandingFile,
} from './files';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'branding-files-'));
  roots.push(path);
  return path;
}
it('rejects symlink ancestry above the supplied read/cache root', async () => {
  const root = await fixture();
  await mkdir(join(root, 'real'));
  await mkdir(join(root, 'real', 'child'));
  await writeFile(join(root, 'real', 'child', 'image'), 'bytes');
  await symlink(join(root, 'real'), join(root, 'link'));
  await expect(readBrandingFile(join(root, 'link', 'child'), 'image', 100)).rejects.toThrow();
  await expect(
    ensureBrandingDirectory(join(root, 'link', 'child'), ['branding']),
  ).rejects.toThrow();
});
it('preserves foreign replacement files during aborted scratch cleanup', async () => {
  const root = await fixture();
  await writeFile(join(root, 'icon.json'), 'previous');
  await expect(
    atomicBrandingRecord(root, 'icon.json', Buffer.from('replacement'), () => {
      const temporary = readdirSync(root).find((name) => name.startsWith('pending-'));
      if (!temporary) throw new Error('fixture temporary missing');
      renameSync(join(root, temporary), join(root, 'original-staging'));
      writeFileSync(join(root, temporary), 'foreign');
      throw new Error('cancelled');
    }),
  ).rejects.toThrow('cancelled');
  expect(await readFile(join(root, 'icon.json'), 'utf8')).toBe('previous');
  const replacement = readdirSync(root).find((name) => name.startsWith('pending-'));
  expect(await readFile(join(root, replacement ?? ''), 'utf8')).toBe('foreign');
});
it('does not follow a replaced ancestor for cleanup', async () => {
  const root = await fixture();
  const cache = join(root, 'parent', 'cache');
  const foreign = join(root, 'foreign');
  await mkdir(cache, { recursive: true });
  await mkdir(join(foreign, 'cache'), { recursive: true });
  let staged = '';
  await expect(
    atomicBrandingRecord(cache, 'background.json', Buffer.from('image'), () => {
      staged = readdirSync(cache).find((name) => name.startsWith('pending-')) ?? '';
      renameSync(join(root, 'parent'), join(root, 'original-parent'));
      symlinkSync(foreign, join(root, 'parent'));
      writeFileSync(join(foreign, 'cache', staged), 'foreign');
      throw new Error('changed');
    }),
  ).rejects.toThrow('changed');
  expect(await readFile(join(foreign, 'cache', staged), 'utf8')).toBe('foreign');
  expect(await readFile(join(root, 'original-parent', 'cache', staged), 'utf8')).toBe('image');
});

it('removes owned scratch only and preserves a replaced scratch image', async () => {
  const root = await fixture();
  const scratch = join(root, 'scratch');
  await mkdir(scratch);
  await writeFile(join(scratch, 'image'), 'owned');
  const directory = await lstat(scratch, { bigint: true });
  const image = await lstat(join(scratch, 'image'), { bigint: true });
  renameSync(join(scratch, 'image'), join(root, 'moved-image'));
  await writeFile(join(scratch, 'image'), 'foreign');
  await cleanupBrandingScratch(scratch, directory, image);
  expect(await readFile(join(scratch, 'image'), 'utf8')).toBe('foreign');
  await rm(join(scratch, 'image'));
  renameSync(join(root, 'moved-image'), join(scratch, 'image'));
  await cleanupBrandingScratch(scratch, directory, image);
  await expect(lstat(scratch)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('captures each cache directory so a replaced earlier child is rejected before deeper creation', async () => {
  const fs = await import('node:fs/promises');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const original = actual.lstat;
  const root = await fixture();
  const branding = join(root, 'branding');
  await mkdir(branding);
  await mkdir(join(branding, 'v1'));
  let replaced = false;
  vi.spyOn(fs, 'lstat').mockImplementation((async (path: string, options: unknown) => {
    const result = await original(path, options as never);
    if (!replaced && path === join(branding, 'v1')) {
      replaced = true;
      renameSync(branding, join(root, 'moved-branding'));
      await mkdir(branding);
      await mkdir(join(branding, 'v1'));
    }
    return result;
  }) as typeof fs.lstat);
  await expect(ensureBrandingDirectory(root, ['branding', 'v1', 'server'])).rejects.toThrow(
    'changed-branding-parent',
  );
  await expect(original(join(branding, 'v1', 'server'))).rejects.toMatchObject({ code: 'ENOENT' });
});
