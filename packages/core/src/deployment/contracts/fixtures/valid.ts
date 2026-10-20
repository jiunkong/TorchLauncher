import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  DEPLOYMENT_FORMAT_VERSION,
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_MAGIC,
  type DeploymentHeader,
  type DeploymentIndex,
  type DeploymentLoaderKind,
  EMPTY_FILE_SHA256,
} from '../types.js';

export const SERVER_ID = '11111111-1111-4111-8111-111111111111';
export const DEPLOYMENT_ID = '22222222-2222-4222-8222-222222222222';
export const OTHER_SERVER_ID = '33333333-3333-4333-8333-333333333333';

/** Fresh objects plus real bytes/digests for downstream writer/reader test reuse. */
export function createValidDeployment(kind: DeploymentLoaderKind = 'neoforge') {
  const settings = Buffer.from('enabled=true\n');
  const mod = Buffer.from('test fixture, not a playable Minecraft mod');
  const compressedMod = gzipSync(mod);
  const index: DeploymentIndex = {
    formatVersion: { ...DEPLOYMENT_FORMAT_VERSION },
    serverId: SERVER_ID,
    deploymentId: DEPLOYMENT_ID,
    game: {
      minecraftVersion: '1.21.1',
      loader: { kind, version: kind === 'neoforge' ? '21.1.200' : '0.16.14' },
    },
    files: [
      {
        path: 'config/server.toml',
        sha256: createHash('sha256').update(settings).digest('hex'),
        offset: 0,
        storedLength: settings.length,
        originalLength: settings.length,
        compression: 'none',
        policy: 'initial-only',
      },
      {
        path: 'mods/example.jar',
        sha256: createHash('sha256').update(mod).digest('hex'),
        offset: settings.length,
        storedLength: compressedMod.length,
        originalLength: mod.length,
        compression: 'gzip',
        policy: 'always',
      },
      {
        path: 'config/empty.txt',
        sha256: EMPTY_FILE_SHA256,
        offset: settings.length + compressedMod.length,
        storedLength: 0,
        originalLength: 0,
        compression: 'none',
        policy: 'initial-only',
      },
    ],
  };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const payloadBytes = Buffer.concat([settings, compressedMod]);
  const header: DeploymentHeader = {
    magic: DEPLOYMENT_MAGIC,
    formatVersion: { ...DEPLOYMENT_FORMAT_VERSION },
    flags: 0,
    indexLength: indexBytes.length,
    totalLength: DEPLOYMENT_HEADER_LENGTH + indexBytes.length + payloadBytes.length,
    indexSha256: createHash('sha256').update(indexBytes).digest('hex'),
  };
  return {
    index,
    header,
    indexBytes,
    payloadBytes,
    originalBytes: [settings, mod, Buffer.alloc(0)],
  };
}
