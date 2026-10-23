import { useState } from 'react';
import { CheckIcon, DownloadIcon, FileIcon, FolderIcon } from '../components/Icons';
import { CheckRow, Note, PageHeader } from '../components/ui';
import { formatDateTime, loaderLabel } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { validateServer, validHttps } from './validation';

export function ExportPage({ studio, draft, insights, go }: PageProps) {
  const { t, locale } = useStudioLocale();
  const { busy, run, state } = studio;
  const { address, deploy, exported } = insights;
  const [dismissed, setDismissed] = useState<number | null>(null);
  const serverReady = Object.keys(validateServer(draft)).length === 0;
  const urlValid = validHttps(draft.sourceUrl);
  const game = `${draft.game.minecraftVersion} · ${loaderLabel(draft.game.loader.kind)} ${draft.game.loader.version}`;
  const identity = address.checks[0]?.status ?? 'pending';
  const gameStatus = address.checks[1]?.status ?? 'pending';
  const addressRow = {
    unchecked: { text: t('export.address.unchecked'), detail: t('export.address.uncheckedHelp') },
    ok: {
      text: t('export.address.ok'),
      detail: address.checkedAt
        ? t('export.address.checkedAt', { date: formatDateTime(address.checkedAt, locale) })
        : undefined,
    },
    bad: { text: t('export.address.bad'), detail: t('export.address.badHelp') },
    stale: { text: t('export.address.stale'), detail: t('export.address.staleHelp') },
  }[address.state];
  const addressStatus = address.state === 'ok' ? 'ok' : address.state === 'bad' ? 'bad' : 'pending';
  const ready = address.state === 'ok' && serverReady && urlValid;
  const blocked = !ready;

  if (exported && dismissed !== exported.at.getTime()) {
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
            disabled
            title={t('export.openUnavailable')}
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
                {state?.result ?? t('export.done.fallback')}
              </span>
              <small>{t('export.done.at', { date: formatDateTime(exported.at, locale) })}</small>
            </span>
          </div>
        </section>
        <Note>{t('export.done.note')}</Note>
        <div className="row-actions start">
          <button type="button" className="btn" onClick={() => setDismissed(exported.at.getTime())}>
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
                disabled={busy || blocked}
                data-testid="export-button"
                onClick={() => void run('export')}
              >
                <DownloadIcon />
                {t('export.run')}
              </button>
            </div>
          </div>
        </section>
        <div className="stack">
          <section
            className={`card${blocked && address.state !== 'unchecked' ? ' badedge' : ''}`}
            data-testid="export-checks"
            data-blocked={blocked}
          >
            <h2>{t('export.card.checks')}</h2>
            <p className="sub">{t('export.checksSub')}</p>
            <CheckRow
              status={identity}
              label={identity === 'bad' ? t('export.serverId.bad') : t('export.serverId')}
              detail={
                identity === 'ok'
                  ? t('export.serverId.ok')
                  : identity === 'bad'
                    ? t('export.serverId.badHelp')
                    : undefined
              }
            />
            <CheckRow
              status={gameStatus}
              label={gameStatus === 'bad' ? t('export.game.bad') : t('export.game')}
              detail={
                gameStatus === 'ok'
                  ? game
                  : gameStatus === 'bad'
                    ? t('export.game.badHelp', { game })
                    : undefined
              }
            />
            <CheckRow status={addressStatus} label={addressRow.text} detail={addressRow.detail}>
              {address.state !== 'ok' && (
                <button type="button" className="textlink nowrap" onClick={() => go('deploy')}>
                  {t('export.toCheck')}
                </button>
              )}
            </CheckRow>
          </section>
          {!serverReady && (
            <Note tone="warn">
              {t('export.needServer')}{' '}
              <button type="button" className="textlink" onClick={() => go('server')}>
                {t('nav.server')}
              </button>
            </Note>
          )}
          {deploy.state === 'stale' && (
            <Note tone="warn" testId="export-stale">
              <b>{t('export.stale.title')}</b>{' '}
              {t('export.stale.body', {
                count: deploy.changes.added + deploy.changes.modified + deploy.changes.excluded,
              })}{' '}
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
