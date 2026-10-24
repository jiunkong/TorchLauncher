import { parseServerIdentity } from '../../../../../../packages/core/src/server-config/index.js';
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

export type ServerField = 'name' | 'address' | 'minecraftVersion' | 'loaderVersion';
export type ServerErrors = Partial<
  Record<
    ServerField,
    'validation.name' | 'validation.address' | 'validation.version' | 'validation.gameVersion'
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
  return errors;
}

export function validHttps(value: string) {
  try {
    parseServerIdentity({ ...baselineConfig, sourceUrl: value });
    return true;
  } catch {
    return false;
  }
}
