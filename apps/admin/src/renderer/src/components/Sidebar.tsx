import { Fragment, type ReactNode } from 'react';
import type { Insights } from '../adapters/insights';
import torchUrl from '../assets/torch.png';
import { loaderLabel } from '../format';
import type { StudioController } from '../hooks/useStudio';
import { useStudioLocale } from '../i18n';
import { type PageId, pageIds } from '../pages/types';
import { validateServer } from '../pages/validation';
import {
  BrandIcon,
  FolderIcon,
  KeyboardIcon,
  LayersIcon,
  OverviewIcon,
  PackageIcon,
  PlayIcon,
  ServerIcon,
  SlidersIcon,
  SunIcon,
  UploadIcon,
} from './Icons';

const icons: Record<PageId, ReactNode> = {
  overview: <OverviewIcon />,
  server: <ServerIcon />,
  brand: <BrandIcon />,
  mods: <SlidersIcon />,
  packs: <LayersIcon />,
  shaders: <SunIcon />,
  files: <FolderIcon />,
  test: <PlayIcon />,
  playerSettings: <KeyboardIcon />,
  deploy: <UploadIcon />,
  export: <PackageIcon />,
};
type GroupTranslationKey =
  | 'nav.group.game'
  | 'nav.group.test'
  | 'nav.group.player'
  | 'nav.group.deploy';
const groupLabels: Partial<Record<PageId, GroupTranslationKey>> = {
  mods: 'nav.group.game',
  test: 'nav.group.test',
  playerSettings: 'nav.group.player',
  deploy: 'nav.group.deploy',
};

export function Sidebar({
  studio,
  insights,
  page,
  onNavigate,
}: {
  studio: StudioController;
  insights: Insights;
  page: PageId;
  onNavigate(page: PageId): void;
}) {
  const { t } = useStudioLocale();
  const { draft, state } = studio;
  if (!draft) return null;
  const tags: Partial<Record<PageId, { text: string; tone: 'w' | 'k' }>> = {};
  if (Object.keys(validateServer(draft)).length > 0)
    tags.server = { text: t('tag.needed'), tone: 'w' };
  if (insights.changed > 0)
    tags.files = { text: t('tag.changes', { count: insights.changed }), tone: 'w' };
  if (insights.deploy.status === 'changed') tags.deploy = { text: t('tag.rebuild'), tone: 'w' };
  else if (insights.deploy.status === 'upToDate')
    tags.deploy = { text: t('tag.current'), tone: 'k' };
  const dirty = !!state?.dirty;
  return (
    <aside className="side" aria-label={t('nav.sidebar')}>
      <div className="pcard" data-testid="project-card">
        <span className="ico">
          <img src={torchUrl} alt="" width={34} height={34} />
        </span>
        <span className="pname">
          <strong>{draft.name || t('overview.untitled')}</strong>
          <small>
            Minecraft {draft.game.minecraftVersion} · {loaderLabel(draft.game.loader.kind)}{' '}
            {draft.game.loader.version}
          </small>
        </span>
      </div>
      <nav className="menu" aria-label={t('nav.sections')}>
        {pageIds.map((id) => {
          const group = groupLabels[id];
          const tag = tags[id];
          return (
            <Fragment key={id}>
              {group && <div className="mg">{t(group)}</div>}
              <button
                type="button"
                className={`mi${page === id ? ' active' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                {icons[id]}
                <span className="mi-label">{t(`nav.${id}`)}</span>
                {tag && <span className={`tag ${tag.tone}`}>{tag.text}</span>}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <div className="sidefoot">
        <div className="savest" data-testid="save-state" data-dirty={dirty}>
          <span className={`dot ${dirty ? 'warn' : 'ok'}`} />
          <span className="savest-text">{dirty ? t('save.unsaved') : t('save.saved')}</span>
        </div>
      </div>
    </aside>
  );
}
