import type { PageId } from './types';

export type ManagedBy = 'options' | 'resourcepack' | 'shaderpack';

/**
 * Files the game-settings section owns (options.txt, resource packs, shader packs). The Files page
 * shows them as managed there instead of offering an apply policy.
 */
export function managedBy(path: string): ManagedBy | null {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  if (normalized === 'options.txt') return 'options';
  if (normalized.startsWith('resourcepacks/')) return 'resourcepack';
  if (normalized.startsWith('shaderpacks/')) return 'shaderpack';
  return null;
}

/** The settings page that owns a managed file (where its "managed in game settings" link goes). */
export function managedPage(path: string): PageId {
  const owner = managedBy(path);
  if (owner === 'resourcepack') return 'packs';
  if (owner === 'shaderpack') return 'shaders';
  if (path.replaceAll('\\', '/').toLowerCase().startsWith('config/')) return 'mods';
  return 'playerSettings';
}
