import {
  parseServerIdentity,
  SERVER_MEMORY_INITIAL_MIN_MIB,
  SERVER_MEMORY_MAX_MAX_MIB,
  SERVER_MEMORY_MAX_MIN_MIB,
} from '../../../../../../packages/core/src/server-config/index.js';
import { minecraftVersions } from '../../../shared/minecraft-versions.js';
import type { StudioProject } from '../../../shared/studio.js';

const baselineConfig = {
  format: 'torchlauncher-server',
  version: 1,
  serverId: '44444444-4444-4444-8444-444444444444',
  name: 'Server',
  address: 'localhost:25565',
  sourceUrl: 'https://example.org/unconfigured',
} as const;

export type ServerField =
  | 'name'
  | 'address'
  | 'minecraftVersion'
  | 'loaderVersion'
  | 'memoryMax'
  | 'memoryInitial';
export type ServerErrors = Partial<
  Record<
    ServerField,
    | 'validation.name'
    | 'validation.address'
    | 'validation.version'
    | 'validation.gameVersion'
    | 'validation.memoryMax'
    | 'validation.memoryInitial'
    | 'validation.memoryInitialNeedsMax'
    | 'validation.memoryInitialAboveMax'
  >
>;

const versionToken = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Returns catalog keys (not text) so the pages translate them. */
export function validateServer(project: StudioProject): ServerErrors {
  const errors: ServerErrors = {};
  try {
    parseServerIdentity({ ...baselineConfig, name: project.name });
  } catch {
    errors.name = 'validation.name';
  }
  try {
    parseServerIdentity({ ...baselineConfig, address: project.address });
  } catch {
    errors.address = 'validation.address';
  }
  if (!(minecraftVersions as readonly string[]).includes(project.game.minecraftVersion))
    errors.minecraftVersion = 'validation.gameVersion';
  if (!versionToken.test(project.game.loader.version)) errors.loaderVersion = 'validation.version';
  const memory = project.memory;
  if (memory) {
    const hasMax = typeof memory.maxMiB === 'number' && !Number.isNaN(memory.maxMiB);
    const hasInitial = memory.initialMiB !== undefined;
    if ((hasMax || !hasInitial) && !isMemoryMax(memory.maxMiB))
      errors.memoryMax = 'validation.memoryMax';
    if (hasInitial && !isMemoryInitial(memory.initialMiB)) {
      errors.memoryInitial = 'validation.memoryInitial';
    } else if (hasInitial && !hasMax) {
      errors.memoryInitial = 'validation.memoryInitialNeedsMax';
    } else if (
      hasInitial &&
      hasMax &&
      !errors.memoryMax &&
      memory.initialMiB !== undefined &&
      memory.initialMiB > memory.maxMiB
    ) {
      errors.memoryInitial = 'validation.memoryInitialAboveMax';
    }
  }
  return errors;
}

function isMemoryMax(value: unknown) {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= SERVER_MEMORY_MAX_MIN_MIB &&
    (value as number) <= SERVER_MEMORY_MAX_MAX_MIB
  );
}
function isMemoryInitial(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= SERVER_MEMORY_INITIAL_MIN_MIB;
}

/** Parses a GB text box into MiB; blank is `undefined`, unparsable text is NaN (invalid). */
export function parseMemoryGiBText(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const gib = Number(text);
  return Number.isFinite(gib) ? Math.round(gib * 1024 * 1000) / 1000 : Number.NaN;
}

export function validHttps(value: string) {
  try {
    parseServerIdentity({ ...baselineConfig, sourceUrl: value });
    return true;
  } catch {
    return false;
  }
}
