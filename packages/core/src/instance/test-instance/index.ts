import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateDeploymentPath } from '../../deployment/contracts/index.js';
import {
  checkedDirectory,
  checkRootAncestors,
  checkSpelling,
  collisionKey,
  maybeStat,
  protectPath,
  readLocalFile,
  sameStat,
} from '../sync/safety.js';

export const TEST_INSTANCE_LEDGER_PATH = '.torchlauncher-test/ledger.json';
export const TEST_INSTANCE_LEDGER_LIMIT = 1024 * 1024;
export interface TestCandidateFile {
  path: string;
  /** Candidates already exclude settings-policy-managed options and packs. */
  policy: 'always' | 'initial-only' | 'exclude';
}
export interface TestOwnedFile {
  path: string;
  policy: 'always' | 'initial-only';
  sha256: string;
  length: number;
}
export interface TestInstanceLedger {
  version: 1;
  files: TestOwnedFile[];
}
export interface TestInstancePlan {
  copies: {
    path: string;
    source: string;
    destination: string;
    before: { sha256: string; length: number } | null;
    after: TestOwnedFile;
  }[];
  removals: { path: string; destination: string; before: TestOwnedFile }[];
  skipped: {
    path: string;
    reason: 'excluded' | 'initial-only' | 'unowned' | 'modified' | 'game-data' | 'unchanged';
  }[];
  /** Write atomically ONLY after executing and verifying the entire plan successfully. */
  nextLedger: TestInstanceLedger;
}
export class TestInstanceError extends Error {
  constructor(
    public readonly code:
      | 'unsafe-path'
      | 'invalid-ledger'
      | 'limit-exceeded'
      | 'invalid-candidates'
      | 'source-missing'
      | 'local-changed',
  ) {
    super(code);
    this.name = 'TestInstanceError';
  }
}
function fail(code: TestInstanceError['code']): never {
  throw new TestInstanceError(code);
}
function pathCheck(path: unknown): asserts path is string {
  try {
    validateDeploymentPath(path);
    protectPath(path as string);
  } catch {
    fail('unsafe-path');
  }
}
function pathSet(files: readonly { path: string }[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    pathCheck(file.path);
    const key = collisionKey(file.path);
    if (seen.has(key)) fail('unsafe-path');
    seen.add(key);
  }
  for (const key of seen) {
    const parts = key.split('/');
    parts.pop();
    while (parts.length) {
      if (seen.has(parts.join('/'))) fail('unsafe-path');
      parts.pop();
    }
  }
}
/** Strict canonical JSON, with an optional final newline. No legacy ledger readers. */
export function parseTestInstanceLedger(text: string): TestInstanceLedger {
  if (text.length > TEST_INSTANCE_LEDGER_LIMIT) fail('limit-exceeded');
  if (Buffer.byteLength(text) > TEST_INSTANCE_LEDGER_LIMIT) fail('limit-exceeded');
  try {
    const value = JSON.parse(text) as TestInstanceLedger;
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'files,version' ||
      value.version !== 1 ||
      !Array.isArray(value.files) ||
      value.files.length > 10000
    )
      fail('invalid-ledger');
    for (const file of value.files) {
      if (
        !file ||
        Object.keys(file).sort().join(',') !== 'length,path,policy,sha256' ||
        !['always', 'initial-only'].includes(file.policy) ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.length) ||
        file.length < 0 ||
        file.length > 4 * 1024 ** 3
      )
        fail('invalid-ledger');
    }
    pathSet(value.files);
    if (text !== JSON.stringify(value) && text !== `${JSON.stringify(value)}\n`)
      fail('invalid-ledger');
    return value;
  } catch (error) {
    if (error instanceof TestInstanceError && error.code === 'limit-exceeded') throw error;
    return fail('invalid-ledger');
  }
}
async function checkedPath(root: string, path: string): Promise<string> {
  const parts = path.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) fail('unsafe-path');
    if (!(await maybeStat(current))) break;
    await checkedDirectory(current);
    await checkSpelling(current, part);
    current = join(current, part);
    const stat = await maybeStat(current);
    if (
      stat &&
      (stat.isSymbolicLink() ||
        (i < parts.length - 1 && !stat.isDirectory()) ||
        (i === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1n)))
    )
      fail('unsafe-path');
  }
  return join(root, ...parts);
}
async function readLedger(root: string): Promise<TestInstanceLedger> {
  const path = await checkedPath(root, TEST_INSTANCE_LEDGER_PATH);
  const before = await maybeStat(path);
  if (!before) return { version: 1, files: [] };
  if (before.size > BigInt(TEST_INSTANCE_LEDGER_LIMIT)) fail('limit-exceeded');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!sameStat(before, await handle.stat({ bigint: true }))) fail('local-changed');
    const data = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < data.length) {
      const result = await handle.read(data, size, data.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await maybeStat(path);
    if (
      size !== Number(before.size) ||
      !after ||
      !sameStat(before, after) ||
      !sameStat(before, await handle.stat({ bigint: true }))
    )
      fail('local-changed');
    let text: string;
    try {
      text = new TextDecoder('utf8', { fatal: true }).decode(data.subarray(0, size));
    } catch {
      return fail('invalid-ledger');
    }
    return parseTestInstanceLedger(text);
  } finally {
    await handle.close();
  }
}
function gameData(path: string): boolean {
  const key = collisionKey(path);
  return (
    ['options.txt', 'optionsof.txt', 'servers.dat'].includes(key) ||
    ['config', 'saves', 'logs', 'crash-reports', 'screenshots'].includes(key.split('/')[0] ?? '') ||
    (key.startsWith('shaderpacks/') && key.endsWith('.txt'))
  );
}
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
/**
 * Read-only planning. Caller serializes preparation with game execution, holds an instance lock,
 * and revalidates links, identities and before/after digests at execution time (TOCTOU boundary).
 * Does not mkdir/copy/remove/write a ledger. Roots must be absolute, normalized and disjoint.
 */
