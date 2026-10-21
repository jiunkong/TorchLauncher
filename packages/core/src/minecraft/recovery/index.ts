// GAME-05 crash recovery. Intentionally not re-exported from the package index yet (#0 wires it).
export type {
  InspectOptions,
  PresenceState,
  RecoverOptions,
  RecoveryAction,
  RecoveryIssue,
  RecoveryIssueCode,
  ServerEnvironmentInspection,
  ServerRecoveryReport,
} from './environment';
export { inspectServerEnvironment, recoverServerEnvironment } from './environment';
export type {
  InstallInvalidReason,
  InstallRecoveryAction,
  InstallTransactionInspection,
  InstallTransactionState,
} from './install';
export type { LockEvidence, ServerLockAssessment, ServerLockState } from './lock-assessment';
