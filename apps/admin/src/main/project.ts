import { randomUUID } from 'node:crypto';
import {
  EMPTY_FILE_SHA256,
  validateDeploymentIndex,
} from '../../../../packages/core/src/deployment/contracts/index.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import type { StudioLastBuild, StudioProject } from '../shared/studio.js';
import { parseBranding } from './branding.js';
import { parseGameSettings } from './game-settings.js';

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
    Object.keys(p).some(
      (k) => ![...keys, 'branding', 'sequence', 'lastBuild', 'gameSettings'].includes(k),
    ) ||
    keys.some((k) => !Object.hasOwn(p, k)) ||
    p.format !== 'torchlauncher-project' ||
    (p.version !== 1 && p.version !== 2) ||
    // Schema 1 predates these fields: a file that has them must say it is schema 2.
    (p.version === 1 && (Object.hasOwn(p, 'lastBuild') || Object.hasOwn(p, 'gameSettings'))) ||
    !Array.isArray(p.files) ||
    p.files.length > 10000 ||
    typeof p.sourceUrl !== 'string'
  )
    throw new StudioFailure('INVALID');
  try {
    if (Object.hasOwn(p, 'branding')) parseBranding(p.branding);
    if (
      Object.hasOwn(p, 'sequence') &&
      (!Number.isSafeInteger(p.sequence) ||
        (p.sequence as number) < 1 ||
        (p.sequence as number) >= Number.MAX_SAFE_INTEGER)
    )
      throw new StudioFailure('INVALID');
    if (Object.hasOwn(p, 'lastBuild')) parseLastBuild(p.lastBuild);
    if (Object.hasOwn(p, 'gameSettings')) parseGameSettings(p.gameSettings);
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
const SHA = /^[0-9a-f]{64}$/;
export function parseLastBuild(input: unknown): StudioLastBuild {
  const fail = (): never => {
    throw new StudioFailure('INVALID');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const b = input as Record<string, unknown>;
  const game = b.game as Record<string, unknown> | undefined;
  const loader = game?.loader as Record<string, unknown> | undefined;
  if (
    Object.keys(b).sort().join(',') !==
      'brandingKey,builtAt,deploymentId,fileName,files,game,sequence,totalLength' ||
    typeof b.deploymentId !== 'string' ||
    b.deploymentId.length < 1 ||
    b.deploymentId.length > 64 ||
    !Number.isSafeInteger(b.builtAt) ||
    typeof b.fileName !== 'string' ||
    !b.fileName ||
    b.fileName.length > 255 ||
    /[\\/]/.test(b.fileName) ||
    !Number.isSafeInteger(b.totalLength) ||
    (b.totalLength as number) < 0 ||
    (b.sequence !== null && (!Number.isSafeInteger(b.sequence) || (b.sequence as number) < 1)) ||
    typeof b.brandingKey !== 'string' ||
    !SHA.test(b.brandingKey) ||
    !game ||
    typeof game.minecraftVersion !== 'string' ||
    !loader ||
    typeof loader.kind !== 'string' ||
    typeof loader.version !== 'string' ||
    !Array.isArray(b.files) ||
    b.files.length > 10300
  )
    return fail();
  for (const f of b.files as unknown[]) {
    const e = f as Record<string, unknown>;
    if (
      !e ||
      typeof e !== 'object' ||
      Object.keys(e).sort().join(',') !== 'length,path,policy,sha256' ||
      typeof e.path !== 'string' ||
      !e.path ||
      e.path.length > 1024 ||
      (e.policy !== 'always' && e.policy !== 'initial-only') ||
      typeof e.sha256 !== 'string' ||
      !SHA.test(e.sha256) ||
      !Number.isSafeInteger(e.length) ||
      (e.length as number) < 0
    )
      return fail();
  }
  return b as unknown as StudioLastBuild;
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
