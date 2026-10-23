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
