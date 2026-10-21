import { join } from 'node:path';
import type { DeploymentFilePolicy } from '../../deployment/contracts/index.js';
import { checkedDirectory, fail, maybeStat } from './safety.js';
import { LEDGER_BYTE_LIMIT, readCanonical, validateLedger, validateServerId } from './state.js';

export interface SyncOwnedFile {
  readonly path: string;
  readonly policy: DeploymentFilePolicy;
  readonly sha256: string;
  readonly length: number;
}

export interface SyncOwnership {
  readonly serverId: string;
  readonly deploymentId: string;
  readonly initialized: boolean;
  readonly files: readonly SyncOwnedFile[];
}

/**
 * Read-only view of the operator-managed file ledger written by synchronizeDeployment.
 * Returns null when no deployment has ever been applied. Corrupt state throws
 * SynchronizationError('invalid-state'); an interrupted transaction throws
 * SynchronizationError('recovery-required') because the ledger may be stale. The caller holds the
 * server-data lock.
 */
export async function readSyncOwnership(
  root: string,
  serverId: string,
): Promise<SyncOwnership | null> {
  validateServerId(serverId);
  await checkedDirectory(root);
  const internal = join(root, '.torchlauncher-sync');
  if (!(await maybeStat(internal))) return null;
  await checkedDirectory(internal);
  for (const name of ['journal.json', 'journal.pending', 'transaction']) {
    if (await maybeStat(join(internal, name))) fail('recovery-required');
  }
  const value = await readCanonical(join(internal, 'ledger.json'), LEDGER_BYTE_LIMIT);
  if (value === undefined) return null;
  const ledger = validateLedger(value, serverId);
  if (JSON.stringify(value) !== JSON.stringify(ledger)) fail('invalid-state');
  return {
    serverId: ledger.serverId,
    deploymentId: ledger.deploymentId,
    initialized: ledger.initialized,
    files: ledger.files.map((file) => ({
      path: file.path,
      policy: file.policy,
      sha256: file.sha256,
      length: file.length,
    })),
  };
}
