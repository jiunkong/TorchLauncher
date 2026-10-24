import type { ResourceSnapshot } from '../../download/http/index.js';
import type { BrandingRole, DeploymentHeader, DeploymentIndex } from '../contracts/index.js';

export interface OpenDeploymentReaderOptions {
  /** Trusted server identity from local launcher configuration. */
  readonly expectedServerId: string;
  /**
   * Trusted Ed25519 public key (base64url text or 32 raw bytes) from the server configuration.
   * When present the signature must verify under this key. Launchers always pass the configured key.
   * Omit only for structural inspection; the result is unverified.
   */
  readonly trustedPublicKey?: string | Uint8Array;
  readonly signal?: AbortSignal;
  /** Reader operational response chunk cap; cannot exceed 4 MiB. */
  readonly rangeChunkBytes?: number;
  /** Local decoded-file budget; the format maximum remains 4 GiB. */
  readonly maxFileBytes?: number;
  /** Local stored-payload budget; defaults to the format's 4 GiB per-file maximum. */
  readonly maxStoredFileBytes?: number;
}

export interface StageDeploymentFileOptions {
  readonly signal?: AbortSignal;
}

export interface StagedDeploymentFile {
  readonly path: string;
  readonly outputPath: string;
  readonly length: number;
  readonly sha256: string;
}

export interface DeploymentReader {
  readonly header: DeploymentHeader;
  readonly index: DeploymentIndex;
  readonly sourceId: string;
  readonly sourceGeneration: number;
  readonly snapshot: ResourceSnapshot;
  /** Throws if the source was reset, changed generation, or no longer matches its pinned snapshot. */
  assertCurrent(): void;
  /** Stream one verified entry to a fresh path. The destination is never overwritten. */
  stageFile(
    path: string,
    newScratchPath: string,
    options?: StageDeploymentFileOptions,
  ): Promise<StagedDeploymentFile>;
}

export interface StagedBrandingAsset {
  readonly role: BrandingRole;
  readonly outputPath: string;
  readonly length: number;
  readonly sha256: string;
}

/** Extension preserves existing injected DeploymentReader implementations and game-only mocks. */
export interface BrandingDeploymentReader extends DeploymentReader {
  /**
   * Always set by openDeploymentReader. Optional only so existing injected mocks stay valid;
   * consumers treat a missing value as unverified.
   */
  readonly verification?: DeploymentVerification;
  /** No game-relative destination is accepted. Absent/null roles fail without requesting payload. */
  stageBrandingAsset(
    role: BrandingRole,
    newScratchPath: string,
    options?: StageDeploymentFileOptions,
  ): Promise<StagedBrandingAsset>;
}

/**
 * 'verified': v1.2 signature checked against the trusted key before the index was parsed.
 * 'unverified': v1.2, structurally valid, but no key was supplied (nothing authenticated).
 */
export type DeploymentVerification = 'verified' | 'unverified';
