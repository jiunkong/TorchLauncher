import type {
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
  readonly signal?: AbortSignal;
  /** Awaited to provide backpressure; callback failure cancels the operation before commit. */
  readonly onProgress?: (progress: DeploymentWriteProgress) => void | Promise<void>;
}

export interface WriteDeploymentResult {
  readonly outputPath: string;
  readonly header: DeploymentHeader;
  readonly index: DeploymentIndex;
}
