import { nativeImage } from 'electron';
import type { ImageDecoder } from './branding.js';

export const decodeNativeImage: ImageDecoder = (bytes) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('INVALID');
  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length !== size.width * size.height * 4) throw new Error('INVALID');
  return size;
};
