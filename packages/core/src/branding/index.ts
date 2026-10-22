/** Encoded-image checks only. Applications must fully decode before displaying an asset. */
export const BRANDING_ROLES = ['icon', 'background'] as const;
export type BrandingRole = (typeof BRANDING_ROLES)[number];
export type BrandingMediaType = 'image/png' | 'image/jpeg';
export const BRANDING_LIMITS = {
  icon: { length: 1024 ** 2, width: 512, height: 512, pixels: 512 ** 2 },
  background: { length: 8 * 1024 ** 2, width: 3840, height: 2160, pixels: 8_294_400 },
} as const;

export interface BrandingAssetMetadata {
  readonly sha256: string;
  readonly length: number;
  readonly mediaType: BrandingMediaType;
}

export function isBrandingMediaType(
  role: BrandingRole,
  value: unknown,
): value is BrandingMediaType {
  return value === 'image/png' || (role === 'background' && value === 'image/jpeg');
}

export function isBrandingAssetMetadata(role: BrandingRole, value: BrandingAssetMetadata): boolean {
  return (
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    Number.isSafeInteger(value.length) &&
    value.length > 0 &&
    value.length <= BRANDING_LIMITS[role].length &&
    isBrandingMediaType(role, value.mediaType)
  );
}

export interface BrandingImageDimensions {
  readonly width: number;
  readonly height: number;
}

/** Bounded scan of PNG IHDR or JPEG markers. This does not validate pixels or file completeness. */
export function inspectBrandingImage(
  role: BrandingRole,
  mediaType: BrandingMediaType,
  bytes: Uint8Array,
): BrandingImageDimensions {
  const fail = (): never => {
    throw new Error('Invalid branding image header');
  };
  if (
    !BRANDING_ROLES.includes(role) ||
    !isBrandingMediaType(role, mediaType) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > BRANDING_LIMITS[role].length
  )
    return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (mediaType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 33 ||
      signature.some((byte, i) => bytes[i] !== byte) ||
      view.getUint32(8) !== 13 ||
      view.getUint32(12) !== 0x49484452
    )
      return fail();
    width = view.getUint32(16);
    height = view.getUint32(20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    const validDepths =
      colorType === 0
        ? [1, 2, 4, 8, 16]
        : colorType === 3
          ? [1, 2, 4, 8]
          : colorType === 2 || colorType === 4 || colorType === 6
            ? [8, 16]
            : [];
    if (bitDepth === undefined || !validDepths.includes(bitDepth)) return fail();
    // Compression, filtering and interlace methods are constrained by the PNG specification.
    if (bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) return fail();
  } else {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail();
    let cursor = 2;
    while (cursor < bytes.length) {
      if (bytes[cursor++] !== 0xff) return fail();
      while (bytes[cursor] === 0xff) cursor += 1;
      const marker = bytes[cursor++];
      if (
        marker === undefined ||
        marker === 0 ||
        marker === 0xd8 ||
        marker === 0xd9 ||
        marker === 0xda
      )
        return fail();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) return fail();
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) return fail();
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        const components = bytes[cursor + 7];
        if (length < 8 || !components || length !== 8 + 3 * components) return fail();
        height = view.getUint16(cursor + 3);
        width = view.getUint16(cursor + 5);
        break;
      }
      cursor += length;
    }
  }
  const limits = BRANDING_LIMITS[role];
  if (
    width < 1 ||
    height < 1 ||
    width > limits.width ||
    height > limits.height ||
    width * height > limits.pixels
  )
    return fail();
  return { width, height };
}
