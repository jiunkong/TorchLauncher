import {
  BRANDING_LIMITS,
  type BrandingAssetMetadata,
  type BrandingRole,
} from '../../../../packages/core/src/branding/index.js';
import type { StudioImageIoCause } from '../shared/studio.js';
import { type ImageDecoder, validateImage } from './branding.js';
import { ImageFailure, StudioFailure } from './project.js';

/** Largest source file read for a branding image. */
export const BRANDING_SOURCE_LIMITS = {
  bytes: 32 * 1024 ** 2,
  pixels: 64_000_000,
} as const;
/** Upper bound of encode attempts per image (each attempt is one full encode). */
export const BRANDING_MAX_ATTEMPTS = 10;

/** A decoded raster image; the real implementation wraps Electron's `nativeImage`. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): RasterImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
}
/** Returns null when the bytes are empty, unsupported or corrupt. */
export type RasterDecoder = (bytes: Buffer) => RasterImage | null;
export interface PreparedBrandingImage {
  readonly bytes: Buffer;
  readonly metadata: BrandingAssetMetadata;
  /** True when the original bytes were kept unchanged. */
  readonly original: boolean;
}

type Header = { kind: 'png' | 'jpeg'; width: number; height: number } | { kind: 'broken' } | null;

/** Reads PNG/JPEG dimensions from the header only, before any decoding. */
export function readImageHeader(bytes: Uint8Array): Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452)
      return { kind: 'broken' };
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { kind: 'png', width, height } : { kind: 'broken' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor++] !== 0xff) return { kind: 'broken' };
      while (bytes[cursor] === 0xff) cursor += 1;
      const marker = bytes[cursor++];
      if (marker === undefined || marker === 0 || marker === 0xd9 || marker === 0xda)
        return { kind: 'broken' };
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (cursor + 2 > bytes.length) return { kind: 'broken' };
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) return { kind: 'broken' };
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) return { kind: 'broken' };
        const height = view.getUint16(cursor + 3);
        const width = view.getUint16(cursor + 5);
        return width > 0 && height > 0 ? { kind: 'jpeg', width, height } : { kind: 'broken' };
      }
      cursor += length;
    }
    return { kind: 'broken' };
  }
  return null;
}

function fitScale(role: BrandingRole, width: number, height: number): number {
  const limit = BRANDING_LIMITS[role];
  return Math.min(
    1,
    limit.width / width,
    limit.height / height,
    Math.sqrt(limit.pixels / (width * height)),
  );
}
function scaledSize(role: BrandingRole, width: number, height: number, factor: number) {
  const limit = BRANDING_LIMITS[role];
  const scale = fitScale(role, width, height) * factor;
  let w = Math.max(1, Math.floor(width * scale));
  let h = Math.max(1, Math.floor(height * scale));
  while (w > limit.width || h > limit.height || w * h > limit.pixels) {
    w = Math.max(1, w - 1);
    h = Math.max(1, h - 1);
  }
  return { width: w, height: h };
}

/** The file name only (no directories), without control characters and at most 100 characters. */
export function displayFileName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose
  const clean = name.replace(/[\u0000-\u001f\u007f]/gu, '');
  return clean.length > 100 ? `${clean.slice(0, 97)}...` : clean;
}
/** Classifies a file-system failure without exposing the OS message or any path. */
export function ioCause(error: unknown): StudioImageIoCause {
  if (error instanceof StudioFailure) return error.code === 'IO' ? 'changed' : 'notFile';
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'denied';
  if (code === 'ENOENT') return 'notFound';
  if (code === 'EISDIR' || code === 'ELOOP' || code === 'ENOTDIR') return 'notFile';
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'diskFull';
  return 'other';
}

/**
 * Produces bytes that pass `validateImage` for the role. A valid source is kept byte for byte;
 * otherwise it is decoded, scaled down to fit the dimension and pixel limits (aspect ratio kept),
 * re-encoded, and shrunk further for at most BRANDING_MAX_ATTEMPTS encodes until it fits the byte
 * limit. Icons are always PNG. Backgrounds stay JPEG for JPEG sources; other sources try PNG first
 * and fall back to JPEG when the PNG does not fit. Failures are ImageFailure with exact values.
 */
