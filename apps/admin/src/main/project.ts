import { randomUUID } from 'node:crypto';
import {
  EMPTY_FILE_SHA256,
  validateDeploymentIndex,
} from '../../../../packages/core/src/deployment/contracts/index.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import type { StudioProject } from '../shared/studio.js';

export class StudioFailure extends Error {
  constructor(readonly code: import('../shared/studio.js').StudioError) {
    super(code);
  }
}
export function parseProject(input: unknown): StudioProject {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new StudioFailure('INVALID');
  const p = input as Record<string, unknown>;
  const keys = ['format', 'version', 'serverId', 'name', 'address', 'sourceUrl', 'game', 'files'];
  if (
    Object.keys(p).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(p, k)) ||
    p.format !== 'torchlauncher-project' ||
    p.version !== 1 ||
    !Array.isArray(p.files) ||
    p.files.length > 10000 ||
    typeof p.sourceUrl !== 'string'
  )
    throw new StudioFailure('INVALID');
  try {
    parseServerConfig({
      format: 'torchlauncher-server',
      version: 1,
      serverId: p.serverId,
      name: p.name,
      address: p.address,
      sourceUrl: p.sourceUrl || 'https://example.org/unconfigured',
    });
    const files = p.files.map((file: unknown) => {
      if (!file || typeof file !== 'object' || Array.isArray(file))
        throw new StudioFailure('INVALID');
      const f = file as Record<string, unknown>;
      if (Object.keys(f).length !== 2 || !Object.hasOwn(f, 'path') || !Object.hasOwn(f, 'policy'))
        throw new StudioFailure('INVALID');
      return {
        path: f.path,
        policy: f.policy,
        sha256: EMPTY_FILE_SHA256,
        offset: 0,
        originalLength: 0,
        storedLength: 0,
        compression: 'none',
      };
    });
    validateDeploymentIndex(
      {
        formatVersion: { major: 1, minor: 0 },
        serverId: p.serverId,
        deploymentId: p.serverId,
        game: p.game,
        files,
      },
      {
        magic: 'TORCHDEP',
        formatVersion: { major: 1, minor: 0 },
        flags: 0,
        indexLength: 1,
        totalLength: 65,
        indexSha256: EMPTY_FILE_SHA256,
      },
      { expectedServerId: p.serverId as string },
    );
  } catch {
    throw new StudioFailure('INVALID');
  }
  return structuredClone(input) as StudioProject;
}
export function newProject(): StudioProject {
  return {
    format: 'torchlauncher-project',
    version: 1,
    serverId: randomUUID(),
    name: '새 서버',
    address: 'localhost:25565',
    sourceUrl: '',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
    files: [],
  };
}
