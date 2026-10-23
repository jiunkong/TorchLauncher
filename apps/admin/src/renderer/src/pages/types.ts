import type { StudioProject } from '../../../shared/studio.js';
import type { Insights } from '../adapters/insights';
import type { StudioController } from '../hooks/useStudio';

export type PageId =
  | 'overview'
  | 'server'
  | 'brand'
  | 'mods'
  | 'packs'
  | 'shaders'
  | 'files'
  | 'test'
  | 'playerSettings'
  | 'deploy'
  | 'export';
export const pageIds: PageId[] = [
  'overview',
  'server',
  'brand',
  'mods',
  'packs',
  'shaders',
  'files',
  'test',
  'playerSettings',
  'deploy',
  'export',
];

export interface PageProps {
  studio: StudioController;
  draft: StudioProject;
  insights: Insights;
  go(page: PageId): void;
}
