import { AuthenticationError } from '@torchlauncher/core/auth';
import { SynchronizationError } from '../../../../../packages/core/src/instance/sync/types';
import { ServerDataLockedError } from '../../../../../packages/core/src/minecraft/lock';
import { type GameExit, GameStartError } from '../../../../../packages/core/src/minecraft/process';
import { HostAuthenticationError } from '../auth/errors';

const gameCodes = new Set([
  'EINSTALLRECOVERY',
  'EGUARDCONFIG',
  'EGUARDTIMEOUT',
  'EGUARDCANCELLED',
  'EDEPLOYMENTCHANGED',
  'ESERVERIDENTITY',
  'EINSTALLIDENTITY',
  'EAUTHEXPIRED',
  'ESYNCGUARD',
  'ENOENT',
  'EACCES',
  'UNKNOWN',
]);
const authCodes = new Set([
  'invalid_configuration',
  'busy',
  'cancelled',
  'timeout',
  'invalid_callback',
  'browser_failed',
  'access_denied',
  'reauthentication_required',
  'no_session',
  'invalid_session',
  'storage_failed',
  'network_failed',
  'http_failed',
  'app_registration_rejected',
  'invalid_response',
  'xbox_account_required',
  'xbox_region_restricted',
  'xbox_adult_verification_required',
  'xbox_family_required',
  'xbox_rejected',
  'game_not_owned',
  'profile_required',
  'token_expired',
  'secure_storage_unavailable',
  'callback_timeout',
]);
const stages = new Set([
  'configuration',
  'browser',
  'oauth',
  'xbox',
  'xsts',
  'minecraft',
  'entitlements',
  'profile',
  'storage',
]);
const phases = new Set([
  'starting',
  'base-install',
  'loader-install',
  'latest-deployment',
  'deployment',
  'installation',
  'authentication',
  'synchronization',
  'final-guard',
  'spawn',
  'game-running',
]);
const syncCodes = new Set([
  'invalid-state',
  'server-mismatch',
  'unsafe-path',
  'conflict',
  'local-changed',
  'limit-exceeded',
  'recovery-required',
]);
export function safeFailure(error: unknown, phase: string, cancelled: boolean) {
  phase = phases.has(phase) ? phase : 'operation';
  let status: number | undefined;
  let code = 'operation_failed';
  let stage: string | undefined;
  if (cancelled) code = 'cancelled';
  else if (error instanceof GameStartError)
    code = gameCodes.has(error.code) ? error.code : 'game_start_failed';
  else if (error instanceof HostAuthenticationError)
    code = authCodes.has(error.code) ? error.code : 'authentication_failed';
  else if (error instanceof AuthenticationError) {
    code = authCodes.has(error.code) ? error.code : 'authentication_failed';
    stage = stages.has(error.stage) ? error.stage : undefined;
    if (
      Number.isInteger(error.status) &&
      typeof error.status === 'number' &&
      error.status >= 100 &&
      error.status <= 599
    )
      status = error.status;
  } else if (error instanceof SynchronizationError)
    code = syncCodes.has(error.code) ? `sync_${error.code}` : 'sync_failed';
  else if (error instanceof ServerDataLockedError) code = 'server_data_locked';
  return {
    ok: false,
    phase,
    code,
    ...(stage ? { stage } : {}),
    ...(status ? { status } : {}),
    authenticatedConnection: false,
  };
}
/** Fixed allowlist of fatal JVM/launcher error classes; matched text is never returned. */
const fatalClasses: [string, RegExp][] = [
  ['module_resolution_failed', /java\.lang\.module\.(?:FindException|ResolutionException)/],
  ['class_not_found', /ClassNotFoundException|NoClassDefFoundError/],
  ['unsupported_class_version', /UnsupportedClassVersionError/],
  ['out_of_memory', /OutOfMemoryError/],
  [
    'jvm_creation_failed',
    /Could not create the Java Virtual Machine|Error occurred during initialization of VM/,
  ],
];
export function classifyFatalLog(logs: GameExit['logs']): string | undefined {
  for (const [name, pattern] of fatalClasses)
    if (logs.entries.some((entry) => pattern.test(entry.text))) return name;
  return undefined;
}
export function safeGameExit(result: GameExit, durationElapsed: boolean) {
  const controlledStop = durationElapsed && result.reason === 'stopped';
  const failed = !(
    !result.errorCode &&
    ((result.reason === 'exited' && result.code === 0) ||
      (controlledStop && (result.code === null || result.code === 0)))
  );
  const fatal = failed ? classifyFatalLog(result.logs) : undefined;
  return {
    ok:
      !result.errorCode &&
      ((result.reason === 'exited' && result.code === 0) ||
        (controlledStop && (result.code === null || result.code === 0))),
    mode: 'launch',
    spawned: true,
    exitCode: result.code,
    exitReason: result.reason,
    ...(result.signal ? { exitSignal: result.signal } : {}),
    ...(failed ? { code: fatal ?? 'game_exited_abnormally' } : {}),
    completion: controlledStop
      ? 'duration_elapsed'
      : result.reason === 'cancelled'
        ? 'cancelled'
        : 'process_exit',
    authenticatedConnection: 'not-asserted',
  };
}
