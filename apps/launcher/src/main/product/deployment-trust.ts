import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DeploymentReader,
  openDeploymentReader,
} from '../../../../../packages/core/src/deployment/reader/index';
import {
  type DeploymentRollbackState,
  decideRollback,
} from '../../../../../packages/core/src/deployment/signing/index';
import { createDownloadSource } from '../../../../../packages/core/src/download/source/index';
import { verifyServerRoot } from '../../../../../packages/core/src/instance/data/paths';
import type { ServerConfig } from '../../../../../packages/core/src/server-config/index';

/** Launcher-owned, per server, inside the server data root (so server-data deletion removes it). */
export const ROLLBACK_STATE_FILE = '.torchlauncher-deployment-state.json';
const MAX_STATE_BYTES = 1024;
const MAX_ID_LENGTH = 128;

/** The concrete reader, which carries `verification` (the DeploymentReader interface does not). */
export type OpenedDeployment = Awaited<ReturnType<typeof openDeploymentReader>>;

export type DeploymentTrustCode =
  | 'signature-unverified'
  | 'rollback-lower'
  | 'rollback-conflict'
  | 'rollback-state-unreadable';
export class DeploymentTrustError extends Error {
  constructor(
    public readonly code: DeploymentTrustCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'DeploymentTrustError';
  }
}

function unreadable(cause?: unknown): never {
  throw new DeploymentTrustError('rollback-state-unreadable', { cause });
}
function parseState(text: string): DeploymentRollbackState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return unreadable(error);
  }
  const record = value as Record<string, unknown> | null;
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).sort().join() !== 'deploymentId,indexSha256,sequence,version' ||
    record.version !== 1 ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 1 ||
    typeof record.deploymentId !== 'string' ||
    record.deploymentId.length === 0 ||
    record.deploymentId.length > MAX_ID_LENGTH ||
    typeof record.indexSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.indexSha256)
  )
    return unreadable();
  return {
    sequence: record.sequence as number,
    deploymentId: record.deploymentId,
    indexSha256: record.indexSha256,
  };
}
async function stateRoot(base: string, serverId: string): Promise<string | null> {
  try {
    return (await verifyServerRoot(base, serverId)).realRoot;
  } catch (error) {
    if ((error as { code?: string }).code === 'root-not-found') return null;
    return unreadable(error);
  }
}
/** Null only when nothing was ever stored; any unreadable, oversized or malformed state fails closed. */
export async function readRollbackState(
  base: string,
  serverId: string,
): Promise<DeploymentRollbackState | null> {
  const root = await stateRoot(base, serverId);
  if (root === null) return null;
  const path = join(root, ROLLBACK_STATE_FILE);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_STATE_BYTES)
      return unreadable();
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const bytes = Buffer.alloc(MAX_STATE_BYTES + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_STATE_BYTES) return unreadable();
      return parseState(bytes.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof DeploymentTrustError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return unreadable(error);
  }
}
async function writeRollbackState(
  base: string,
  serverId: string,
  state: DeploymentRollbackState,
): Promise<void> {
  const root = await stateRoot(base, serverId);
  if (root === null) return unreadable();
  const path = join(root, ROLLBACK_STATE_FILE);
  const temporary = join(root, `.torchlauncher-deployment-state-${randomUUID()}.tmp`);
  const text = JSON.stringify({
    version: 1,
    sequence: state.sequence,
    deploymentId: state.deploymentId,
    indexSha256: state.indexSha256,
  });
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    return unreadable(error);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Only a signature-verified 1.2 reader yields a candidate. */
function candidate(reader: DeploymentReader): DeploymentRollbackState {
  const sequence = reader.index.sequence;
  if (
    (reader as { verification?: string }).verification !== 'verified' ||
    sequence === undefined ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  )
    throw new DeploymentTrustError('signature-unverified');
  return {
    sequence,
    deploymentId: reader.index.deploymentId,
    indexSha256: reader.header.indexSha256,
  };
}
function assertAcceptable(
  seen: DeploymentRollbackState | null,
  incoming: DeploymentRollbackState,
): void {
  const decision = decideRollback(seen, incoming);
  if (decision === 'reject-lower') throw new DeploymentTrustError('rollback-lower');
  if (decision === 'reject-conflict') throw new DeploymentTrustError('rollback-conflict');
}

/**
 * Opens the server deployment. With `config.signing` the reader is bound to the configured key and
 * must report `verified`, and the rollback decision is made here (read-only), before any caller
 * stages or applies a file. Without `signing` this is the legacy unsigned behavior and a 1.2 file
 * is not trusted as signed. Never writes state: only recordAppliedDeployment does.
 */
export async function openServerDeployment(
  base: string,
  config: ServerConfig,
  signal?: AbortSignal,
): Promise<OpenedDeployment> {
  const reader = await openDeploymentReader(createDownloadSource(config.sourceUrl), {
    expectedServerId: config.serverId,
    ...(config.signing ? { trustedPublicKey: config.signing.publicKey } : {}),
    ...(signal ? { signal } : {}),
  });
  if (config.signing) {
    const incoming = candidate(reader);
    assertAcceptable(await readRollbackState(base, config.serverId), incoming);
  }
  return reader;
}

/** Call only after the reader's deployment was applied successfully. Never lowers stored state. */
export async function recordAppliedDeployment(
  base: string,
  config: ServerConfig,
  reader: DeploymentReader,
): Promise<void> {
  if (!config.signing) return;
  const incoming = candidate(reader);
  const seen = await readRollbackState(base, config.serverId);
  assertAcceptable(seen, incoming);
  if (
    seen &&
    seen.sequence === incoming.sequence &&
    seen.deploymentId === incoming.deploymentId &&
    seen.indexSha256 === incoming.indexSha256
  )
    return;
  await writeRollbackState(base, config.serverId, incoming);
}
