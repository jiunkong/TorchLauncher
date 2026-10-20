export const DEPLOYMENT_MAGIC = 'TORCHDEP';
export const DEPLOYMENT_HEADER_LENGTH = 64;
export const DEPLOYMENT_FORMAT_VERSION = { major: 1, minor: 0 } as const;
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
  readonly minor: 0;
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

export interface DeploymentFile {
  /** NFC Unicode, slash-separated relative path within the portable UTF-8 byte limits. */
  readonly path: string;
  readonly sha256: string;
  /** Relative to the first payload byte, not the container start. */
  readonly offset: number;
  readonly storedLength: number;
  readonly originalLength: number;
  readonly compression: DeploymentCompression;
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
}

export interface DeploymentValidationContext {
  /** Trusted launcher configuration, never a value copied from the untrusted index. */
  readonly expectedServerId: string;
}

/** Inclusive HTTP byte range, in absolute container coordinates. */
export interface DeploymentByteRange {
  readonly start: number;
  readonly endInclusive: number;
}
