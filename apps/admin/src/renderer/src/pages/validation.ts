import { parseServerConfig } from '../../../../../../packages/core/src/server-config/index.js';
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
  Record<ServerField, 'validation.name' | 'validation.address' | 'validation.version'>
>;

const versionToken = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Returns catalog keys (not text) so the pages translate them. */
export function validateServer(project: StudioProject): ServerErrors {
  const errors: ServerErrors = {};
  try {
    parseServerConfig({ ...baselineConfig, name: project.name });
  } catch {
    errors.name = 'validation.name';
  }
  try {
    parseServerConfig({ ...baselineConfig, address: project.address });
  } catch {
    errors.address = 'validation.address';
  }
  if (!versionToken.test(project.game.minecraftVersion))
    errors.minecraftVersion = 'validation.version';
  if (!versionToken.test(project.game.loader.version)) errors.loaderVersion = 'validation.version';
  return errors;
}

export function validHttps(value: string) {
  try {
    parseServerConfig({ ...baselineConfig, sourceUrl: value });
    return true;
  } catch {
    return false;
  }
}
