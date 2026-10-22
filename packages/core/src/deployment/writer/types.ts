import type {
  BrandingMediaType,
  DeploymentCompression,
  DeploymentFilePolicy,
  DeploymentGame,
  DeploymentHeader,
  DeploymentIndex,
} from '../contracts/index.js';

export interface DeploymentInputFile {
  /** Exact disk spelling, slash-separated and relative to sourceRoot. Never followed through links. */
  readonly sourcePath: string;
  /** Container destination, normalized to NFC. Defaults to sourcePath. */
  readonly path?: string;
  readonly policy: DeploymentFilePolicy;
  /** Empty inputs become none; gzip exceeding the v1 ratio limit fails. */
  readonly compression: DeploymentCompression;
}

export interface DeploymentBrandingInput {
  /** Bounded encoded bytes, synchronously copied before writeDeployment first awaits. */
  readonly bytes: Uint8Array;
  readonly mediaType: BrandingMediaType;
}

export interface DeploymentBrandingInputs {
  /** Omitted role retains remote display; null explicitly selects the default. */
  readonly icon?: DeploymentBrandingInput | null;
  readonly background?: DeploymentBrandingInput | null;
}

export interface DeploymentWriteProgress {
  readonly phase: 'reading' | 'assembling';
  readonly processedBytes: number;
  readonly sourcePath?: string;
}

export interface WriteDeploymentOptions {
  readonly sourceRoot: string;
  /** Existing parent directory. An existing regular output is replaced only at commit. */
  readonly outputPath: string;
  readonly serverId: string;
  readonly deploymentId: string;
  readonly game: DeploymentGame;
  readonly files: readonly DeploymentInputFile[];
  /** When present (even {}), emits v1.1. Omit for byte-compatible v1.0 output. */
  readonly branding?: DeploymentBrandingInputs;
  /**
   * v1.2: monotonically increasing deployment number (safe integer >= 1). Must be given together
   * with `sign`; either alone is invalid input.
   */
  readonly sequence?: number;
  /**
   * Signs `"TORCHPACK-SIG-v1\0" || header(64)` with the project's Ed25519 key and returns the
   * 64-byte signature. Core never holds private keys. When present, emits v1.2 (branding optional).
   */
  readonly sign?: (message: Buffer) => Buffer | Promise<Buffer>;
  readonly signal?: AbortSignal;
  /** Awaited to provide backpressure; callback failure cancels the operation before commit. */
  readonly onProgress?: (progress: DeploymentWriteProgress) => void | Promise<void>;
}

export interface WriteDeploymentResult {
  readonly outputPath: string;
  readonly header: DeploymentHeader;
  readonly index: DeploymentIndex;
}
