import { describe, expect, it } from 'vitest';
import { BRANDING_LIMITS } from '../../../../packages/core/src/branding/index.js';
import {
  BRANDING_MAX_ATTEMPTS,
  BRANDING_SOURCE_LIMITS,
  displayFileName,
  ioCause,
  prepareBrandingImage,
} from './branding-image.js';
import {
  type FakeRasterCalls,
  fakeDecode,
  fakeJpeg,
  fakePng,
  fakeRaster,
} from './fixtures/fake-raster.js';
import { ImageFailure, StudioFailure } from './project.js';

const calls = (): FakeRasterCalls => ({ resize: [], png: 0, jpeg: [] });
function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageFailure);
    expect((error as ImageFailure).code).toBe('IMAGE_FAILED');
    return (error as ImageFailure).image;
  }
  throw new Error('expected an ImageFailure');
}

describe('prepareBrandingImage', () => {
  it('keeps a valid source byte for byte', () => {
    const source = fakePng(64, 64, 500);
    const result = prepareBrandingImage('icon', 'a.png', source, fakeRaster(), fakeDecode);
    expect(result.original).toBe(true);
    expect(result.bytes).toBe(source);
    const jpeg = fakeJpeg(1920, 1080, 4000);
    expect(prepareBrandingImage('background', 'b.jpg', jpeg, fakeRaster(), fakeDecode).bytes).toBe(
      jpeg,
    );
  });
  it('scales an oversized icon to 512x512 PNG', () => {
    const c = calls();
    const result = prepareBrandingImage(
      'icon',
      'big.png',
      fakePng(2000, 2000, 900),
      fakeRaster({ calls: c }),
      fakeDecode,
    );
    expect(result.original).toBe(false);
    expect(c.resize).toEqual([[512, 512]]);
    expect(result.metadata.mediaType).toBe('image/png');
    expect(fakeDecode(result.bytes)).toEqual({ width: 512, height: 512 });
  });
  it('keeps the aspect ratio for backgrounds and stays JPEG for JPEG sources', () => {
    const c = calls();
    const result = prepareBrandingImage(
      'background',
      'photo.jpg',
      fakeJpeg(5000, 3000, 700),
      fakeRaster({ calls: c }),
      fakeDecode,
    );
    expect(result.metadata.mediaType).toBe('image/jpeg');
    expect(c.resize).toEqual([[3600, 2160]]);
    expect(c.png).toBe(0);
  });
  it('limits pixels as well as width and height', () => {
    const c = calls();
    prepareBrandingImage(
      'background',
      'wide.png',
      fakePng(3840, 3000, 800),
      fakeRaster({ calls: c }),
      fakeDecode,
    );
    const [width, height] = c.resize[0] ?? [0, 0];
    expect(width).toBeLessThanOrEqual(3840);
    expect(height).toBeLessThanOrEqual(2160);
    expect(width * height).toBeLessThanOrEqual(BRANDING_LIMITS.background.pixels);
  });
  it('turns a JPEG icon into a PNG, even when it fits the dimensions', () => {
    const result = prepareBrandingImage(
      'icon',
      'icon.jpg',
      fakeJpeg(256, 256, 800),
      fakeRaster(),
      fakeDecode,
    );
    expect(result.metadata.mediaType).toBe('image/png');
    expect(fakeDecode(result.bytes)).toEqual({ width: 256, height: 256 });
  });
  it('shrinks an icon that is within the dimensions but over the byte limit', () => {
    const c = calls();
    const result = prepareBrandingImage(
      'icon',
      'heavy.png',
      fakePng(400, 400, 1.5 * 1024 ** 2),
      fakeRaster({ calls: c, pngBytesPerPixel: 9.4 }),
      fakeDecode,
    );
    expect(result.bytes.length).toBeLessThanOrEqual(BRANDING_LIMITS.icon.length);
    expect(fakeDecode(result.bytes).width).toBeLessThan(400);
    expect(c.png).toBeGreaterThan(1);
  });
  it('falls back to JPEG for a PNG background that cannot fit as PNG', () => {
    const c = calls();
    const result = prepareBrandingImage(
      'background',
      'photo.png',
      fakePng(3840, 2160, 9 * 1024 ** 2),
      fakeRaster({ calls: c, pngBytesPerPixel: 2 }),
      fakeDecode,
    );
    expect(result.metadata.mediaType).toBe('image/jpeg');
    expect(c.png).toBe(1);
  });
  it('lowers the JPEG quality before scaling and stays within the attempt bound', () => {
    const c = calls();
    const result = prepareBrandingImage(
      'background',
      'photo.jpg',
      fakeJpeg(3840, 2160, 9 * 1024 ** 2),
      fakeRaster({ calls: c, jpegBytesPerPixel: 1.3 }),
      fakeDecode,
    );
    expect(result.bytes.length).toBeLessThanOrEqual(BRANDING_LIMITS.background.length);
    expect(c.jpeg[0]).toBe(92);
    expect(c.jpeg[1]).toBeLessThan(92);
  });
  it('reports the final size when it cannot fit after the bounded attempts', () => {
    const c = calls();
    const image = failure(() =>
      prepareBrandingImage(
        'icon',
        'noise.png',
        fakePng(2000, 2000, 900),
        fakeRaster({ calls: c, pngBytesPerPixel: 10_000 }),
        fakeDecode,
      ),
    );
    expect(c.png).toBe(BRANDING_MAX_ATTEMPTS);
    expect(image).toMatchObject({
      reason: 'cannotFit',
      role: 'icon',
      name: 'noise.png',
      attempts: BRANDING_MAX_ATTEMPTS,
      limit: BRANDING_LIMITS.icon.length,
    });
    if (image.reason === 'cannotFit') {
      expect(image.bytes).toBeGreaterThan(image.limit);
      expect(image.width).toBeLessThan(512);
    }
  });
  it('names the precise cause of each unusable source', () => {
    const run = (bytes: Buffer, role: 'icon' | 'background' = 'icon', raster = fakeRaster()) =>
      failure(() => prepareBrandingImage(role, 'x.png', bytes, raster, fakeDecode));
    expect(run(Buffer.alloc(0))).toMatchObject({ reason: 'corrupt', part: 'empty' });
    expect(run(Buffer.from('this is text, not an image'))).toEqual({
      reason: 'unsupported',
      role: 'icon',
      name: 'x.png',
    });
    expect(run(fakePng(10, 10).subarray(0, 20))).toMatchObject({
      reason: 'corrupt',
      part: 'header',
      format: 'PNG',
    });
    expect(run(fakeJpeg(10, 10).subarray(0, 8))).toMatchObject({
      reason: 'corrupt',
      part: 'header',
      format: 'JPEG',
    });
    expect(
      run(fakePng(2000, 1500, 900), 'icon', fakeRaster({ failing: () => true })),
    ).toMatchObject({ reason: 'corrupt', part: 'data', format: 'PNG', width: 2000, height: 1500 });
    expect(run(fakePng(9000, 8000, 900))).toEqual({
      reason: 'tooManyPixels',
      role: 'icon',
      name: 'x.png',
      width: 9000,
      height: 8000,
      limit: BRANDING_SOURCE_LIMITS.pixels,
    });
    expect(run(Buffer.alloc(BRANDING_SOURCE_LIMITS.bytes + 1))).toMatchObject({
      reason: 'fileTooLarge',
      bytes: BRANDING_SOURCE_LIMITS.bytes + 1,
      limit: BRANDING_SOURCE_LIMITS.bytes,
    });
  });
});
describe('file helpers', () => {
  it('reduces paths to a safe file name and classifies OS errors without paths', () => {
    expect(displayFileName('/home/u/secret/pic.png')).toBe('pic.png');
    expect(displayFileName('C:\\Users\\u\\pic\u0007.png')).toBe('pic.png');
    expect(displayFileName(`/x/${'a'.repeat(300)}`).length).toBeLessThanOrEqual(100);
    const errno = (code: string) => Object.assign(new Error('/secret/path'), { code });
    expect(ioCause(errno('EACCES'))).toBe('denied');
    expect(ioCause(errno('ENOENT'))).toBe('notFound');
    expect(ioCause(errno('EISDIR'))).toBe('notFile');
    expect(ioCause(errno('ENOSPC'))).toBe('diskFull');
    expect(ioCause(errno('EWHATEVER'))).toBe('other');
    expect(ioCause(new StudioFailure('INVALID'))).toBe('notFile');
    expect(ioCause(new StudioFailure('IO'))).toBe('changed');
  });
});
