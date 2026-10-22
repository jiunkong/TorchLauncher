import { join, resolve } from 'node:path';
import { readIntent } from '../../instance/mods/registry.js';
import { recoverUserMods } from '../../instance/mods/service.js';
import { recoverSynchronization } from '../../instance/sync/engine.js';
import type { RecoveryResult as SynchronizationRecoveryResult } from '../../instance/sync/types.js';
import { stat } from '../filesystem';
import { type ProcessProbe, systemProcessProbe } from '../identity';
import {
  acquireServerDataLock,
  parseLockOwner,
  reclaimServerDataLock,
  type ServerDataLease,
  ServerDataLockedError,
} from '../lock';
import {
  type InstallRecoveryAction,
  type InstallTransactionInspection,
  inspectInstallTransaction,
  recoverInstallTransaction,
} from './install';
import { type ServerLockAssessment, snapshotServerLock } from './lock-assessment';

export type PresenceState = 'none' | 'present' | 'invalid';
export interface ServerEnvironmentInspection {
  root: string;
  serverLock: ServerLockAssessment;
  install: InstallTransactionInspection;
  /** Leftover synchronization journal/transaction (`.torchlauncher-sync`). */
  synchronization: PresenceState;
  /** Leftover user-mod intent (`.torchlauncher-user/mods-intent.json`). */
  userMods: PresenceState;
  /** Something needs `recoverServerEnvironment` (possibly with user confirmation). */
  needsRecovery: boolean;
}
export interface InspectOptions {
  probe?: ProcessProbe;
}
export interface RecoverOptions extends InspectOptions {
  /** Required for synchronization and user-mod recovery steps. */
  serverId?: string;
  /**
   * The user confirmed no game/launcher is running. Releases an `uncertain` lock, never one with
   * a positively identified live game child or an unsafe lock entry.
   */
  acceptUncertain?: boolean;
  signal?: AbortSignal;
}
export type RecoveryAction =
  | { kind: 'server-lock-reclaimed'; basis: 'verified' | 'user-confirmed' }
  | InstallRecoveryAction
  | { kind: 'synchronization-recovered'; result: SynchronizationRecoveryResult }
  | { kind: 'user-mods-recovered'; outcome: string; temporaryRemoved: number };
export type RecoveryIssueCode =
  | 'root-unavailable'
  | 'lock-held-live'
  | 'lock-uncertain'
  | 'lock-child-alive'
  | 'lock-unsafe'
  | 'lock-contended'
  | 'lock-release-failed'
  | 'install-invalid'
  | 'install-recovery-failed'
  | 'server-id-required'
  | 'synchronization-invalid'
  | 'synchronization-recovery-failed'
  | 'user-mods-invalid'
  | 'user-mods-recovery-failed'
  | 'aborted';
export interface RecoveryIssue {
  code: RecoveryIssueCode;
  /** Safe machine-readable detail (errno, sync/user-mod error code or invalid reason). */
  detail?: string;
}
export interface ServerRecoveryReport {
  /** clean: nothing to do; recovered: all done; blocked: lock not obtained; incomplete: issues remain. */
  status: 'clean' | 'recovered' | 'blocked' | 'incomplete';
  actions: RecoveryAction[];
  issues: RecoveryIssue[];
  /** Fresh inspection after recovery. */
  environment: ServerEnvironmentInspection;
}

function safeCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(code) ? code : 'unknown';
}
async function synchronizationPresence(root: string): Promise<PresenceState> {
  const internal = join(root, '.torchlauncher-sync');
  const info = await stat(internal);
  if (!info) return 'none';
  if (!info.isDirectory() || info.isSymbolicLink()) return 'invalid';
  for (const name of ['journal.json', 'journal.pending', 'transaction'])
    if (await stat(join(internal, name))) return 'present';
  return 'none';
}
async function userModPresence(root: string): Promise<PresenceState> {
  try {
    return (await readIntent(root)) ? 'present' : 'none';
  } catch {
    return 'invalid';
  }
}

/** Read-only classification of every crash-recovery artifact in a server data root. */
export async function inspectServerEnvironment(
  rootPath: string,
  options: InspectOptions = {},
): Promise<ServerEnvironmentInspection> {
  const root = resolve(rootPath);
  const probe = options.probe ?? systemProcessProbe();
  const info = await stat(root);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new Error('Server data root is missing or not a plain directory');
  const { assessment } = await snapshotServerLock(root, probe);
  const install = await inspectInstallTransaction(root);
  const synchronization = await synchronizationPresence(root);
  const userMods = await userModPresence(root);
  return {
    root,
    serverLock: assessment,
    install,
    synchronization,
    userMods,
    needsRecovery:
      assessment.state === 'stale-verified' ||
      assessment.state === 'uncertain' ||
      install.state !== 'none' ||
      synchronization !== 'none' ||
      userMods !== 'none',
  };
}

/**
 * Recover verified-stale state only. The server lock is held continuously (reclaimed in place or
 * freshly acquired as `maintenance`) while the installation transaction is resolved; the existing
 * synchronization and user-mod recoveries then run under their own maintenance leases.
 */
