import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteServerData,
  ensureServerDataRoot,
  previewServerDataDeletion,
  resolveServerDataRoot,
} from '../../../../../packages/core/src/instance/data/index';
import { parseServerConfig } from '../../../../../packages/core/src/server-config/index';
import {
  openServerDeployment,
  ROLLBACK_STATE_FILE,
  readRollbackState,
  recordAppliedDeployment,
} from './deployment-trust';
import {
  buildDeployment,
  deploymentA,
  deploymentB,
  MemorySource,
  newKey,
  serverId,
} from './deployment-trust.fixture';

const served = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined }));
vi.mock('../../../../../packages/core/src/download/source/index', async (original) => ({
  ...(await original<typeof import('../../../../../packages/core/src/download/source/index')>()),
  createDownloadSource: () => new MemorySource(served.bytes as Uint8Array),
}));

const key = newKey();
const otherKey = newKey();
const roots: string[] = [];
let base: string;
const config = (publicKey?: string) =>
  parseServerConfig({
    format: 'torchlauncher-server',
    version: 1,
    serverId,
    name: 'Fixture',
    address: 'localhost:25565',
    sourceUrl: 'https://example.invalid/never-leak',
    ...(publicKey ? { signing: { algorithm: 'ed25519', publicKey } } : {}),
  });
const serve = (bytes: Uint8Array) => {
  served.bytes = bytes;
};
const statePath = () => join(resolveServerDataRoot(base, serverId), ROLLBACK_STATE_FILE);
async function accept(sequence: number, deploymentId = deploymentA, payload = 'payload') {
  serve(await buildDeployment({ signer: key.privateKey, sequence, deploymentId, payload }));
  const reader = await openServerDeployment(base, config(key.publicKey));
  await recordAppliedDeployment(base, config(key.publicKey), reader);
  return reader;
}
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'launcher-trust-')));
  roots.push(base);
  await ensureServerDataRoot(base, serverId);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('signature requirements', () => {
  it('accepts a valid signed deployment and marks it verified', async () => {
    serve(await buildDeployment({ signer: key.privateKey, sequence: 3 }));
    const reader = await openServerDeployment(base, config(key.publicKey));
    expect(reader.verification).toBe('verified');
    expect(reader.index.sequence).toBe(3);
  });
  it('rejects unsigned 1.0 when a key is configured', async () => {
    serve(await buildDeployment());
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'signature-required',
    });
  });
  it('rejects a different key', async () => {
    serve(await buildDeployment({ signer: otherKey.privateKey, sequence: 1 }));
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'signature-invalid',
    });
  });
  it('rejects a tampered signature, index and header', async () => {
    const good = await buildDeployment({ signer: key.privateKey, sequence: 1 });
    for (const offset of [10, 70, 130]) {
      const bad = Buffer.from(good);
      bad[offset] = (bad[offset] ?? 0) ^ 0x01;
      serve(bad);
      await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
        name: 'DeploymentReaderError',
      });
    }
  });
  it('treats a signed file without a configured key as unverified and never records it', async () => {
    serve(await buildDeployment({ signer: key.privateKey, sequence: 9 }));
    const reader = await openServerDeployment(base, config());
    expect(reader.verification).toBe('unverified');
    await recordAppliedDeployment(base, config(), reader);
    expect(await readRollbackState(base, serverId)).toBeNull();
  });
  it('keeps accepting legacy unsigned deployments without a configured key', async () => {
    serve(await buildDeployment());
    const reader = await openServerDeployment(base, config());
    expect(reader.verification).toBe('unsigned');
    await recordAppliedDeployment(base, config(), reader);
    expect(await readRollbackState(base, serverId)).toBeNull();
  });
});

