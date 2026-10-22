import type { BrandingMediaType } from '../../branding/index.js';

export * from '../../branding/index.js';
export const DEPLOYMENT_MAGIC = 'TORCHDEP';
export const DEPLOYMENT_HEADER_LENGTH = 64;
export const DEPLOYMENT_BRANDING_FORMAT_VERSION = { major: 1, minor: 1 } as const;
export const DEPLOYMENT_SIGNED_FORMAT_VERSION = { major: 1, minor: 2 } as const;
export const DEPLOYMENT_FORMAT_VERSION = { major: 1, minor: 0 } as const;
/** v1.2 only: Ed25519 signature block placed directly after the 64-byte header. */
export const DEPLOYMENT_SIGNATURE_LENGTH = 64;
/** Domain-separation prefix of the signed message; the header bytes follow it. */
export const DEPLOYMENT_SIGNATURE_CONTEXT = 'TORCHPACK-SIG-v1\0';
export const DEPLOYMENT_LIMITS = {
  indexLength: 16 * 1024 ** 2,
  fileCount: 100_000,
  containerLength: 64 * 1024 ** 3,
  fileLength: 4 * 1024 ** 3,
  totalOriginalLength: 128 * 1024 ** 3,
  compressionRatio: 1_000,
  pathLength: 240, // UTF-8 bytes, including slash separators.
  pathComponentLength: 120, // UTF-8 bytes per component.
} as const;

export const EMPTY_FILE_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface DeploymentFormatVersion {
  readonly major: 1;
  readonly minor: 0 | 1 | 2;
}

/** Decoded header fields; binary decoding and digest verification belong to the reader. */
export interface DeploymentHeader {
  readonly magic: typeof DEPLOYMENT_MAGIC;
  readonly formatVersion: DeploymentFormatVersion;
  readonly flags: 0;
  readonly indexLength: number;
  readonly totalLength: number;
  /** Lowercase hex representation of the binary digest in header bytes 32–63. */
  readonly indexSha256: string;
}

export type DeploymentCompression = 'none' | 'gzip';
export type DeploymentFilePolicy = 'initial-only' | 'always';
export type DeploymentLoaderKind = 'fabric' | 'neoforge';

export interface DeploymentPayload {
  readonly sha256: string;
  /** Relative to the first payload byte, not the container start. */
  readonly offset: number;
  readonly storedLength: number;
  readonly originalLength: number;
  readonly compression: DeploymentCompression;
}

export interface DeploymentBrandingAsset extends DeploymentPayload {
  readonly mediaType: BrandingMediaType;
}

/** Absent roles retain current display; explicit null removes a role and selects the default. */
export interface DeploymentBranding {
  readonly icon?: DeploymentBrandingAsset | null;
  readonly background?: DeploymentBrandingAsset | null;
}

export interface DeploymentFile extends DeploymentPayload {
  /** NFC Unicode, slash-separated relative path within the portable UTF-8 byte limits. */
  readonly path: string;
  readonly policy: DeploymentFilePolicy;
}

export interface DeploymentGame {
  readonly minecraftVersion: string;
  readonly loader: {
    readonly kind: DeploymentLoaderKind;
    readonly version: string;
  };
}

export interface DeploymentIndex {
  readonly formatVersion: DeploymentFormatVersion;
  readonly serverId: string;
  readonly deploymentId: string;
  readonly game: DeploymentGame;
  readonly files: readonly DeploymentFile[];
  /** v1.2 only (required there, rejected in 1.0/1.1): safe integer >= 1, rises per deployment. */
  readonly sequence?: number;
  /** v1.1 and v1.2. Assets never belong to the game file namespace or ownership ledger. */
  readonly branding?: DeploymentBranding;
}

export interface DeploymentValidationContext {
  /** Trusted launcher configuration, never a value copied from the untrusted index. */
  readonly expectedServerId: string;
}

/** Bytes before the index: header, plus the signature block in v1.2. */
export function deploymentIndexStart(minor: number): number {
  return DEPLOYMENT_HEADER_LENGTH + (minor === 2 ? DEPLOYMENT_SIGNATURE_LENGTH : 0);
}

/** Absolute position of the first payload byte; payload offsets are relative to it. */
export function deploymentPayloadStart(header: DeploymentHeader): number {
  return deploymentIndexStart(header.formatVersion.minor) + header.indexLength;
}

/** Inclusive HTTP byte range, in absolute container coordinates. */
export interface DeploymentByteRange {
  readonly start: number;
  readonly endInclusive: number;
}
