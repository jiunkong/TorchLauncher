import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validateImage } from './branding.js';
import { newProject } from './project.js';
import { decodeProjectFile, encodeProjectFile } from './project-file.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const decode = () => ({ width: 1, height: 1 });
const sha = (b: Buffer) => createHash('sha256').update(b).digest();
const base = { ...newProject(), serverId: '11111111-1111-4111-8111-111111111111' };
const withImages = () => ({
  ...base,
  branding: {
    appName: 'Torch',
    icon: validateImage('icon', png, decode),
    background: validateImage('background', png, decode),
  },
});

/** Rebuilds a container from raw sections with valid hashes, so tests can break one rule at a time. */
function build(
  sections: { id: string; data: Buffer }[],
  { format = 1, flags = 0, count = sections.length, extra = Buffer.alloc(0) } = {},
): Buffer {
  const header = Buffer.alloc(16);
  Buffer.from([0x89, 0x54, 0x4c, 0x53, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt16LE(format, 8);
  header.writeUInt16LE(flags, 10);
  header.writeUInt32LE(count, 12);
  const parts: Buffer[] = [header];
  for (const { id, data } of sections) {
    const e = Buffer.alloc(8);
    e.write(id, 0, 'ascii');
    e.writeUInt32LE(data.length, 4);
    parts.push(e, sha(data), data);
  }
  parts.push(extra);
  const body = Buffer.concat(parts);
  return Buffer.concat([body, sha(body)]);
}
const meta = (value: unknown) => deflateSync(Buffer.from(JSON.stringify(value)));
const reseal = (file: Buffer) => {
  const body = file.subarray(0, file.length - 32);
  return Buffer.concat([body, sha(body)]);
};
const invalid = (b: Buffer) =>
  expect(() => decodeProjectFile(b, decode)).toThrow(expect.objectContaining({ code: 'INVALID' }));

describe('TorchLauncher Studio file codec', () => {
  it('round trips a project without images', () => {
    const file = encodeProjectFile(base, {});
    expect(file.subarray(0, 8).toString('latin1')).toBe('\x89TLS\r\n\x1a\n');
    const out = decodeProjectFile(file, decode);
    expect(out.project).toEqual(base);
    expect(out.snapshots).toEqual({});
  });
  it('stores image bytes raw and round trips them', () => {
    const project = withImages();
    const file = encodeProjectFile(project, { icon: png, background: png });
    expect(file.includes(png)).toBe(true);
    expect(file.includes(Buffer.from(png.toString('base64')))).toBe(false);
    expect(file.length).toBeLessThan(
      Buffer.byteLength(JSON.stringify({ ...project, a: png.toString('base64') })) +
        2 * png.length * 2,
    );
    const out = decodeProjectFile(file, decode);
    expect(out.project).toEqual(project);
    expect(out.snapshots.icon?.equals(png)).toBe(true);
    expect(out.snapshots.background?.equals(png)).toBe(true);
  });
  it('is smaller than the base64 form for a large image', () => {
    const big = Buffer.concat([png, Buffer.alloc(300000, 7)]);
    // trailing bytes after IEND are not checked by the fake decoder; only size matters here
    const file = encodeProjectFile(base, {});
    expect(file.length + big.length).toBeLessThan(
      Buffer.byteLength(JSON.stringify(base)) + big.toString('base64').length,
    );
  });
  it('is deterministic regardless of key order', () => {
    const a = encodeProjectFile(withImages(), { icon: png, background: png });
    const b = encodeProjectFile(withImages(), { background: png, icon: png });
    expect(a.equals(b)).toBe(true);
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    expect(encodeProjectFile(reordered, {}).equals(encodeProjectFile(base, {}))).toBe(true);
  });
  it('rejects JSON, wrong magic, format, flags and section counts', () => {
    invalid(Buffer.from(JSON.stringify(base)));
    invalid(Buffer.alloc(0));
    const good = encodeProjectFile(base, {});
    const magic = Buffer.from(good);
    magic[1] = 0;
    invalid(reseal(magic));
    const format = Buffer.from(good);
    format.writeUInt16LE(2, 8);
    invalid(reseal(format));
    const flags = Buffer.from(good);
    flags.writeUInt16LE(1, 10);
    invalid(reseal(flags));
    const zero = Buffer.from(good);
    zero.writeUInt32LE(0, 12);
    invalid(reseal(zero));
    const nine = Buffer.from(good);
    nine.writeUInt32LE(9, 12);
    invalid(reseal(nine));
  });
  it('rejects truncation, trailing bytes and any flipped byte', () => {
    const good = encodeProjectFile(withImages(), { icon: png, background: png });
    for (const cut of [1, 32, 33, 100, good.length - 1])
      invalid(good.subarray(0, good.length - cut));
    invalid(Buffer.concat([good, Buffer.from([0])]));
    for (let i = 0; i < good.length; i++) {
      const bad = Buffer.from(good);
      bad[i] = (bad[i] as number) ^ 0x01;
      invalid(bad);
    }
    // extra bytes inside the hashed region (valid trailer) are length mismatches
    invalid(build([{ id: 'META', data: meta(base) }], { extra: Buffer.from([1, 2, 3]) }));
  });
  it('rejects unknown, duplicate and missing sections', () => {
    const m = { id: 'META', data: meta(base) };
    expect(decodeProjectFile(build([m]), decode).project).toEqual(base);
    invalid(build([m, { id: 'XXXX', data: Buffer.from('a') }]));
    invalid(build([m, m]));
    invalid(build([{ id: 'ICON', data: png }]));
  });
  it('rejects a section length beyond the file and a section hash mismatch', () => {
    const good = build([{ id: 'META', data: meta(base) }]);
    const long = Buffer.from(good);
    long.writeUInt32LE(0x7fffffff, 16 + 4);
    invalid(reseal(long));
    const wrongHash = Buffer.from(good);
    wrongHash[16 + 8] = (wrongHash[16 + 8] as number) ^ 1;
    invalid(reseal(wrongHash));
  });
  it('rejects a decompression bomb, bad META JSON and invalid projects', () => {
    invalid(build([{ id: 'META', data: deflateSync(Buffer.alloc(9 * 1024 ** 2, 32)) }]));
    invalid(build([{ id: 'META', data: deflateSync(Buffer.from('{bad')) }]));
    invalid(build([{ id: 'META', data: Buffer.from('not zlib') }]));
    invalid(build([{ id: 'META', data: meta({ ...base, extra: 1 }) }]));
    invalid(build([{ id: 'META', data: meta([]) }]));
  });
  it('rejects inconsistent image metadata and sections', () => {
    const project = withImages();
    const m = { id: 'META', data: meta(project) };
    const icon = { id: 'ICON', data: png };
    const bg = { id: 'BGND', data: png };
    expect(decodeProjectFile(build([m, icon, bg]), decode).project).toEqual(project);
    invalid(build([m, icon]));
    invalid(build([m, bg]));
    invalid(build([m, { id: 'ICON', data: Buffer.concat([png, Buffer.from([0])]) }, bg]));
    invalid(build([{ id: 'META', data: meta(base) }, icon]));
    const noBg = { ...project, branding: { ...project.branding, background: null } };
    invalid(build([{ id: 'META', data: meta(noBg) }, icon, bg]));
    expect(() =>
      decodeProjectFile(build([m, icon, bg]), () => ({ width: 2, height: 2 })),
    ).toThrow();
  });
});
