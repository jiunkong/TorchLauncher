import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { validateDeploymentIndex } from '../../deployment/contracts/index.js';
import { acquireServerDataLock } from '../../minecraft/lock.js';
import {
  checkedDirectory,
  checkRootAncestors,
  checkSpelling,
  type Digest,
  fail,
  gamePath,
  type LocalFile,
  maybeStat,
  readLocalFile,
  sameDigest,
  sameStat,
} from './safety.js';
import {
  canonicalBytes,
  JOURNAL_BYTE_LIMIT,
  type Journal,
  LEDGER_BYTE_LIMIT,
  type Ledger,
  type LedgerFile,
  ledgerDigest,
  type Operation,
  readCanonical,
  validateJournal,
  validateLedger,
  validatePathSet,
  validateServerId,
  validateTransitions,
  writeJournal,
  writeNew,
} from './state.js';
import {
  type RecoveryResult,
  type SyncCounts,
  SynchronizationError,
  type SynchronizeDeploymentOptions,
  type SyncResult,
} from './types.js';

interface Context {
  root: string;
  internal: string;
  transaction: string;
  ledger: string;
  journal: string;
  pending: string;
  serverId: string;
}

interface Plan {
  journal: Journal;
  originals: Map<string, LocalFile | null>;
  counts: { downloaded: number; reused: number; preserved: number; deleted: number };
}

function stagePath(context: Context, position: number): string {
  return join(context.transaction, `stage-${position.toString().padStart(5, '0')}`);
}

function backupPath(context: Context, position: number): string {
  return join(context.transaction, `backup-${position.toString().padStart(5, '0')}`);
}

function digest(file: Digest | null): Digest | null {
  return file ? { sha256: file.sha256, length: file.length } : null;
}

async function contextFor(root: string, serverId: string): Promise<Context> {
  await checkedDirectory(root);
  await checkSpelling(root, '.torchlauncher-sync');
  const internal = join(root, '.torchlauncher-sync');
  if (!(await maybeStat(internal))) await mkdir(internal);
  await checkedDirectory(internal);
  const allowed = new Set(['ledger.json', 'journal.json', 'journal.pending', 'transaction']);
  const entries = await readdir(internal);
  if (entries.some((entry) => !allowed.has(entry))) fail('invalid-state');
  return {
    root,
    internal,
    serverId,
    transaction: join(internal, 'transaction'),
    ledger: join(internal, 'ledger.json'),
    journal: join(internal, 'journal.json'),
    pending: join(internal, 'journal.pending'),
  };
}

async function readLedger(path: string, serverId: string): Promise<Ledger | null> {
  const value = await readCanonical(path, LEDGER_BYTE_LIMIT);
  if (value === undefined) return null;
  const ledger = validateLedger(value, serverId);
  if (JSON.stringify(value) !== JSON.stringify(ledger)) fail('invalid-state');
  return ledger;
}

async function assertLedger(
  path: string,
  expected: Ledger | null,
  serverId: string,
): Promise<void> {
  const actual = await readLedger(path, serverId);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('local-changed');
}

async function assertDigest(path: string, expected: Digest | null): Promise<void> {
  if (!sameDigest(await readLocalFile(path), expected)) fail('local-changed');
}

async function discardScratch(path: string, maximum: number): Promise<void> {
  const stat = await maybeStat(path);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(maximum))
    fail('recovery-required');
  await unlink(path);
}

async function validateArtifacts(context: Context, journal: Journal): Promise<void> {
  await checkedDirectory(context.transaction);
  const allowed = new Map<string, number>();
  journal.operations.forEach((operation, position) => {
    if (operation.after)
      allowed.set(`stage-${position.toString().padStart(5, '0')}`, operation.after.length);
    if (operation.before)
      allowed.set(`backup-${position.toString().padStart(5, '0')}`, operation.before.length);
  });
  allowed.set('ledger.next', LEDGER_BYTE_LIMIT);
  if (journal.previous) allowed.set('ledger.backup', LEDGER_BYTE_LIMIT);
  const entries = await readdir(context.transaction);
  if (entries.length > allowed.size) fail('recovery-required');
  for (const entry of entries) {
    if (journal.phase === 'committed' && (entry.startsWith('stage-') || entry === 'ledger.next'))
      fail('recovery-required');
    const maximum = allowed.get(entry);
    if (maximum === undefined) fail('recovery-required');
    const stat = await maybeStat(join(context.transaction, entry));
    if (
      !stat?.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1n ||
      stat.size > BigInt(maximum)
    )
      fail('recovery-required');
  }
}

