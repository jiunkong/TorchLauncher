import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stat } from '../filesystem';
import type { ProcessProbe } from '../identity';
import { type LockOwnerRead, type LockPurpose, readLockOwner } from '../lock';

export type ServerLockState = 'free' | 'held-live' | 'stale-verified' | 'uncertain';
export type LockEvidence =
  | 'owner-alive'
  | 'owner-exited'
  | 'owner-pid-reused'
  | 'owner-state-unknown'
  | 'child-alive'
  | 'child-exited'
  | 'child-pid-reused'
  | 'child-state-unknown'
  | 'child-unrecorded'
  | 'host-different'
  | 'host-unknown'
  | 'owner-missing'
  | 'owner-invalid'
  | 'lock-unsafe'
  | 'loader-installer-alive'
  | 'loader-installer-unverified';
export interface ServerLockAssessment {
  state: ServerLockState;
  purpose?: LockPurpose;
  /** Ordered machine-readable evidence; safe to log or map to UI text. */
  evidence: LockEvidence[];
  /** A recorded game child was positively identified as still running. */
  childAlive: boolean;
  /** `uncertain` lock the user may release with `acceptUncertain` (never with a live child). */
  confirmable: boolean;
}
export interface LockSnapshot {
  assessment: ServerLockAssessment;
  /** Exact owner.json text for compare-and-swap reclaim; null when no owner file exists. */
  ownerText: string | null | undefined;
}
type ProcessVerdict = 'alive' | 'exited' | 'reused' | 'unknown';

async function verdict(
  probe: ProcessProbe,
  pid: number,
  recorded: string | null,
): Promise<ProcessVerdict> {
  let state: Awaited<ReturnType<ProcessProbe['process']>>;
  try {
    state = await probe.process(pid);
  } catch {
    return 'unknown';
  }
  if (state.state === 'absent') return 'exited';
  if (state.state !== 'running' || recorded === null) return 'unknown';
  return state.start === recorded ? 'alive' : 'reused';
}
function uncertain(
  evidence: LockEvidence[],
  purpose?: LockPurpose,
  confirmable = true,
): ServerLockAssessment {
  return {
    state: 'uncertain',
    ...(purpose ? { purpose } : {}),
    evidence,
    childAlive: false,
    confirmable,
  };
}

/** Classify an owner record. Only positive same-machine evidence ever yields `stale-verified`. */
export async function assessLockOwner(
  read: LockOwnerRead,
  probe: ProcessProbe,
): Promise<ServerLockAssessment> {
  switch (read.state) {
    case 'free':
      return { state: 'free', evidence: [], childAlive: false, confirmable: false };
    case 'unsafe':
      return uncertain(['lock-unsafe'], undefined, false);
    case 'no-owner':
      return uncertain(['owner-missing']);
    case 'invalid':
      // An unreadable/non-regular owner entry is not safe to move aside.
      return uncertain(['owner-invalid'], undefined, read.text !== '');
  }
  const owner = read.owner;
  let ownSelf = false;
  if (owner.pid === process.pid) {
    // Possibly held by this very process (identity may be unknown): never offer to release it.
    let self: Awaited<ReturnType<ProcessProbe['process']>> = { state: 'unknown' };
    try {
      self = await probe.process(process.pid);
    } catch {
      // Keep unknown.
    }
    ownSelf = owner.start === null || self.state !== 'running' || self.start === owner.start;
  }
  let ownerVerdict: ProcessVerdict = 'alive';
  if (!ownSelf) {
    let current: string | null = null;
    try {
      current = (await probe.host()).machine;
    } catch {
      current = null;
    }
    if (owner.host.machine === null || current === null)
      return uncertain(['host-unknown'], owner.purpose);
    if (owner.host.machine !== current) return uncertain(['host-different'], owner.purpose);
    ownerVerdict = await verdict(probe, owner.pid, owner.start);
  }
  const evidence: LockEvidence[] = [];
  evidence.push(
    ownerVerdict === 'alive'
      ? 'owner-alive'
      : ownerVerdict === 'exited'
        ? 'owner-exited'
        : ownerVerdict === 'reused'
          ? 'owner-pid-reused'
          : 'owner-state-unknown',
  );
  let childVerdict: ProcessVerdict = 'exited';
  if (owner.child?.state === 'starting') {
    childVerdict = 'unknown';
    evidence.push('child-unrecorded');
  } else if (owner.child?.state === 'running') {
    childVerdict = await verdict(probe, owner.child.pid, owner.child.start);
    evidence.push(
      childVerdict === 'alive'
        ? 'child-alive'
        : childVerdict === 'exited'
          ? 'child-exited'
          : childVerdict === 'reused'
            ? 'child-pid-reused'
            : 'child-state-unknown',
    );
  }
  const childAlive = childVerdict === 'alive';
  const base = { purpose: owner.purpose, evidence, childAlive };
  if (ownerVerdict === 'alive' || childAlive)
    return { state: 'held-live', ...base, confirmable: false };
  const dead = (value: ProcessVerdict) => value === 'exited' || value === 'reused';
  if (dead(ownerVerdict) && dead(childVerdict))
    return { state: 'stale-verified', ...base, confirmable: false };
  return { state: 'uncertain', ...base, confirmable: true };
}

/** Read and classify the server lock without side effects. */
export async function snapshotServerLock(root: string, probe: ProcessProbe): Promise<LockSnapshot> {
  const read = await readLockOwner(root);
  const ownerText =
    read.state === 'no-owner'
      ? null
      : read.state === 'v2' || (read.state === 'invalid' && read.text)
        ? read.text
        : undefined;
  let assessment = await assessLockOwner(read, probe);
  if (assessment.state === 'stale-verified' || assessment.state === 'uncertain')
    assessment = await withLoaderStages(root, assessment, probe);
  return { assessment, ownerText };
}

const LOADER_DIRECTORY = '.torchlauncher-loaders';
const MAX_STAGES = 64;
/**
 * The official loader installer Java is recorded in its staging-root lock
 * (`.torchlauncher-loaders/.stage-<uuid>`), not in the server lock. A stale server lock is only
 * `stale-verified` while every such staging lock is verified dead too.
 */
async function withLoaderStages(
  root: string,
  assessment: ServerLockAssessment,
  probe: ProcessProbe,
): Promise<ServerLockAssessment> {
  const parent = join(root, LOADER_DIRECTORY);
  const info = await stat(parent);
  if (!info) return assessment;
  const downgrade = (evidence: LockEvidence): ServerLockAssessment => ({
    ...assessment,
    state: 'uncertain',
    evidence: [...assessment.evidence, evidence],
    confirmable: assessment.state === 'uncertain' ? assessment.confirmable : true,
  });
  if (!info.isDirectory() || info.isSymbolicLink()) return downgrade('loader-installer-unverified');
  const stages = (await readdir(parent)).filter((name) => name.startsWith('.stage-'));
  if (stages.length > MAX_STAGES) return downgrade('loader-installer-unverified');
  let unverified = false;
  for (const name of stages) {
    const stage = join(parent, name);
    const entry = await stat(stage);
    if (!entry?.isDirectory() || entry.isSymbolicLink()) continue;
    const stageLock = await assessLockOwner(await readLockOwner(stage), probe);
    if (stageLock.state === 'held-live')
      return {
        ...assessment,
        state: 'held-live',
        evidence: [...assessment.evidence, 'loader-installer-alive'],
        childAlive: true,
        confirmable: false,
      };
    if (stageLock.state === 'uncertain') unverified = true;
  }
  return unverified ? downgrade('loader-installer-unverified') : assessment;
}