describe('rollback decision', () => {
  it('accepts the first install, higher sequence and the identical redeploy', async () => {
    await accept(2);
    await accept(2);
    await accept(5, deploymentB);
    expect(await readRollbackState(base, serverId)).toMatchObject({
      sequence: 5,
      deploymentId: deploymentB,
    });
  });
  it('rejects a lower sequence', async () => {
    await accept(5);
    serve(await buildDeployment({ signer: key.privateKey, sequence: 4 }));
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'rollback-lower',
    });
  });
  it('rejects an equal sequence with another deployment id or other content', async () => {
    await accept(5);
    serve(
      await buildDeployment({ signer: key.privateKey, sequence: 5, deploymentId: deploymentB }),
    );
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'rollback-conflict',
    });
    serve(await buildDeployment({ signer: key.privateKey, sequence: 5, payload: 'different' }));
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'rollback-conflict',
    });
  });
  it('does not persist while only opening (branding and failed or cancelled applies)', async () => {
    serve(await buildDeployment({ signer: key.privateKey, sequence: 8 }));
    await openServerDeployment(base, config(key.publicKey));
    expect(await readRollbackState(base, serverId)).toBeNull();
    await accept(2);
    serve(await buildDeployment({ signer: key.privateKey, sequence: 8 }));
    await openServerDeployment(base, config(key.publicKey));
    expect(await readRollbackState(base, serverId)).toMatchObject({ sequence: 2 });
  });
  it('never lowers stored state when recording a stale reader', async () => {
    serve(await buildDeployment({ signer: key.privateKey, sequence: 3 }));
    const stale = await openServerDeployment(base, config(key.publicKey));
    await accept(6);
    await expect(recordAppliedDeployment(base, config(key.publicKey), stale)).rejects.toMatchObject(
      {
        code: 'rollback-lower',
      },
    );
    expect(await readRollbackState(base, serverId)).toMatchObject({ sequence: 6 });
  });
  it('writes atomically with no temporary leftovers and a bounded strict file', async () => {
    await accept(4);
    const entries = await readdir(resolveServerDataRoot(base, serverId));
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const text = await readFile(statePath(), 'utf8');
    expect(text.length).toBeLessThan(512);
    expect(JSON.parse(text)).toEqual({
      version: 1,
      sequence: 4,
      deploymentId: deploymentA,
      indexSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });
});

describe('corrupt state fails closed', () => {
  it.each([
    ['not json', '{'],
    [
      'extra field',
      '{"version":1,"sequence":1,"deploymentId":"a","indexSha256":"' + 'a'.repeat(64) + '","x":1}',
    ],
    [
      'bad sequence',
      '{"version":1,"sequence":0,"deploymentId":"a","indexSha256":"' + 'a'.repeat(64) + '"}',
    ],
    ['bad hash', '{"version":1,"sequence":1,"deploymentId":"a","indexSha256":"zz"}'],
    ['oversized', ' '.repeat(5000)],
  ])('%s', async (_name, text) => {
    await writeFile(statePath(), text);
    serve(await buildDeployment({ signer: key.privateKey, sequence: 99 }));
    await expect(openServerDeployment(base, config(key.publicKey))).rejects.toMatchObject({
      code: 'rollback-state-unreadable',
    });
    // The state file is left untouched rather than silently reset.
    expect(await readFile(statePath(), 'utf8')).toBe(text);
  });
  it('does not consult the state at all without a configured key', async () => {
    await writeFile(statePath(), '{');
    serve(await buildDeployment());
    await expect(openServerDeployment(base, config())).resolves.toBeDefined();
  });
});

it('removes the state together with server data deletion', async () => {
  await accept(3);
  expect(await readRollbackState(base, serverId)).not.toBeNull();
  const preview = await previewServerDataDeletion(base, serverId);
  expect(preview.deletable).toBe(true);
  await deleteServerData(base, serverId, preview.confirmation?.token as string);
  expect(await readRollbackState(base, serverId)).toBeNull();
  // First install after deletion: any validly signed deployment is accepted again.
  await ensureServerDataRoot(base, serverId);
  await accept(1);
});
