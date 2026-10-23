import { useEffect, useState } from 'react';
import type { StudioExportCheck } from '../../../shared/studio.js';
import { CheckIcon, DownloadIcon, FileIcon, FolderIcon } from '../components/Icons';
import { CheckRow, Note, PageHeader } from '../components/ui';
import { formatBytes, loaderLabel } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { validateServer } from './validation';

/** The done screen is dismissed per export result; it must survive leaving the page. */
let dismissedDone: string | null = null;

export function ExportPage({ studio, draft, insights, go }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, command, run, state } = studio;
  const { deploy } = insights;
  const status = insights.export;
  const [dismissed, setDismissedState] = useState<string | null>(dismissedDone);
  const setDismissed = (key: string | null) => {
    dismissedDone = key;
    setDismissedState(key);
  };
  const sourceReady = !!state?.sourceName;
  const serverReady = Object.keys(validateServer(draft)).length === 0;
  const game = `${draft.game.minecraftVersion} · ${loaderLabel(draft.game.loader.kind)} ${draft.game.loader.version}`;
  const done = status?.done ?? null;
  const doneKey = done ? `${done.fileName}:${done.size}` : null;

  // Re-evaluate the checks (rescans the source folder, no network) when the page opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per visit
  useEffect(() => {
    if (sourceReady) void command({ action: 'exportCheck' });
  }, []);

  const rows: StudioExportCheck[] = status?.checks ?? [];
  const labels = {
    serverId: t('export.serverId'),
    game: t('export.game'),
    url: t('export.url'),
    deployment: t('export.deployment'),
  } as const;
  const rowStatus = (check: StudioExportCheck): 'ok' | 'bad' | 'pending' => {
    if (check.ok) return 'ok';
    return check.reasons.every((reason) => reason === 'url-unchecked') ? 'pending' : 'bad';
  };
  const rowDetail = (check: StudioExportCheck): string | undefined => {
    if (check.ok) return check.id === 'game' ? game : undefined;
    const text = check.reasons.map((reason) => t(`export.reason.${reason}`)).join(' ');
    return check.id === 'game' ? `${text} (${game})` : text;
  };
  const blocked = !status || status.blocked;

  if (done && dismissed !== doneKey) {
    return (
      <>
        <section className="card done" data-testid="export-done">
          <span className="okbig">
            <CheckIcon />
          </span>
          <div className="done-text">
            <h1>{t('export.done.title')}</h1>
            <p>{t('export.done.lead')}</p>
          </div>
          <button
            type="button"
            className="btn primary lg"
            disabled={busy}
            onClick={() => void command({ action: 'revealExport' })}
          >
            <FolderIcon />
            {t('export.openFolder')}
          </button>
        </section>
        <section className="card">
          <h2>{t('export.done.files')}</h2>
          <div className="fl">
            <FileIcon />
            <span className="g">
              <span className="mono" data-testid="export-result">
                {done.fileName}
              </span>
              <small>{t('export.done.size', { size: formatBytes(done.size) })}</small>
            </span>
          </div>
        </section>
        <Note>{t('export.done.note')}</Note>
        <div className="row-actions start">
          <button type="button" className="btn" onClick={() => setDismissed(doneKey)}>
            {t('export.again')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={t('export.eyebrow')} title={t('export.title')} lead={t('export.lead')} />
      <div className="grid2">
        <section className="card">
          <h2>{t('export.card.launcher')}</h2>
          <div className="card-body">
            <div className="fld">
              <span className="lbl">{t('export.launcherFile')}</span>
              <div className="pick">
                <span className="g">
                  <span>{t('export.launcherFileValue')}</span>
                  <small>{t('export.launcherFileHelp')}</small>
                </span>
              </div>
            </div>
            <div className="fld">
              <span className="lbl">{t('export.destination')}</span>
              <div className="pick">
                <span className="g">
                  <span>{t('export.destinationValue')}</span>
                  <small>{t('export.destinationHelp')}</small>
                </span>
              </div>
            </div>
            <div className="row-actions start">
              <button
                type="button"
                className="btn primary lg"
                disabled={busy || blocked || !serverReady}
                data-testid="export-button"
                onClick={() => {
                  setDismissed(null);
                  void run('export');
                }}
              >
                <DownloadIcon />
                {t('export.run')}
              </button>
            </div>
          </div>
        </section>
        <div className="stack">
          <section
            className={`card${blocked && rows.some((row) => rowStatus(row) === 'bad') ? ' badedge' : ''}`}
            data-testid="export-checks"
            data-blocked={blocked}
          >
            <h2>{t('export.card.checks')}</h2>
            <p className="sub">{t('export.checksSub')}</p>
            {rows.length === 0 && <p className="fine">{t('export.noChecks')}</p>}
            {rows.map((check) => (
              <CheckRow
                key={check.id}
                status={rowStatus(check)}
                label={labels[check.id]}
                detail={rowDetail(check)}
              >
                {!check.ok && (check.id === 'url' || check.id === 'deployment') && (
                  <button type="button" className="textlink nowrap" onClick={() => go('deploy')}>
                    {t('export.toDeploy')}
                  </button>
                )}
              </CheckRow>
            ))}
          </section>
          {!sourceReady && (
            <Note tone="warn">
              {t('export.needSource')}{' '}
              <button type="button" className="textlink" onClick={() => go('files')}>
                {t('nav.files')}
              </button>
            </Note>
          )}
          {!serverReady && (
            <Note tone="warn">
              {t('export.needServer')}{' '}
              <button type="button" className="textlink" onClick={() => go('server')}>
                {t('nav.server')}
              </button>
            </Note>
          )}
          {deploy.status === 'changed' && (
            <Note tone="warn" testId="export-stale">
              <b>{t('export.stale.title')}</b> {t('export.stale.body', { count: insights.changed })}{' '}
              <button type="button" className="textlink" onClick={() => go('deploy')}>
                {t('export.toDeploy')}
              </button>
            </Note>
          )}
        </div>
      </div>
    </>
  );
}
