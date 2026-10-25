import { randomUUID } from 'node:crypto';
import {
  EMPTY_FILE_SHA256,
  validateDeploymentIndex,
} from '../../../../packages/core/src/deployment/contracts/index.js';
import {
  parseServerIdentity,
  parseServerMemory,
} from '../../../../packages/core/src/server-config/index.js';
import type { StudioLastBuild, StudioProject } from '../shared/studio.js';
import { parseBranding } from './branding.js';
import { isReservedPath, parseGameSettings } from './game-settings.js';

export class StudioFailure extends Error {
  constructor(readonly code: import('../shared/studio.js').StudioError) {
    super(code);
  }
}
/** A pack file that cannot be added, with the precise reason shown to the user. */
export class PackFailure extends StudioFailure {
  constructor(readonly reason: import('../shared/studio.js').PackSkipReason) {
    super('INVALID');
  }
}
/** A precise settings-source failure within the existing INVALID request category. */
export class TestSettingsFailure extends StudioFailure {
  constructor(readonly detailCode: import('../shared/studio.js').StudioTestSettingsError) {
    super('INVALID');
  }
}
/** A policy that cannot be built; `code` is the core SettingsError code (or `config-owned-by-sync`). */
export class PolicyFailure extends StudioFailure {
  constructor(
    readonly settingsCode: string,
    readonly detail: string,
  ) {
    super(settingsCode === 'limit-exceeded' ? 'TOO_LARGE' : 'INVALID');
  }
}
export function parseProject(input: unknown): StudioProject {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new StudioFailure('INVALID');
  const p = input as Record<string, unknown>;
  const keys = ['format', 'version', 'serverId', 'name', 'address', 'sourceUrl', 'game', 'files'];
  if (
    Object.keys(p).some(
      (k) => ![...keys, 'branding', 'memory', 'sequence', 'lastBuild', 'gameSettings'].includes(k),
    ) ||
    keys.some((k) => !Object.hasOwn(p, k)) ||
    p.format !== 'torchlauncher-project' ||
    p.version !== 1 ||
    !Array.isArray(p.files) ||
    p.files.length > 10000 ||
    typeof p.sourceUrl !== 'string'
  )
    throw new StudioFailure('INVALID');
  try {
    if (Object.hasOwn(p, 'branding')) parseBranding(p.branding);
    if (Object.hasOwn(p, 'memory')) parseServerMemory(p.memory);
    if (
      Object.hasOwn(p, 'sequence') &&
      (!Number.isSafeInteger(p.sequence) ||
        (p.sequence as number) < 1 ||
        (p.sequence as number) >= Number.MAX_SAFE_INTEGER)
    )
      throw new StudioFailure('INVALID');
    if (Object.hasOwn(p, 'lastBuild')) parseLastBuild(p.lastBuild);
    if (Object.hasOwn(p, 'gameSettings')) parseGameSettings(p.gameSettings);
    parseServerIdentity({
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
      if (
        Object.keys(f).sort().join(',') !== 'path,policy,targetPath' ||
        typeof f.path !== 'string' ||
        typeof f.targetPath !== 'string' ||
        (f.policy !== 'always' && f.policy !== 'initial-only')
      )
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
    const validatePaths = (paths: string[]) =>
      validateDeploymentIndex(
        {
          formatVersion: { major: 1, minor: 2 },
          serverId: p.serverId,
          deploymentId: p.serverId,
          game: p.game,
          sequence: 1,
          branding: {},
          files: paths.map((path) => ({ ...files[0], path })),
        },
        {
          magic: 'TORCHDEP',
          formatVersion: { major: 1, minor: 2 },
          flags: 0,
          indexLength: 1,
          totalLength: 129,
          indexSha256: EMPTY_FILE_SHA256,
        },
        { expectedServerId: p.serverId as string },
      );
    validatePaths(files.map((file) => file.path));
    // Managed files (player settings, mods, resource packs, shaders) cannot be a source either.
    if (files.some((file) => isReservedPath(file.path))) throw new StudioFailure('INVALID');
    const targets = (p.files as Record<string, unknown>[]).map((file) => file.targetPath as string);
    validatePaths(targets);
    if (targets.some((path) => isReservedPath(path))) throw new StudioFailure('INVALID');
  } catch {
    throw new StudioFailure('INVALID');
  }
  const project = structuredClone(input) as StudioProject;
  // Mods are always applied: normalize whatever policy a saved project carries.
  for (const mod of project.gameSettings?.mods ?? []) mod.policy = 'required';
  return project;
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
    !Number.isSafeInteger(b.sequence) ||
    (b.sequence as number) < 1 ||
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
      Object.keys(e).sort().join(',') !== 'length,path,policy,sha256,sourcePath' ||
      typeof e.path !== 'string' ||
      !e.path ||
      typeof e.sourcePath !== 'string' ||
      !e.sourcePath ||
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
export function newProject(name = 'New server'): StudioProject {
  return {
    format: 'torchlauncher-project',
    version: 1,
    serverId: randomUUID(),
    name,
    address: 'localhost:25565',
    sourceUrl: '',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
    files: [],
    memory: { maxMiB: 2048 },
  };
}