async function cleanup(context: Context, journal: Journal, partial: boolean): Promise<void> {
  await validateArtifacts(context, journal);
  if (journal.phase === 'committed') {
    await assertLedger(context.ledger, journal.next, context.serverId);
    for (const operation of journal.operations) {
      await assertDigest(await gamePath(context.root, operation.path), operation.after);
    }
  }
  for (const [position, operation] of journal.operations.entries()) {
    const stage = stagePath(context, position);
    if (operation.after && (await maybeStat(stage))) {
      if (!partial) await assertDigest(stage, operation.after);
      await discardScratch(stage, operation.after.length);
    }
    const backup = backupPath(context, position);
    if (await maybeStat(backup)) {
      if (journal.phase !== 'committed' || !operation.before) fail('recovery-required');
      await assertDigest(backup, operation.before);
      await unlink(backup);
    }
  }
  const next = join(context.transaction, 'ledger.next');
  if (await maybeStat(next)) {
    if (!partial) await assertLedger(next, journal.next, context.serverId);
    await discardScratch(next, LEDGER_BYTE_LIMIT);
  }
  const previous = join(context.transaction, 'ledger.backup');
  if (await maybeStat(previous)) {
    if (journal.phase !== 'committed') fail('recovery-required');
    await assertLedger(previous, journal.previous, context.serverId);
    await unlink(previous);
  }
  const saved = await readCanonical(context.journal, JOURNAL_BYTE_LIMIT);
  if (JSON.stringify(saved) !== JSON.stringify(journal)) fail('recovery-required');
  if ((await readdir(context.transaction)).length !== 0) fail('recovery-required');
  await unlink(context.journal);
  await rmdir(context.transaction);
}

interface Restore {
  path: string;
  backup: string;
  before: Digest | null;
  current: Digest | null;
  hasBackup: boolean;
}

async function prepareRestore(
  path: string,
  backup: string,
  before: Digest | null,
  after: Digest | null,
  stagePresent: boolean,
): Promise<Restore> {
  const current = await readLocalFile(path);
  const saved = await readLocalFile(backup);
  // A remaining stage proves this operation has not installed its bytes. A new
  // target at that point belongs to an external writer, even if its hash matches.
  if (stagePresent && current && (saved || !before)) fail('recovery-required');
  if (saved) {
    if (!before || !sameDigest(saved, before) || (current && !sameDigest(current, after)))
      fail('recovery-required');
  } else if (before) {
    if (!sameDigest(current, before)) fail('recovery-required');
  } else if (current && !sameDigest(current, after)) fail('recovery-required');
  return { path, backup, before, current: digest(current), hasBackup: saved !== null };
}

async function performRestore(action: Restore): Promise<void> {
  await assertDigest(action.path, action.current);
  if (action.hasBackup) {
    await assertDigest(action.backup, action.before);
    if (action.current) await unlink(action.path);
    await rename(action.backup, action.path);
  } else if (!action.before && action.current) {
    await unlink(action.path);
  }
}

async function recoverInternal(context: Context): Promise<RecoveryResult> {
  // A pending atomic journal write never authorizes a game-file mutation by itself.
  await discardScratch(context.pending, JOURNAL_BYTE_LIMIT);
  const raw = await readCanonical(context.journal, JOURNAL_BYTE_LIMIT);
  if (raw === undefined) {
    if (await maybeStat(context.transaction)) {
      await checkedDirectory(context.transaction);
      if ((await readdir(context.transaction)).length !== 0) fail('recovery-required');
      await rmdir(context.transaction);
    }
    return 'none';
  }
  try {
    const journal = validateJournal(raw, context.serverId);
    if (JSON.stringify(raw) !== JSON.stringify(journal)) fail('invalid-state');
    await validateArtifacts(context, journal);
    if (journal.phase === 'staging') {
      await assertLedger(context.ledger, journal.previous, context.serverId);
      for (const [position] of journal.operations.entries()) {
        if (await maybeStat(backupPath(context, position))) fail('recovery-required');
      }
      if (await maybeStat(join(context.transaction, 'ledger.backup'))) fail('recovery-required');
      await cleanup(context, journal, true);
      return 'discarded-staging';
    }
    if (journal.phase === 'committed') {
      await assertLedger(context.ledger, journal.next, context.serverId);
      for (const operation of journal.operations) {
        await assertDigest(await gamePath(context.root, operation.path), operation.after);
      }
      await cleanup(context, journal, false);
      return 'cleaned-committed';
    }
    // Preflight every restoration before modifying anything, including the ledger.
    const actions: Restore[] = [];
    for (const [position, operation] of journal.operations.entries()) {
      const stage = stagePath(context, position);
      if (operation.after && (await maybeStat(stage))) await assertDigest(stage, operation.after);
      actions.push(
        await prepareRestore(
          await gamePath(context.root, operation.path),
          backupPath(context, position),
          operation.before,
          operation.after,
          Boolean(await maybeStat(stage)),
        ),
      );
    }
    const currentLedger = await readLedger(context.ledger, context.serverId);
    const backupLedger = await readLedger(
      join(context.transaction, 'ledger.backup'),
      context.serverId,
    );
    if (backupLedger && JSON.stringify(backupLedger) !== JSON.stringify(journal.previous))
      fail('recovery-required');
    if (
      currentLedger &&
      JSON.stringify(currentLedger) !== JSON.stringify(journal.previous) &&
      JSON.stringify(currentLedger) !== JSON.stringify(journal.next)
    )
      fail('recovery-required');
    const nextPath = join(context.transaction, 'ledger.next');
    if (await maybeStat(nextPath)) await assertLedger(nextPath, journal.next, context.serverId);
    const ledgerAction = await prepareRestore(
      context.ledger,
      join(context.transaction, 'ledger.backup'),
      ledgerDigest(journal.previous),
      ledgerDigest(journal.next),
      Boolean(await maybeStat(nextPath)),
    );
    await performRestore(ledgerAction);
    for (const action of actions.reverse()) await performRestore(action);
    await cleanup(context, journal, false);
    return 'rolled-back';
  } catch (error) {
    if (error instanceof SynchronizationError && error.code === 'recovery-required') throw error;
    fail('recovery-required', error);
  }
}

