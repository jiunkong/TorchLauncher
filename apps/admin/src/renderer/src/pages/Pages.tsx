import type { Insights } from '../adapters/insights';
import type { StudioController } from '../hooks/useStudio';
import type { SettingsState } from '../settings/state';
import { BrandPage } from './BrandPage';
import { DeployPage } from './DeployPage';
import { ExportPage } from './ExportPage';
import { FilesPage } from './FilesPage';
import { OverviewPage } from './OverviewPage';
import { ServerPage } from './ServerPage';
import { SettingsPage } from './SettingsPage';
import { StartPage } from './StartPage';
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
      return <SettingsPage {...props} settings={settings} view="config" />;
    case 'packs':
      return <SettingsPage {...props} settings={settings} view="packs" />;
    case 'shaders':
      return <SettingsPage {...props} settings={settings} view="shaders" />;
    case 'playerSettings':
      return <SettingsPage {...props} settings={settings} view="player" />;
    case 'test':
      return <TestPage studio={studio} draft={draft} go={go} />;
    case 'deploy':
      return <DeployPage {...props} />;
    case 'export':
      return <ExportPage {...props} />;
  }
}
