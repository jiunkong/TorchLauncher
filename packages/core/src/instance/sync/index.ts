export { recoverSynchronization, synchronizeDeployment } from './engine.js';
export { assertSynchronizedForLaunch } from './launch-guard.js';
export type {
  RecoveryResult,
  SyncCounts,
  SynchronizeDeploymentOptions,
  SyncProgress,
  SyncResult,
} from './types.js';
export { SynchronizationError } from './types.js';
