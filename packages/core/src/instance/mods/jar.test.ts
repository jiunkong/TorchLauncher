import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fabricJar, neoForgeJar, zip } from './fixtures.js';
import { readJarInfo } from './jar.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function jar(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'torch-jar-'));
  dirs.push(dir);
  const path = join(dir, 'a.jar');
  await writeFile(path, bytes);
  return path;
}

describe('readJarInfo', () => {
  it('reads Fabric ids including provides', async () => {
    const info = await readJarInfo(await jar(fabricJar('example', { provides: ['alias'] })));
    expect(info).toMatchObject({ modIds: ['alias', 'example'], loaders: ['fabric'], warnings: [] });
  });

  it('reads NeoForge [[mods]] ids and ignores dependency tables', async () => {
    const info = await readJarInfo(await jar(neoForgeJar('neomod')));
    expect(info.modIds).toEqual(['neomod']);
    expect(info.loaders).toEqual(['neoforge']);
  });

  it('reads stored entries and archives with trailing comments', async () => {
    const bytes = zip(
      [{ name: 'fabric.mod.json', data: '{"id":"stored"}', stored: true }],
      'comment',
    );
    expect((await readJarInfo(await jar(bytes))).modIds).toEqual(['stored']);
  });

  it('warns when no id can be read', async () => {
    expect((await readJarInfo(await jar(zip([{ name: 'x', data: 'y' }])))).warnings).toEqual([
      'mod-id-unavailable',
    ]);
    const broken = await readJarInfo(await jar(zip([{ name: 'fabric.mod.json', data: '{nope' }])));
    expect(broken.modIds).toEqual([]);
    expect(broken.warnings).toContain('metadata-unreadable');
    const badId = await readJarInfo(await jar(fabricJar('../evil')));
    expect(badId.modIds).toEqual([]);
  });

  it.each([
    ['not a zip', Buffer.from('this is definitely not a zip file at all')],
    ['truncated', fabricJar('x').subarray(0, 40)],
    [
      'duplicate metadata entries',
      zip([
        { name: 'fabric.mod.json', data: '{"id":"a"}' },
        { name: 'fabric.mod.json', data: '{"id":"b"}' },
      ]),
    ],
  ])('rejects %s as invalid-jar', async (_name, bytes) => {
    await expect(readJarInfo(await jar(bytes))).rejects.toMatchObject({ code: 'invalid-jar' });
  });

  it('rejects metadata that inflates beyond the limit (zip bomb)', async () => {
    const bomb = zip([{ name: 'fabric.mod.json', data: Buffer.alloc(8 * 1024 ** 2, 0x20) }]);
    expect(bomb.length).toBeLessThan(100_000);
    await expect(readJarInfo(await jar(bomb))).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('rejects a lying declared size', async () => {
    const bytes = fabricJar('liar');
    // Patch the central directory uncompressed size of the first entry.
    const at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(5, at + 24);
    await expect(readJarInfo(await jar(bytes))).rejects.toMatchObject({ code: 'invalid-jar' });
  });
});
