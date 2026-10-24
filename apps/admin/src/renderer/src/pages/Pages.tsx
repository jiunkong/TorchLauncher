import type { Insights } from '../adapters/insights';
import type { StudioController } from '../hooks/useStudio';
import type { SettingsState } from '../settings/state';
import { BrandPage } from './BrandPage';
import { DeployPage } from './DeployPage';
import { ExportPage } from './ExportPage';
import { FilesPage } from './FilesPage';
import { OverviewPage } from './OverviewPage';
import { ServerPage } from './ServerPage';
import { StartPage } from './StartPage';
import { ModSettingsPage } from './settings/ModSettingsPage';
import { PackSettingsPage } from './settings/PackSettingsPage';
import { PlayerSettingsPage } from './settings/PlayerSettingsPage';
import { ShaderSettingsPage } from './settings/ShaderSettingsPage';
import { TestPage } from './TestPage';
import type { PageId } from './types';

export type { PageId } from './types';

export function PageContent({
  page,
  studio,
  insights,
  settings,
  go,
}: {
  page: PageId;
  studio: StudioController;
  insights: Insights;
  settings: SettingsState;
  go(page: PageId): void;
}) {
  const { draft } = studio;
  if (!draft) return <StartPage studio={studio} />;
  const props = { studio, draft, insights, go };
  switch (page) {
    case 'overview':
      return <OverviewPage {...props} />;
    case 'server':
      return <ServerPage {...props} />;
    case 'brand':
      return <BrandPage {...props} />;
    case 'files':
      return <FilesPage {...props} />;
    case 'mods':
      return <ModSettingsPage {...props} />;
    case 'packs':
      return <PackSettingsPage {...props} />;
    case 'shaders':
      return <ShaderSettingsPage {...props} />;
    case 'playerSettings':
      return <PlayerSettingsPage {...props} settings={settings} />;
    case 'test':
      return <TestPage studio={studio} draft={draft} go={go} />;
    case 'deploy':
      return <DeployPage {...props} />;
    case 'export':
      return <ExportPage {...props} />;
  }
}
