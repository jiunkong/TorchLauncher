import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import {
  DEPLOYMENT_FORMAT_VERSION,
  type DeploymentFilePolicy,
  EMPTY_FILE_SHA256,
  validateDeploymentIndex,
} from '../../deployment/contracts/index.js';
import {
  collisionKey,
  type Digest,
  fail,
  maybeStat,
  protectPath,
  sameDigest,
  sameStat,
  writeAll,
} from './safety.js';

export const SYNC_FILE_LIMIT = 10_000;
export const LEDGER_BYTE_LIMIT = 8 * 1024 ** 2;
export const JOURNAL_BYTE_LIMIT = 32 * 1024 ** 2;

export interface LedgerFile extends Digest {
  readonly path: string;
  readonly policy: DeploymentFilePolicy;
}

export interface Ledger {
  readonly version: 1;
  readonly serverId: string;
  readonly deploymentId: string;
  readonly initialized: true;
  readonly files: readonly LedgerFile[];
}

export interface Operation {
  readonly path: string;
  readonly before: Digest | null;
  readonly after: Digest | null;
}

export interface Journal {
  readonly version: 1;
  readonly transactionId: string;
  readonly phase: 'staging' | 'applying' | 'committed';
  readonly serverId: string;
  readonly previous: Ledger | null;
  readonly next: Ledger;
  readonly operations: readonly Operation[];
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-state');
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).length !== keys.length || keys.some((key) => !Object.hasOwn(entry, key)))
    fail('invalid-state');
  return entry;
}

export function validateServerId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)
  )
    fail('invalid-state');
}

function validateDigest(value: unknown): Digest {
  const entry = object(value, ['sha256', 'length']);
  if (
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
    typeof entry.length !== 'number' ||
    !Number.isSafeInteger(entry.length) ||
    entry.length < 0 ||
    entry.length > 4 * 1024 ** 3
  )
    fail('invalid-state');
  return entry as unknown as Digest;
}

export function validatePathSet(
  files: readonly { path: string; policy: DeploymentFilePolicy }[],
  serverId: string,
  maximum = SYNC_FILE_LIMIT,
): void {
  if (files.length > maximum) fail('limit-exceeded');
  try {
    validateDeploymentIndex(
      {
        formatVersion: DEPLOYMENT_FORMAT_VERSION,
        serverId,
        deploymentId: serverId,
        sequence: 1,
        branding: {},
        game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '1' } },
        files: files.map((file) => ({
          path: file.path,
          policy: file.policy,
          sha256: EMPTY_FILE_SHA256,
          offset: 0,
          storedLength: 0,
          originalLength: 0,
          compression: 'none',
        })),
      },
      {
        magic: 'TORCHDEP',
        formatVersion: DEPLOYMENT_FORMAT_VERSION,
        flags: 0,
        indexLength: 1,
        totalLength: 129,
        indexSha256: '0'.repeat(64),
      },
      { expectedServerId: serverId },
    );
  } catch (error) {
    fail('invalid-state', error);
  }
  for (const file of files) protectPath(file.path);
}

export function validateLedger(value: unknown, expectedServerId: string): Ledger {
  const entry = object(value, ['version', 'serverId', 'deploymentId', 'initialized', 'files']);
  if (entry.version !== 1 || entry.initialized !== true) fail('invalid-state');
  validateServerId(entry.serverId);
  validateServerId(entry.deploymentId);
  if (entry.serverId !== expectedServerId) fail('server-mismatch');
  if (!Array.isArray(entry.files) || entry.files.length > SYNC_FILE_LIMIT) fail('invalid-state');
  const files: LedgerFile[] = entry.files.map((candidate: unknown) => {
    const file = object(candidate, ['path', 'policy', 'sha256', 'length']);
    if (
      typeof file.path !== 'string' ||
      (file.policy !== 'always' && file.policy !== 'initial-only')
    )
      fail('invalid-state');
    const digest = validateDigest({ sha256: file.sha256, length: file.length });
    return { path: file.path, policy: file.policy, ...digest };
  });
  validatePathSet(files, expectedServerId);
  return {
    version: 1,
    serverId: entry.serverId,
    deploymentId: entry.deploymentId,
    initialized: true,
    files,
  };
}

