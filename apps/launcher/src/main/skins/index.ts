import { nativeImage } from 'electron';
import { createSkinService, type PlayerSkinService, skinDimensions } from './service';

export type { PlayerSkinService } from './service';

export function createPlayerSkinService(): PlayerSkinService {
  return createSkinService({
    fetch: globalThis.fetch,
    canonicalize(png) {
      const expected = skinDimensions(png);
      if (!expected) return null;
      const image = nativeImage.createFromBuffer(png);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      if (size.width !== expected.width || size.height !== expected.height) return null;
      return image.toPNG();
    },
  });
}
