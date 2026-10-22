import { nativeImage } from 'electron';
import { inspectBrandingImage } from '../../../../../packages/core/src/server-config/index';
import { type BrandingOptions, BrandingService } from './service';

export { BrandingService } from './service';

export function createBrandingService(options: Omit<BrandingOptions, 'decode'>): BrandingService {
  return new BrandingService({
    ...options,
    decode(role, mediaType, bytes) {
      const expected = inspectBrandingImage(role, mediaType, bytes);
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) return false;
      const actual = image.getSize();
      return (
        actual.width === expected.width &&
        actual.height === expected.height &&
        image.toBitmap().byteLength === expected.width * expected.height * 4
      );
    },
  });
}
