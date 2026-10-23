import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { zip } from './fixtures/zip.js';
import { readModMetadata } from './metadata.js';

const fabric = (
  data = '{"id":"example","version":"1.0","depends":{"minecraft":"~1.21.1","api":[">=1","2"]},"environment":"client"}',
  stored = false,
) => zip([{ name: 'fabric.mod.json', data, stored }]);
const central = (data: Buffer) => data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));

describe('readModMetadata', () => {
  it.each([false, true])('reads Fabric metadata (stored=%s)', async (stored) => {
    const result = await readModMetadata(fabric(undefined, stored));
    expect(result).toEqual({
      loader: 'fabric',
      mods: [
        {
          id: 'example',
          version: '1.0',
          environment: 'client',
          dependencies: [
            { id: 'minecraft', version: '~1.21.1' },
            { id: 'api', version: ['>=1', '2'] },
          ],
        },
      ],
    });
  });
  it('reads NeoForge mods and dependency tables from a stream', async () => {
    const data = zip([
      {
        name: 'META-INF/neoforge.mods.toml',
        data: `modLoader="javafml"
loaderVersion="[4,)"
[[mods]]
modId="example"
version="1.0"
description='''
A multiline description.
modId="not_a_mod"
'''
[[dependencies.example]]
modId="neoforge"
type="required"
versionRange="[21.1,)"
side="BOTH"
[[mods]]
modId='second'
version='2' # comment
`,
      },
    ]);
    const result = await readModMetadata(Readable.from([data.subarray(0, 30), data.subarray(30)]));
    expect(result).toMatchObject({
      loader: 'neoforge',
      mods: [
        {
          id: 'example',
          version: '1.0',
          dependencies: [{ id: 'neoforge', version: '[21.1,)', type: 'required', side: 'BOTH' }],
        },
        { id: 'second', version: '2', dependencies: [] },
      ],
    });
  });
  it.each([
    '../evil',
    '/absolute',
    'C:/evil',
    'a\\evil',
    'a//evil',
    'a/./evil',
    'a/../evil',
    'a\u0000evil',
    'a:stream',
    'a.',
  ])('rejects unsafe entry %s even when unrelated to metadata', async (name) => {
    await expect(
      readModMetadata(
        zip([
          { name, data: '' },
          { name: 'fabric.mod.json', data: '{"id":"example","version":"1"}' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'unsafe-entry' });
  });
  it('ignores nested jars', async () => {
    await expect(
      readModMetadata(zip([{ name: 'META-INF/jars/nested.jar', data: fabric() }])),
    ).rejects.toMatchObject({ code: 'metadata-not-found' });
  });
  it('rejects ZIP64 explicitly', async () => {
    const bytes = fabric();
    bytes.writeUInt32LE(0xffffffff, central(bytes) + 24);
    await expect(readModMetadata(bytes)).rejects.toMatchObject({ code: 'zip64-unsupported' });
    const end = fabric();
    end.writeUInt16LE(0xffff, end.length - 12);
    await expect(readModMetadata(end)).rejects.toMatchObject({ code: 'zip64-unsupported' });
  });
  it('rejects oversized metadata and lying inflation sizes', async () => {
    await expect(readModMetadata(fabric(' '.repeat(1024 * 1024 + 1)))).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    const bytes = fabric(' '.repeat(1024 * 1024 + 1));
    bytes.writeUInt32LE(10, central(bytes) + 24);
    await expect(readModMetadata(bytes)).rejects.toMatchObject({ code: 'invalid-zip' });
  });
  it('rejects CRC failures, encryption, mismatched names, symlinks and duplicate entries', async () => {
    const crc = fabric();
    crc.writeUInt32LE(0, central(crc) + 16);
    const enc = fabric();
    enc.writeUInt16LE(1, 6);
    enc.writeUInt16LE(1, central(enc) + 8);
    const name = fabric();
    name[30] = 120;
    const link = fabric();
    link.writeUInt32LE(0xa0000000, central(link) + 38);
    const duplicate = zip([
      { name: 'fabric.mod.json', data: '{}' },
      { name: 'fabric.mod.json', data: '{}' },
    ]);
    for (const bytes of [crc, name, duplicate])
      await expect(readModMetadata(bytes)).rejects.toMatchObject({ code: 'invalid-zip' });
    await expect(readModMetadata(enc)).rejects.toMatchObject({ code: 'unsupported-compression' });
    await expect(readModMetadata(link)).rejects.toMatchObject({ code: 'unsafe-entry' });
  });
  it.each([
    '{}',
    '{"id":"../bad","version":"1"}',
    '{"id":"example","version":1}',
    '{"id":"example","version":"1","depends":{"api":true}}',
    '{broken',
  ])('rejects invalid metadata %s', async (data) => {
    await expect(readModMetadata(fabric(data))).rejects.toMatchObject({ code: 'invalid-metadata' });
  });
  it('fails explicitly for unsupported consumed TOML syntax', async () => {
    await expect(
      readModMetadata(
        zip([
          {
            name: 'META-INF/neoforge.mods.toml',
            data: '[[mods]]\nmodId="example"\nversion={value="1"}',
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-toml' });
  });
  it('bounds streamed jar size and closes the iterator', async () => {
    let closed = false;
    async function* stream() {
      try {
        for (let i = 0; i < 65; i++) yield Buffer.alloc(1024 * 1024);
      } finally {
        closed = true;
      }
    }
    await expect(readModMetadata(stream())).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(closed).toBe(true);
  });
  it('rejects truncated archives and truncated UTF8', async () => {
    await expect(readModMetadata(fabric().subarray(0, 40))).rejects.toMatchObject({
      code: 'invalid-zip',
    });
    await expect(
      readModMetadata(zip([{ name: 'fabric.mod.json', data: Buffer.from([0xff]) }])),
    ).rejects.toMatchObject({ code: 'invalid-metadata' });
  });
});
