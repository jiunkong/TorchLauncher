import { type NativeImage, nativeImage } from 'electron';
import type { ImageDecoder } from './branding.js';
import type { RasterDecoder, RasterImage } from './branding-image.js';

export const decodeNativeImage: ImageDecoder = (bytes) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('INVALID');
  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length !== size.width * size.height * 4) throw new Error('INVALID');
  return size;
};

function wrap(image: NativeImage): RasterImage {
  const { width, height } = image.getSize();
  return {
    width,
    height,
    resize: (w, h) => wrap(image.resize({ width: w, height: h, quality: 'best' })),
    toPNG: () => image.toPNG(),
    toJPEG: (quality) => image.toJPEG(quality),
  };
}

/** Electron's decoder (Chromium image decoders): fully decodes the pixels or reports failure. */
export const rasterNativeImage: RasterDecoder = (bytes) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width < 1 || height < 1 || image.toBitmap().length !== width * height * 4) return null;
  return wrap(image);
};
