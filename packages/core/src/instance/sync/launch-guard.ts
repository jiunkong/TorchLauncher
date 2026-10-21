import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DeploymentReader } from '../../deployment/reader/index.js';
import {
  checkedDirectory,
  checkRootAncestors,
  checkSpelling,
  fail,
  gamePath,
  readLocalFile,
  sameDigest,
} from './safety.js';
import { LEDGER_BYTE_LIMIT, readCanonical, validateLedger } from './state.js';

/** Read-only. Caller must hold the game lease and re-open the current remote deployment first. */
export async function assertSynchronizedForLaunch(options: {
  root: string;
  reader: DeploymentReader;
  expectedServerId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { reader, expectedServerId, signal } = options;
  const root = resolve(options.root);
  signal?.throwIfAborted();
  reader.assertCurrent();
  if (reader.index.serverId !== expectedServerId) fail('server-mismatch');
  await checkRootAncestors(root);
  await checkedDirectory(root);
  await checkSpelling(root, '.torchlauncher-sync');
  const internal = join(root, '.torchlauncher-sync');
  await checkedDirectory(internal);
  const names = await readdir(internal);
  if (names.some((name) => ['journal.json', 'journal.pending', 'transaction'].includes(name)))
    fail('recovery-required');
  if (names.length !== 1 || names[0] !== 'ledger.json') fail('invalid-state');
  const ledger = validateLedger(
    await readCanonical(join(internal, 'ledger.json'), LEDGER_BYTE_LIMIT),
    expectedServerId,
  );
  if (ledger.deploymentId !== reader.index.deploymentId) fail('local-changed');
  const required = reader.index.files.filter((file) => file.policy === 'always');
  const owned = ledger.files.filter((file) => file.policy === 'always');
  if (required.length !== owned.length) fail('local-changed');
  const byPath = new Map(owned.map((file) => [file.path, file]));
  for (const file of required) {
    signal?.throwIfAborted();
    reader.assertCurrent();
    const digest = { sha256: file.sha256, length: file.originalLength };
    if (!sameDigest(byPath.get(file.path) ?? null, digest)) fail('local-changed');
    if (!sameDigest(await readLocalFile(await gamePath(root, file.path), signal), digest))
      fail('local-changed');
  }
  signal?.throwIfAborted();
  reader.assertCurrent();
}