export async function recoverServerEnvironment(
  rootPath: string,
  options: RecoverOptions = {},
): Promise<ServerRecoveryReport> {
  const root = resolve(rootPath);
  const probe = options.probe ?? systemProcessProbe();
  const actions: RecoveryAction[] = [];
  const issues: RecoveryIssue[] = [];
  const finish = async (blocked: boolean): Promise<ServerRecoveryReport> => {
    const environment = await inspectServerEnvironment(root, { probe });
    const status = blocked
      ? 'blocked'
      : issues.length
        ? 'incomplete'
        : actions.length
          ? 'recovered'
          : 'clean';
    return { status, actions, issues, environment };
  };
  const info = await stat(root);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new Error('Server data root is missing or not a plain directory');

  const snapshot = await snapshotServerLock(root, probe);
  const lock = snapshot.assessment;
  let lease: ServerDataLease;
  try {
    if (lock.state === 'free') {
      lease = await acquireServerDataLock(root, 'maintenance', { probe });
    } else if (lock.state === 'held-live') {
      issues.push({ code: 'lock-held-live' });
      return finish(true);
    } else if (lock.state === 'stale-verified' && snapshot.ownerText !== undefined) {
      lease = await reclaimServerDataLock(root, snapshot.ownerText, { probe });
      actions.push({ kind: 'server-lock-reclaimed', basis: 'verified' });
    } else {
      if (lock.childAlive) issues.push({ code: 'lock-child-alive' });
      else if (!lock.confirmable || snapshot.ownerText === undefined)
        issues.push({ code: 'lock-unsafe' });
      else if (!options.acceptUncertain) issues.push({ code: 'lock-uncertain' });
      if (issues.length) return finish(true);
      lease = await reclaimServerDataLock(root, snapshot.ownerText ?? null, { probe });
      actions.push({ kind: 'server-lock-reclaimed', basis: 'user-confirmed' });
    }
  } catch (error) {
    if (!(error instanceof ServerDataLockedError)) throw error;
    issues.push({ code: 'lock-contended' });
    return finish(true);
  }

  try {
    options.signal?.throwIfAborted();
    const install = await recoverInstallTransaction(lease.root);
    if (install.action) actions.push(install.action);
    if (install.invalid) issues.push({ code: 'install-invalid', detail: install.invalid });
  } catch (error) {
    issues.push(
      (error as Error)?.name === 'AbortError'
        ? { code: 'aborted' }
        : { code: 'install-recovery-failed', detail: safeCode(error) },
    );
  } finally {
    try {
      await lease.release();
    } catch (error) {
      issues.push({ code: 'lock-release-failed', detail: safeCode(error) });
    }
  }
  if (issues.length) return finish(false);

  // Sync/user-mod recoveries own their maintenance lease; see GAME-05 handoff for the gap.
  const synchronization = await synchronizationPresence(root);
  const userMods = await userModPresence(root);
  if ((synchronization !== 'none' || userMods !== 'none') && !options.serverId) {
    issues.push({ code: 'server-id-required' });
    return finish(false);
  }
  if (synchronization === 'invalid') issues.push({ code: 'synchronization-invalid' });
  else if (synchronization === 'present' && options.serverId) {
    try {
      options.signal?.throwIfAborted();
      const result = await recoverSynchronization({ root, expectedServerId: options.serverId });
      actions.push({ kind: 'synchronization-recovered', result });
    } catch (error) {
      issues.push(
        error instanceof ServerDataLockedError
          ? { code: 'lock-contended' }
          : (error as Error)?.name === 'AbortError'
            ? { code: 'aborted' }
            : { code: 'synchronization-recovery-failed', detail: safeCode(error) },
      );
    }
  }
  if (userMods === 'invalid') issues.push({ code: 'user-mods-invalid' });
  else if (userMods === 'present' && options.serverId) {
    try {
      const result = await recoverUserMods({
        root,
        serverId: options.serverId,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      actions.push({
        kind: 'user-mods-recovered',
        outcome: result.outcome,
        temporaryRemoved: result.temporaryRemoved,
      });
    } catch (error) {
      issues.push(
        safeCode(error) === 'locked'
          ? { code: 'lock-contended' }
          : { code: 'user-mods-recovery-failed', detail: safeCode(error) },
      );
    }
  }
  return finish(false);
}

/** Reclaim only a verified dead game lease; never repair unrelated transactions automatically. */
export async function recoverExitedGameLock(
  root: string,
  options: InspectOptions = {},
): Promise<boolean> {
  const probe = options.probe ?? systemProcessProbe();
  const environment = await inspectServerEnvironment(root, { probe });
  if (
    environment.install.state !== 'none' ||
    environment.synchronization !== 'none' ||
    environment.userMods !== 'none'
  )
    return false;
  const snapshot = await snapshotServerLock(root, probe);
  if (
    snapshot.assessment.state !== 'stale-verified' ||
    snapshot.assessment.purpose !== 'game' ||
    !snapshot.ownerText
  )
    return false;
  const record = parseLockOwner(snapshot.ownerText);
  if (
    record.state !== 'v2' ||
    !record.owner.start ||
    !record.owner.host.machine ||
    record.owner.child?.state !== 'running' ||
    !record.owner.child.start
  )
    return false;
  const lease = await reclaimServerDataLock(root, snapshot.ownerText, { probe });
  await lease.release();
  return true;
}
