import { describe, expect, it } from 'vitest';
import { tinyPng } from './fixtures/images.js';
import { BRANDING_LIMITS, inspectBrandingImage } from './index.js';

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc2, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0,
  ]);
  bytes.writeUInt16BE(height, 13);
  bytes.writeUInt16BE(width, 15);
  return bytes;
}

describe('encoded branding image headers', () => {
  it('reads PNG and JPEG dimensions without claiming complete image decoding', () => {
    expect(inspectBrandingImage('icon', 'image/png', tinyPng())).toEqual({ width: 1, height: 1 });
    expect(inspectBrandingImage('background', 'image/jpeg', jpegHeader(3840, 2160))).toEqual({
      width: 3840,
      height: 2160,
    });
  });
  it('rejects mismatched formats, invalid dimensions and truncated headers/segments', () => {
    const wide = tinyPng();
    wide.writeUInt32BE(513, 16);
    const tall = tinyPng();
    tall.writeUInt32BE(2161, 20);
    const depth = tinyPng();
    depth[24] = 3;
    const color = tinyPng();
    color[25] = 1;
    const zero = tinyPng();
    zero.writeUInt32BE(0, 16);
    const segment = jpegHeader(1, 1);
    segment[4] = 0xff;
    for (const bytes of [wide, zero, depth, color, tinyPng().subarray(0, 32), jpegHeader(1, 1)])
      expect(() => inspectBrandingImage('icon', 'image/png', bytes)).toThrow();
    for (const bytes of [
      tall,
      jpegHeader(3841, 1),
      segment,
      jpegHeader(0, 1),
      Uint8Array.from([0xff, 0xd8, 0xff, 0xff]),
      jpegHeader(1, 1).subarray(0, 18),
    ])
      expect(() => inspectBrandingImage('background', 'image/jpeg', bytes)).toThrow();
    expect(() => inspectBrandingImage('icon', 'image/jpeg', jpegHeader(1, 1))).toThrow();
    expect(() =>
      inspectBrandingImage('icon', 'image/png', new Uint8Array(BRANDING_LIMITS.icon.length + 1)),
    ).toThrow();
  });
});
