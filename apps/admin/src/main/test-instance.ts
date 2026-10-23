import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { testInstance } from '@torchlauncher/core';
import { validateDeploymentPath } from '../../../../packages/core/src/deployment/contracts/index.js';
import {
  checkRootAncestors,
  maybeStat,
  protectPath,
  readLocalFile,
} from '../../../../packages/core/src/instance/sync/safety.js';
import { secureDirectory } from '../../../../packages/core/src/minecraft/filesystem.js';
import { noLinks, safeRead, saveProject } from './filesystem.js';
import { StudioFailure } from './project.js';

type Digest = { sha256: string; length: number };
type Operation = { path: string; before: Digest | null; after: Digest | null };
interface Journal {
  version: 1;
  phase: 'applying' | 'committed';
  operations: Operation[];
  previous: string | null;
  next: testInstance.TestInstanceLedger;
}
const TRANSACTION = '.torchlauncher-test/transaction';
const LIMIT = 4 * 1024 * 1024;
const failure = () => new StudioFailure('MISMATCH');
const equal = (a: Digest | null, b: Digest | null) =>
  a === null ? b === null : b !== null && a.sha256 === b.sha256 && a.length === b.length;
async function digest(path: string): Promise<Digest | null> {
  await checkRootAncestors(dirname(path));
  const result = await readLocalFile(path);
  await checkRootAncestors(dirname(path));
  return result === null ? null : { sha256: result.sha256, length: result.length };
}
async function assertDigest(path: string, expected: Digest | null) {
  if (!equal(await digest(path), expected)) throw failure();
}
function validDigest(value: unknown): value is Digest | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const v = value as Digest;
  return (
    Object.keys(v).sort().join(',') === 'length,sha256' &&
    /^[a-f0-9]{64}$/.test(v.sha256) &&
    Number.isSafeInteger(v.length) &&
    v.length >= 0 &&
    v.length <= 4 * 1024 ** 3
  );
}
async function readJournal(root: string): Promise<Journal> {
  const value = JSON.parse(
    (await safeRead(join(root, TRANSACTION, 'journal.json'), LIMIT)).toString(),
  ) as Journal;
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'next,operations,phase,previous,version' ||
    value.version !== 1 ||
    !['applying', 'committed'].includes(value.phase) ||
    !Array.isArray(value.operations) ||
    value.operations.length > 20000 ||
    (value.previous !== null && typeof value.previous !== 'string')
  )
    throw failure();
  testInstance.parseTestInstanceLedger(JSON.stringify(value.next));
  if (value.previous !== null) testInstance.parseTestInstanceLedger(value.previous);
  const seen = new Set<string>();
  for (const op of value.operations) {
    if (
      !op ||
      Object.keys(op).sort().join(',') !== 'after,before,path' ||
      !validDigest(op.before) ||
      !validDigest(op.after) ||
      (!op.before && !op.after)
    )
      throw failure();
    validateDeploymentPath(op.path);
    protectPath(op.path);
    const key = op.path.toLowerCase();
    if (seen.has(key)) throw failure();
    seen.add(key);
  }
  return value;
}
async function ledgerText(root: string): Promise<string | null> {
  const file = join(root, testInstance.TEST_INSTANCE_LEDGER_PATH);
  if (!(await maybeStat(file))) return null;
  const text = (await safeRead(file, testInstance.TEST_INSTANCE_LEDGER_LIMIT)).toString();
  testInstance.parseTestInstanceLedger(text);
  return text;
}
/** Copies via opened regular file handles, never a path-following copy operation. */
async function copy(source: string, destination: string, expected: Digest, signal?: AbortSignal) {
  const ancestry = await noLinks(source);
  const before = await lstat(source);
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await input.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.size !== expected.length
    )
      throw failure();
    await noLinks(dirname(destination));
    const output = await open(destination, 'wx', 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let length = 0;
      for (;;) {
        signal?.throwIfAborted();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, length);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > expected.length) throw failure();
        await output.writeFile(buffer.subarray(0, bytesRead));
      }
      const after = await input.stat();
      const current = await lstat(source);
      const parents = await noLinks(source);
      if (
        length !== expected.length ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs ||
        after.nlink !== 1 ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        ancestry.some((p, i) => p.dev !== parents[i]?.dev || p.ino !== parents[i]?.ino)
      )
        throw failure();
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
  await assertDigest(destination, expected);
}
/** Roll back only unchanged transaction output; never overwrite a later local edit. Caller holds maintenance lease. */
export async function recoverTestInstance(root: string): Promise<void> {
  const directory = join(root, TRANSACTION);
  if (!(await maybeStat(directory))) return;
  await noLinks(directory);
  const journal = await readJournal(root);
  if (journal.phase === 'committed') {
    if ((await ledgerText(root)) !== `${JSON.stringify(journal.next)}\n`) throw failure();
  } else {
    const currentLedger = await ledgerText(root);
    if (currentLedger !== journal.previous && currentLedger !== `${JSON.stringify(journal.next)}\n`)
      throw failure();
    // Validate the entire rollback before restoring anything.
    for (const [i, op] of journal.operations.entries()) {
      const current = await digest(join(root, op.path));
      if (!equal(current, op.before) && !equal(current, op.after)) throw failure();
      if (op.before) await assertDigest(join(directory, `${i}.before`), op.before);
    }
    for (const [i, op] of [...journal.operations.entries()].reverse()) {
      const destination = join(root, op.path);
      if (equal(await digest(destination), op.before)) continue;
      await assertDigest(destination, op.after);
      await noLinks(dirname(destination));
      if (op.before) {
        // Keep backup until every operation and the ledger have been restored (recovery is repeatable).
        const stage = join(directory, `${i}.restore`);
        if (await maybeStat(stage)) {
          await assertDigest(stage, op.before);
          await unlink(stage);
        }
        await copy(join(directory, `${i}.before`), stage, op.before);
        await rename(stage, destination);
      } else await unlink(destination);
    }
    const ledger = join(root, testInstance.TEST_INSTANCE_LEDGER_PATH);
    if (journal.previous === null) {
      if (await maybeStat(ledger)) await unlink(ledger);
    } else await saveProject(ledger, journal.previous);
  }
  await rm(directory, { recursive: true });
}
/** All caller writes stay inside root; sourceRoot is opened read-only. Caller holds maintenance lease. */
export async function applyTestInstance(
  root: string,
  plan: testInstance.TestInstancePlan,
  signal: AbortSignal,
  progress: (completed: number, total: number) => void = () => {},
): Promise<void> {
  signal.throwIfAborted();
  const directory = join(root, TRANSACTION);
  await secureDirectory(dirname(directory));
  await mkdir(directory);
  const operations: Operation[] = [
    ...plan.copies.map((c) => ({
      path: c.path,
      before: c.before,
      after: { sha256: c.after.sha256, length: c.after.length },
    })),
    ...plan.removals.map((r) => ({
      path: r.path,
      before: { sha256: r.before.sha256, length: r.before.length },
      after: null,
    })),
  ];
  const journal: Journal = {
    version: 1,
    phase: 'applying',
    operations,
    previous: await ledgerText(root),
    next: plan.nextLedger,
  };
  let published = false;
  try {
    for (const [i, op] of operations.entries()) {
      signal.throwIfAborted();
      validateDeploymentPath(op.path);
      protectPath(op.path);
      await assertDigest(join(root, op.path), op.before);
      if (op.before)
        await copy(join(root, op.path), join(directory, `${i}.before`), op.before, signal);
      const item = plan.copies[i];
      if (item) await copy(item.source, join(directory, `${i}.after`), item.after, signal);
    }
    signal.throwIfAborted();
    await saveProject(join(directory, 'journal.json'), JSON.stringify(journal));
    published = true;
    for (const [i, op] of operations.entries()) {
      signal.throwIfAborted();
      const destination = join(root, op.path);
      await secureDirectory(dirname(destination));
      await assertDigest(destination, op.before);
      await noLinks(dirname(destination));
      if (op.after) await rename(join(directory, `${i}.after`), destination);
      else await unlink(destination);
      await assertDigest(destination, op.after);
      progress(i + 1, operations.length);
    }
    signal.throwIfAborted();
    await saveProject(
      join(root, testInstance.TEST_INSTANCE_LEDGER_PATH),
      `${JSON.stringify(plan.nextLedger)}\n`,
    );
    journal.phase = 'committed';
    await saveProject(join(directory, 'journal.json'), JSON.stringify(journal));
  } catch (error) {
    if (published) await recoverTestInstance(root);
    else await rm(directory, { recursive: true });
    throw error;
  }
  await rm(directory, { recursive: true });
}

/** Refuse links anywhere in the instance before recursive reset. The caller holds its outer lease. */
export async function removeTestInstance(root: string): Promise<void> {
  if (!(await maybeStat(root))) return;
  await noLinks(root);
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new StudioFailure('INVALID');
      if (entry.isDirectory()) await walk(join(path, entry.name));
    }
  };
  await walk(root);
  // Keep the active core maintenance lease until the caller releases it.
  for (const entry of await readdir(root)) {
    if (entry === '.torchlauncher-server-lock') continue;
    await noLinks(join(root, entry));
    await rm(join(root, entry), { recursive: true, force: true });
  }
}