async function progress(
  options: SynchronizeDeploymentOptions,
  counts: SyncCounts,
  phase: 'planning' | 'staging' | 'applying' | 'recovering',
  path?: string,
): Promise<void> {
  options.signal?.throwIfAborted();
  await options.onProgress?.({ phase, ...counts, ...(path === undefined ? {} : { path }) });
  options.signal?.throwIfAborted();
}

async function fileActivity(
  options: SynchronizeDeploymentOptions,
  phase: 'staging' | 'applying',
  state: 'started' | 'completed',
  path: string,
): Promise<void> {
  options.signal?.throwIfAborted();
  await options.onFileActivity?.({ phase, state, path });
  options.signal?.throwIfAborted();
}

async function makePlan(context: Context, options: SynchronizeDeploymentOptions): Promise<Plan> {
  const previous = await readLedger(context.ledger, context.serverId);
  const header = structuredClone(options.reader.header);
  const index = validateDeploymentIndex(structuredClone(options.reader.index), header, {
    expectedServerId: context.serverId,
  });
  const incoming: LedgerFile[] = index.files.map((file) => ({
    path: file.path,
    policy: file.policy,
    sha256: file.sha256,
    length: file.originalLength,
  }));
  validatePathSet(incoming, context.serverId);
  validateTransitions(previous, incoming);
  const old = new Map(previous?.files.map((file) => [file.path, file]));
  const nextFiles = new Map(
    previous?.files
      .filter((file) => file.policy === 'initial-only')
      .map((file) => [file.path, file]),
  );
  for (const file of incoming) nextFiles.set(file.path, file);
  const next = validateLedger(
    {
      version: 1,
      serverId: context.serverId,
      deploymentId: index.deploymentId,
      initialized: true,
      files: [...nextFiles.values()],
    },
    context.serverId,
  );
  const operations: Operation[] = [];
  const originals = new Map<string, LocalFile | null>();
  const counts = { downloaded: 0, reused: 0, preserved: 0, deleted: 0 };
  for (const file of incoming) {
    options.signal?.throwIfAborted();
    const local = await readLocalFile(await gamePath(context.root, file.path), options.signal);
    originals.set(file.path, local);
    if (file.policy === 'initial-only' && (previous !== null || local !== null)) {
      counts.preserved += 1;
      continue;
    }
    if (file.policy === 'always' && !old.has(file.path) && local) fail('conflict');
    if (file.policy === 'always' && sameDigest(local, file)) {
      counts.reused += 1;
      continue;
    }
    operations.push({ path: file.path, before: digest(local), after: digest(file) });
    counts.downloaded += 1;
  }
  const incomingPaths = new Set(incoming.map((file) => file.path));
  for (const file of previous?.files ?? []) {
    if (file.policy !== 'always' || incomingPaths.has(file.path)) continue;
    const local = await readLocalFile(await gamePath(context.root, file.path), options.signal);
    originals.set(file.path, local);
    if (local) {
      operations.push({ path: file.path, before: digest(local), after: null });
      counts.deleted += 1;
    }
  }
  const journal = validateJournal(
    {
      version: 1,
      transactionId: randomUUID(),
      phase: 'staging',
      serverId: context.serverId,
      previous,
      next,
      operations,
    },
    context.serverId,
  );
  canonicalBytes(journal, JOURNAL_BYTE_LIMIT);
  return { journal, originals, counts };
}

