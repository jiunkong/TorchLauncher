import type { ReactNode } from 'react';
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
  GamepadIcon,
  OverviewIcon,
  PackageIcon,
  ServerIcon,
  UploadIcon,
} from './Icons';

const icons: Record<PageId, ReactNode> = {
  overview: <OverviewIcon />,
  server: <ServerIcon />,
  brand: <BrandIcon />,
  files: <FolderIcon />,
  settings: <GamepadIcon />,
  deploy: <UploadIcon />,
  export: <PackageIcon />,
};

export function Sidebar({
  studio,
  insights,
  page,
  onNavigate,
  onProject,
  info,
}: {
  studio: StudioController;
  insights: Insights;
  page: PageId;
  onNavigate(page: PageId): void;
  onProject(action: 'new' | 'open'): void;
  info: string;
}) {
  const { t } = useStudioLocale();
  const { draft, state, busy, run } = studio;
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
          const tag = tags[id];
          return (
            <button
              key={id}
              type="button"
              className={`mi${page === id ? ' active' : ''}`}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              {icons[id]}
              <span className="mi-label">{t(`nav.${id}`)}</span>
              {tag && <span className={`tag ${tag.tone}`}>{tag.text}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidefoot">
        <div className="savest" data-testid="save-state" data-dirty={dirty}>
          <span className={`dot ${dirty ? 'warn' : 'ok'}`} />
          {dirty ? t('save.unsaved') : t('save.saved')}
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void run('save')}>
          {t('save.save')}
        </button>
        <div className="foot-row">
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => onProject('new')}
          >
            {t('project.new')}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => onProject('open')}
          >
            {t('project.open')}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => void run('saveAs')}
          >
            {t('save.saveAs')}
          </button>
        </div>
        <div className="appinfo" data-testid="application-info">
          {info}
        </div>
      </div>
    </aside>
  );
}
