import type { DeploymentReader } from '../../deployment/reader/index.js';

export interface SyncCounts {
  readonly downloaded: number;
  readonly reused: number;
  readonly preserved: number;
  readonly deleted: number;
}

export interface SyncProgress extends SyncCounts {
  readonly phase: 'planning' | 'staging' | 'applying' | 'recovering';
  readonly path?: string;
}

export interface SyncFileActivity {
  readonly phase: 'staging' | 'applying';
  readonly state: 'started' | 'completed';
  readonly path: string;
}

export interface SynchronizeDeploymentOptions {
  readonly root: string;
  readonly expectedServerId: string;
  readonly reader: DeploymentReader;
  readonly signal?: AbortSignal;
  /** Awaited. A callback failure before commit rolls the transaction back. */
  readonly onProgress?: (progress: SyncProgress) => void | Promise<void>;
  /** Awaited before/after each file operation. Failure before commit rolls back. */
  readonly onFileActivity?: (activity: SyncFileActivity) => void | Promise<void>;
}

export interface SyncResult extends SyncCounts {
  readonly deploymentId: string;
  readonly recovery: RecoveryResult;
}

export type RecoveryResult = 'none' | 'discarded-staging' | 'rolled-back' | 'cleaned-committed';

export class SynchronizationError extends Error {
  constructor(
    readonly code:
      | 'invalid-state'
      | 'server-mismatch'
      | 'unsafe-path'
      | 'conflict'
      | 'local-changed'
      | 'limit-exceeded'
      | 'recovery-required',
    options?: ErrorOptions,
  ) {
    super(`Synchronization failed: ${code}`, options);
    this.name = 'SynchronizationError';
  }
}