export async function planTestInstance(input: {
  candidateFiles: readonly TestCandidateFile[];
  sourceRoot: string;
  instanceRoot: string;
}): Promise<TestInstancePlan> {
  try {
    const { sourceRoot, instanceRoot, candidateFiles } = input;
    for (const root of [sourceRoot, instanceRoot]) {
      if (
        !isAbsolute(root) ||
        resolve(root) !== root ||
        dirname(root) === root ||
        root.includes('\0')
      )
        fail('unsafe-path');
      await checkRootAncestors(root);
    }
    if (inside(sourceRoot, instanceRoot) || inside(instanceRoot, sourceRoot)) fail('unsafe-path');
    await checkedDirectory(sourceRoot);
    if (candidateFiles.length > 10000) fail('limit-exceeded');
    pathSet(candidateFiles);
    for (const file of candidateFiles)
      if (!['always', 'initial-only', 'exclude'].includes(file.policy)) fail('invalid-candidates');
    const ledger = await readLedger(instanceRoot);
    // Cross-list aliases and parent/child conflicts must fail before producing any operations.
    const paths = new Set([
      ...candidateFiles.map((file) => file.path),
      ...ledger.files.map((file) => file.path),
    ]);
    pathSet([...paths].map((path) => ({ path })));
    const old = new Map(ledger.files.map((file) => [file.path, file]));
    const next = new Map<string, TestOwnedFile>();
    const plan: TestInstancePlan = {
      copies: [],
      removals: [],
      skipped: [],
      nextLedger: { version: 1, files: [] },
    };
    for (const candidate of candidateFiles) {
      if (candidate.policy === 'exclude') {
        plan.skipped.push({ path: candidate.path, reason: 'excluded' });
        continue;
      }
      const source = await checkedPath(sourceRoot, candidate.path);
      const destination = await checkedPath(instanceRoot, candidate.path);
      const prior = old.get(candidate.path);
      const local = await readLocalFile(destination);
      const skip = (reason: TestInstancePlan['skipped'][number]['reason']) => {
        plan.skipped.push({ path: candidate.path, reason });
        if (prior) next.set(prior.path, prior);
      };
      if (prior?.policy === 'initial-only' || (candidate.policy === 'initial-only' && local)) {
        skip('initial-only');
        continue;
      }
      if (local && !prior) {
        skip('unowned');
        continue;
      }
      if (local && prior && (local.sha256 !== prior.sha256 || local.length !== prior.length)) {
        skip('modified');
        continue;
      }
      const content = await readLocalFile(source);
      if (!content) fail('source-missing');
      const after: TestOwnedFile = {
        path: candidate.path,
        policy: candidate.policy,
        sha256: content.sha256,
        length: content.length,
      };
      next.set(after.path, after);
      if (local?.sha256 === after.sha256 && local.length === after.length) {
        skip('unchanged');
        next.set(after.path, after);
        continue;
      }
      plan.copies.push({
        path: candidate.path,
        source,
        destination,
        before: local ? { sha256: local.sha256, length: local.length } : null,
        after,
      });
    }
    for (const prior of ledger.files) {
      if (next.has(prior.path)) continue;
      const destination = await checkedPath(instanceRoot, prior.path);
      const local = await readLocalFile(destination);
      if (gameData(prior.path) || prior.policy === 'initial-only') {
        plan.skipped.push({ path: prior.path, reason: 'game-data' });
        continue;
      }
      if (!local) continue;
      if (local.sha256 !== prior.sha256 || local.length !== prior.length) {
        plan.skipped.push({ path: prior.path, reason: 'modified' });
        continue;
      }
      plan.removals.push({ path: prior.path, destination, before: prior });
    }
    plan.nextLedger.files = [...next.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (Buffer.byteLength(JSON.stringify(plan.nextLedger)) > TEST_INSTANCE_LEDGER_LIMIT)
      fail('limit-exceeded');
    return plan;
  } catch (error) {
    if (error instanceof TestInstanceError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'limit-exceeded' || code === 'local-changed') fail(code);
    return fail('unsafe-path');
  }
}