export function prepareBrandingImage(
  role: BrandingRole,
  name: string,
  source: Buffer,
  raster: RasterDecoder,
  decode: ImageDecoder,
): PreparedBrandingImage {
  const fail = (extra: Record<string, unknown> & { reason: string }): never => {
    throw new ImageFailure({ role, name, ...extra } as ConstructorParameters<
      typeof ImageFailure
    >[0]);
  };
  if (source.length < 1)
    return fail({ reason: 'corrupt', part: 'empty', format: null, width: null, height: null });
  if (source.length > BRANDING_SOURCE_LIMITS.bytes)
    return fail({
      reason: 'fileTooLarge',
      bytes: source.length,
      limit: BRANDING_SOURCE_LIMITS.bytes,
    });
  try {
    return { bytes: source, metadata: validateImage(role, source, decode), original: true };
  } catch {
    // Not directly usable: convert below.
  }
  const header = readImageHeader(source);
  if (header?.kind === 'broken') {
    const format = source[0] === 0xff ? 'JPEG' : 'PNG';
    return fail({ reason: 'corrupt', part: 'header', format, width: null, height: null });
  }
  if (header && header.width * header.height > BRANDING_SOURCE_LIMITS.pixels)
    return fail({
      reason: 'tooManyPixels',
      width: header.width,
      height: header.height,
      limit: BRANDING_SOURCE_LIMITS.pixels,
    });
  const image = raster(source);
  if (!image || image.width < 1 || image.height < 1) {
    if (!header) return fail({ reason: 'unsupported' });
    return fail({
      reason: 'corrupt',
      part: 'data',
      format: header.kind === 'png' ? 'PNG' : 'JPEG',
      width: header.width,
      height: header.height,
    });
  }
  if (image.width * image.height > BRANDING_SOURCE_LIMITS.pixels)
    return fail({
      reason: 'tooManyPixels',
      width: image.width,
      height: image.height,
      limit: BRANDING_SOURCE_LIMITS.pixels,
    });
  const limit = BRANDING_LIMITS[role].length;
  const jpegSource = header?.kind === 'jpeg';
  const sourceFormat: 'PNG' | 'JPEG' | null = header ? (jpegSource ? 'JPEG' : 'PNG') : null;
  let factor = 1;
  let format: 'png' | 'jpeg' = role === 'background' && jpegSource ? 'jpeg' : 'png';
  let quality = 92;
  let last = { bytes: 0, width: image.width, height: image.height };
  let attempts = 0;
  for (; attempts < BRANDING_MAX_ATTEMPTS; ) {
    const size = scaledSize(role, image.width, image.height, factor);
    const resized =
      size.width === image.width && size.height === image.height
        ? image
        : image.resize(size.width, size.height);
    let encoded: Buffer;
    try {
      encoded = format === 'png' ? resized.toPNG() : resized.toJPEG(quality);
    } catch {
      return fail({
        reason: 'corrupt',
        part: 'data',
        format: sourceFormat,
        width: image.width,
        height: image.height,
      });
    }
    attempts += 1;
    last = { bytes: encoded.length, width: size.width, height: size.height };
    if (encoded.length > 0 && encoded.length <= limit) {
      try {
        return {
          bytes: encoded,
          metadata: validateImage(role, encoded, decode),
          original: false,
        };
      } catch {
        return fail({
          reason: 'corrupt',
          part: 'data',
          format: sourceFormat,
          width: image.width,
          height: image.height,
        });
      }
    }
    if (format === 'png' && role === 'background') {
      format = 'jpeg';
      continue;
    }
    if (format === 'jpeg' && quality > 60) quality -= 12;
    else factor *= format === 'jpeg' ? 0.85 : 0.75;
  }
  return fail({ reason: 'cannotFit', attempts, ...last, limit });
}