async function recheckPlan(context: Context, plan: Plan): Promise<void> {
  await assertLedger(context.ledger, plan.journal.previous, context.serverId);
  for (const [path, before] of plan.originals) {
    const current = await readLocalFile(await gamePath(context.root, path));
    if (!sameDigest(current, before) || (before && current && !sameStat(before.stat, current.stat)))
      fail('local-changed');
  }
}

async function applyPlan(
  context: Context,
  plan: Plan,
  options: SynchronizeDeploymentOptions,
): Promise<void> {
  let journal = plan.journal;
  await mkdir(context.transaction);
  await writeJournal(context.journal, context.pending, journal);
  try {
    for (const [position, operation] of journal.operations.entries()) {
      if (!operation.after) continue;
      await fileActivity(options, 'staging', 'started', operation.path);
      await options.reader.stageFile(
        operation.path,
        stagePath(context, position),
        options.signal ? { signal: options.signal } : {},
      );
      await assertDigest(stagePath(context, position), operation.after);
      await fileActivity(options, 'staging', 'completed', operation.path);
      await progress(options, plan.counts, 'staging', operation.path);
    }
    await writeNew(join(context.transaction, 'ledger.next'), journal.next, LEDGER_BYTE_LIMIT);
    options.reader.assertCurrent();
    await recheckPlan(context, plan);
    await progress(options, plan.counts, 'applying');
    // Callbacks may change local files; repeat the preflight after the last pre-apply callback.
    await recheckPlan(context, plan);
    options.reader.assertCurrent();
    journal = { ...journal, phase: 'applying' };
    await writeJournal(context.journal, context.pending, journal);
    for (const [position, operation] of journal.operations.entries()) {
      await fileActivity(options, 'applying', 'started', operation.path);
      options.reader.assertCurrent();
      const target = await gamePath(context.root, operation.path, true);
      await assertDigest(target, operation.before);
      await assertDigest(backupPath(context, position), null);
      if (operation.before) await rename(target, backupPath(context, position));
      if (operation.after) {
        await assertDigest(target, null);
        await assertDigest(stagePath(context, position), operation.after);
        await rename(stagePath(context, position), target);
      }
      await fileActivity(options, 'applying', 'completed', operation.path);
      await progress(options, plan.counts, 'applying', operation.path);
    }
    options.reader.assertCurrent();
    options.signal?.throwIfAborted();
    for (const operation of journal.operations) {
      await assertDigest(await gamePath(context.root, operation.path), operation.after);
    }
    await assertLedger(context.ledger, journal.previous, context.serverId);
    options.reader.assertCurrent();
    options.signal?.throwIfAborted();
    if (journal.previous) await rename(context.ledger, join(context.transaction, 'ledger.backup'));
    await rename(join(context.transaction, 'ledger.next'), context.ledger);
    options.reader.assertCurrent();
    options.signal?.throwIfAborted();
    journal = { ...journal, phase: 'committed' };
    await writeJournal(context.journal, context.pending, journal);
  } catch (error) {
    try {
      await recoverInternal(context);
    } catch (recoveryError) {
      fail('recovery-required', recoveryError);
    }
    throw error;
  }
  try {
    await cleanup(context, journal, false);
  } catch (error) {
    fail('recovery-required', error);
  }
}

export async function synchronizeDeployment(
  options: SynchronizeDeploymentOptions,
): Promise<SyncResult> {
  validateServerId(options.expectedServerId);
  options.signal?.throwIfAborted();
  await checkRootAncestors(options.root);
  const lease = await acquireServerDataLock(options.root, 'maintenance');
  try {
    const context = await contextFor(lease.root, options.expectedServerId);
    const recovery = await recoverInternal(context);
    options.reader.assertCurrent();
    const plan = await makePlan(context, options);
    await progress(options, plan.counts, 'planning');
    await applyPlan(context, plan, options);
    return Object.freeze({
      ...plan.counts,
      deploymentId: plan.journal.next.deploymentId,
      recovery,
    });
  } finally {
    await lease.release();
  }
}

export async function recoverSynchronization(options: {
  root: string;
  expectedServerId: string;
}): Promise<RecoveryResult> {
  validateServerId(options.expectedServerId);
  await checkRootAncestors(options.root);
  const lease = await acquireServerDataLock(options.root, 'maintenance');
  try {
    return await recoverInternal(await contextFor(lease.root, options.expectedServerId));
  } finally {
    await lease.release();
  }
}
