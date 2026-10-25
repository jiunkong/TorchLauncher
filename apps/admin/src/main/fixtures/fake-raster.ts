import { type RasterDecoder, type RasterImage, readImageHeader } from '../branding-image.js';

/** A PNG-like buffer: valid signature and IHDR (as far as the header checks look), padded to `length`. */
export function fakePng(width: number, height: number, length = 64): Buffer {
  const bytes = Buffer.alloc(Math.max(length, 33));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}
/** A JPEG-like buffer with an SOF0 marker for the size, padded to `length`. */
export function fakeJpeg(width: number, height: number, length = 64): Buffer {
  const bytes = Buffer.alloc(Math.max(length, 30));
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]).copy(bytes);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[11] = 3;
  Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]).copy(bytes, 12);
  return bytes;
}
/** Decoder for validateImage that trusts the headers of the fake images. */
export const fakeDecode = (bytes: Buffer) => {
  const header = readImageHeader(bytes);
  if (!header || header.kind === 'broken') throw new Error('INVALID');
  return { width: header.width, height: header.height };
};
export interface FakeRasterCalls {
  resize: [number, number][];
  png: number;
  jpeg: number[];
}
export interface FakeRasterOptions {
  /** Encoded PNG bytes per pixel. */
  pngBytesPerPixel?: number;
  /** Encoded JPEG bytes per pixel at quality 100. */
  jpegBytesPerPixel?: number;
  calls?: FakeRasterCalls;
  /** Sources for which the decoder reports failure (truncated pixel data). */
  failing?: (bytes: Buffer) => boolean;
}
export function fakeRaster(options: FakeRasterOptions = {}): RasterDecoder {
  const png = options.pngBytesPerPixel ?? 0.1;
  const jpeg = options.jpegBytesPerPixel ?? 0.05;
  const calls = options.calls ?? { resize: [], png: 0, jpeg: [] };
  const image = (width: number, height: number): RasterImage => ({
    width,
    height,
    resize: (w, h) => {
      calls.resize.push([w, h]);
      return image(w, h);
    },
    toPNG: () => {
      calls.png += 1;
      return fakePng(width, height, Math.ceil(width * height * png));
    },
    toJPEG: (quality) => {
      calls.jpeg.push(quality);
      return fakeJpeg(width, height, Math.ceil(width * height * jpeg * (quality / 100)));
    },
  });
  return (bytes) => {
    if (options.failing?.(bytes)) return null;
    const header = readImageHeader(bytes);
    return header && header.kind !== 'broken' ? image(header.width, header.height) : null;
  };
}
