import { ArrowIcon, CheckIcon, InfoIcon, WarnIcon } from '../components/Icons';
import { PageHeader } from '../components/ui';
import { formatDateTime, loaderLabel } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageId, PageProps } from './types';
import { validateServer } from './validation';

export function OverviewPage({ studio, draft, insights, go }: PageProps) {
  const { t, locale } = useStudioLocale();
  const { state } = studio;
  const { deploy } = insights;
  const loader = `${loaderLabel(draft.game.loader.kind)} ${draft.game.loader.version}`;
  const game = `Minecraft ${draft.game.minecraftVersion} · ${loader}`;
  const serverReady = Object.keys(validateServer(draft)).length === 0;
  const changed = insights.changed;
  const initialOnly = draft.files.filter((file) => file.policy === 'initial-only').length;
  const brandingSet = [draft.branding?.icon, draft.branding?.appName, draft.branding?.background];
  const brandingCount = brandingSet.filter(Boolean).length;
  const status = {
    stale: {
      tone: 'w' as const,
      icon: <WarnIcon />,
      title: t('overview.stale.title'),
      body: t('overview.stale.body', {
        added: deploy.changes.added,
        modified: deploy.changes.modified,
        excluded: deploy.changes.removed,
      }),
      cta: t('overview.stale.cta'),
    },
    current: {
      tone: 'k' as const,
      icon: <CheckIcon />,
      title: t('overview.current.title'),
      body: t('overview.current.body'),
      cta: t('overview.current.cta'),
    },
    unknown: {
      tone: 'n' as const,
      icon: <InfoIcon />,
      title: t('overview.unknown.title'),
      body: t('overview.unknown.body'),
      cta: t('overview.unknown.cta'),
    },
  }[deploy.status === 'changed' ? 'stale' : deploy.status === 'upToDate' ? 'current' : 'unknown'];
  const addressText = {
    unchecked: t('overview.address.unchecked'),
    ok: t('overview.address.ok'),
    bad: t('overview.address.bad'),
    stale: t('overview.address.stale'),
  }[insights.addressState];
  const card = (
    page: PageId,
    title: string,
    chip: { text: string; tone?: 'ok' | 'warn' },
    lines: string[],
  ) => (
    <button
      type="button"
      className="card cl"
      onClick={() => go(page)}
      data-testid={`overview-${page}`}
    >
      <span className="top">
        <h2>{title}</h2>
        <span className={`chip${chip.tone ? ` ${chip.tone}` : ''}`}>{chip.text}</span>
      </span>
      {lines.map((line, index) => (
        <p key={line} className={index > 0 ? 'dim' : undefined}>
          {line}
        </p>
      ))}
    </button>
  );
  return (
    <>
      <PageHeader
        eyebrow={t('overview.eyebrow')}
        title={draft.name || t('overview.untitled')}
        lead={`${game} · ${draft.address}`}
      />
      <section
        className="card"
        data-testid="deploy-status"
        data-state={
          deploy.status === 'changed'
            ? 'stale'
            : deploy.status === 'upToDate'
              ? 'current'
              : 'unknown'
        }
      >
        <div className="stat">
          <span className={`sico ${status.tone}`}>{status.icon}</span>
          <div className="stat-body">
            <h2>{status.title}</h2>
            <p>{status.body}</p>
            <div className="meta">
              <span>
                {deploy.lastBuild
                  ? t('overview.lastDeploy', {
                      date: formatDateTime(new Date(deploy.lastBuild.builtAt), locale),
                      count: deploy.lastBuild.fileCount,
                    })
                  : t('overview.noDeploy')}
              </span>
              <span>{t('overview.address', { status: addressText })}</span>
            </div>
          </div>
          <button
            type="button"
            className={`btn lg${deploy.status === 'upToDate' ? '' : ' primary'}`}
            onClick={() => go('deploy')}
          >
            {status.cta}
            <ArrowIcon />
          </button>
        </div>
      </section>
      <div className="grid4">
        {card(
          'server',
          t('nav.server'),
          serverReady
            ? { text: state?.dirty ? t('overview.chip.unsaved') : t('overview.chip.saved') }
            : { text: t('overview.chip.needed'), tone: 'warn' },
          [`${draft.name} · ${draft.address}`, game],
        )}
        {card(
          'brand',
          t('nav.brand'),
          brandingCount > 0
            ? { text: t('overview.chip.set', { count: brandingCount }), tone: 'ok' }
            : { text: t('overview.chip.default') },
          [brandingCount > 0 ? t('overview.brand.set') : t('overview.brand.default')],
        )}
        {card(
          'files',
          t('nav.files'),
          changed > 0
            ? { text: t('overview.chip.changed', { count: changed }), tone: 'warn' }
            : { text: t('overview.chip.unchanged') },
          [
            t('overview.files.count', {
              count: draft.files.length,
              always: draft.files.length - initialOnly,
              initial: initialOnly,
            }),
            state?.projectName
              ? t('overview.files.source', { name: state.projectName })
              : t('overview.files.noSource'),
          ],
        )}
        {card(
          'export',
          t('nav.export'),
          insights.export?.done
            ? { text: t('overview.chip.exported'), tone: 'ok' }
            : { text: t('overview.chip.notExported') },
          [
            insights.export?.done
              ? t('overview.export.last', { name: insights.export.done.fileName })
              : t('overview.export.none'),
            t('overview.export.hint'),
          ],
        )}
      </div>
    </>
  );
}