export function validateTransitions(
  previous: Ledger | null,
  nextFiles: readonly LedgerFile[],
): void {
  if (!previous) return;
  const oldKeys = new Map(previous.files.map((file) => [collisionKey(file.path), file]));
  for (const file of nextFiles) {
    const key = collisionKey(file.path);
    const old = oldKeys.get(key);
    if (old && (old.path !== file.path || old.policy !== file.policy)) fail('conflict');
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      if (oldKeys.has(parts.slice(0, i).join('/'))) fail('conflict');
    }
  }
  const nextKeys = new Set(nextFiles.map((file) => collisionKey(file.path)));
  for (const file of previous.files) {
    const parts = collisionKey(file.path).split('/');
    for (let i = 1; i < parts.length; i += 1) {
      if (nextKeys.has(parts.slice(0, i).join('/'))) fail('conflict');
    }
  }
}

export function validateJournal(value: unknown, serverId: string): Journal {
  const entry = object(value, [
    'version',
    'transactionId',
    'phase',
    'serverId',
    'previous',
    'next',
    'operations',
  ]);
  if (entry.version !== 1 || !['staging', 'applying', 'committed'].includes(String(entry.phase)))
    fail('invalid-state');
  validateServerId(entry.transactionId);
  if (entry.serverId !== serverId) fail('server-mismatch');
  const previous = entry.previous === null ? null : validateLedger(entry.previous, serverId);
  const next = validateLedger(entry.next, serverId);
  validateTransitions(previous, next.files);
  if (!Array.isArray(entry.operations) || entry.operations.length > SYNC_FILE_LIMIT * 2)
    fail('invalid-state');
  const oldFiles = new Map(previous?.files.map((file) => [file.path, file]));
  const nextFiles = new Map(next.files.map((file) => [file.path, file]));
  for (const file of previous?.files ?? []) {
    if (file.policy === 'initial-only' && nextFiles.get(file.path)?.policy !== 'initial-only')
      fail('invalid-state');
  }
  const operations = entry.operations.map((candidate: unknown): Operation => {
    const op = object(candidate, ['path', 'before', 'after']);
    if (typeof op.path !== 'string') fail('invalid-state');
    const before = op.before === null ? null : validateDigest(op.before);
    const after = op.after === null ? null : validateDigest(op.after);
    if (!before && !after) fail('invalid-state');
    const old = oldFiles.get(op.path);
    const current = nextFiles.get(op.path);
    if (before && old?.policy !== 'always') fail('invalid-state');
    if (after && (!current || !sameDigest(after, current))) fail('invalid-state');
    if (after && current?.policy === 'initial-only' && previous !== null) fail('invalid-state');
    if (!after && (old?.policy !== 'always' || current)) fail('invalid-state');
    return { path: op.path, before, after };
  });
  validatePathSet(
    operations.map((op) => ({ path: op.path, policy: 'always' as const })),
    serverId,
    SYNC_FILE_LIMIT * 2,
  );
  return {
    version: 1,
    transactionId: entry.transactionId,
    phase: entry.phase as Journal['phase'],
    serverId,
    previous,
    next,
    operations,
  };
}

export function canonicalBytes(value: unknown, maximum: number): Uint8Array {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.byteLength > maximum) fail('limit-exceeded');
  return bytes;
}

export function ledgerDigest(ledger: Ledger | null): Digest | null {
  if (!ledger) return null;
  const bytes = canonicalBytes(ledger, LEDGER_BYTE_LIMIT);
  return { length: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function readCanonical(path: string, maximum: number): Promise<unknown | undefined> {
  const stat = await maybeStat(path);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(maximum))
    fail('invalid-state');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!sameStat(stat, await handle.stat({ bigint: true }))) fail('local-changed');
    const bytes = Buffer.alloc(Number(stat.size) + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = await handle.read(bytes, length, bytes.byteLength - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const current = await maybeStat(path);
    if (
      length !== Number(stat.size) ||
      !current ||
      !sameStat(stat, current) ||
      !sameStat(stat, await handle.stat({ bigint: true }))
    )
      fail('local-changed');
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, length),
      );
      const value: unknown = JSON.parse(text);
      if (JSON.stringify(value) !== text) fail('invalid-state');
      return value;
    } catch (error) {
      fail('invalid-state', error);
    }
  } finally {
    await handle.close();
  }
}

export async function writeNew(path: string, value: unknown, maximum: number): Promise<void> {
  const bytes = canonicalBytes(value, maximum);
  const handle = await open(path, 'wx', 0o600);
  try {
    await writeAll(handle, bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJournal(path: string, pending: string, journal: Journal): Promise<void> {
  await writeNew(pending, journal, JOURNAL_BYTE_LIMIT);
  try {
    await rename(pending, path);
  } catch (error) {
    await unlink(pending);
    throw error;
  }
}
