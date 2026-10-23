import { useId } from 'react';
import { CheckRow, Note, PageHeader } from '../components/ui';
import { formatBytes, formatDateTime, loaderLabel } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { validateServer, validHttps } from './validation';

export function DeployPage({ studio, draft, insights, go }: PageProps) {
  const { t, locale } = useStudioLocale();
  const { busy, state, run, edit, command } = studio;
  const { deploy, urlCheck } = insights;
  const urlId = useId();
  const sourceReady = !!state?.sourceName;
  const serverReady = Object.keys(validateServer(draft)).length === 0;
  const urlValid = validHttps(draft.sourceUrl);
  const canBuild = sourceReady && serverReady;
  const stateClass =
    deploy.status === 'upToDate' ? 'ok' : deploy.status === 'changed' ? 'warn' : undefined;
  const uiState =
    deploy.status === 'changed' ? 'stale' : deploy.status === 'upToDate' ? 'current' : 'unknown';
  const addressNote = {
    unchecked: t('deploy.address.unchecked'),
    ok: t('deploy.address.ok'),
    bad: t('deploy.address.bad'),
    stale: t('deploy.address.stale'),
  }[insights.addressState];
  const rowStatus = (value: 'ok' | 'mismatch' | 'failed' | 'unknown'): 'ok' | 'bad' | 'pending' =>
    value === 'ok' ? 'ok' : value === 'unknown' ? 'pending' : 'bad';
  const remote = urlCheck?.remoteGame;
  const remoteText = remote
    ? `${remote.minecraftVersion} · ${loaderLabel(remote.loader.kind)} ${remote.loader.version}`
    : undefined;
  const showChecks = !!urlCheck && insights.addressState !== 'stale';
  const reasons = deploy.reasons.map((reason) => t(`deploy.reason.${reason}`)).join(' · ');
  return (
    <>
      <PageHeader eyebrow={t('deploy.eyebrow')} title={t('deploy.title')} lead={t('deploy.lead')} />
      <div className="grid2">
        <div className="stack">
          <section className="card" data-testid="deploy-card" data-state={uiState}>
            <h2>{t('deploy.card.file')}</h2>
            <div className="card-body">
              <Note tone={stateClass}>
                {deploy.status === 'changed'
                  ? t('deploy.stale', {
                      added: deploy.changes.added,
                      modified: deploy.changes.modified,
                      excluded: deploy.changes.removed,
                    })
                  : deploy.status === 'upToDate'
                    ? t('deploy.current')
                    : deploy.status === 'unknown'
                      ? t('deploy.unknownSource')
                      : t('deploy.unknown')}
              </Note>
              {deploy.status === 'changed' && reasons && <p className="fine">{reasons}</p>}
              {deploy.lastBuild && (
                <div className="fi" data-testid="deploy-lastbuild">
                  <div className="mono">{deploy.lastBuild.fileName}</div>
                  <div className="fine">
                    {t('deploy.built', {
                      date: formatDateTime(new Date(deploy.lastBuild.builtAt), locale),
                      count: deploy.lastBuild.fileCount,
                      size: formatBytes(deploy.lastBuild.totalLength),
                    })}
                  </div>
                </div>
              )}
              {!sourceReady && (
                <p className="err" role="status">
                  {t('deploy.needSource')}{' '}
                  <button type="button" className="textlink" onClick={() => go('files')}>
                    {t('nav.files')}
                  </button>
                </p>
              )}
              {sourceReady && !serverReady && (
                <p className="err" role="status">
                  {t('deploy.needServer')}{' '}
                  <button type="button" className="textlink" onClick={() => go('server')}>
                    {t('nav.server')}
                  </button>
                </p>
              )}
              <div className="row-actions start">
                <button
                  type="button"
                  className={`btn${deploy.status === 'upToDate' ? ' sm' : ' primary'}`}
                  disabled={busy || !canBuild}
                  data-testid="build-button"
                  onClick={() => void run('build')}
                >
                  {deploy.status === 'upToDate' ? t('deploy.rebuild') : t('deploy.build')}
                </button>
                {deploy.lastBuild && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    onClick={() => void command({ action: 'revealPack' })}
                  >
                    {t('deploy.reveal')}
                  </button>
                )}
              </div>
            </div>
          </section>
          <section className="card">
            <h2>{t('deploy.card.upload')}</h2>
            <ol className="ol">
              <li>
                <b>1</b>
                <span>{t('deploy.upload.1')}</span>
              </li>
              <li>
                <b>2</b>
                <span>
                  {t('deploy.upload.2a')} <strong>{t('deploy.upload.2b')}</strong>
                  {t('deploy.upload.2c')}
                </span>
              </li>
              <li>
                <b>3</b>
                <span>{t('deploy.upload.3')}</span>
              </li>
            </ol>
          </section>
        </div>
        <section
          className={`card${insights.addressState === 'ok' ? ' okedge' : ''}`}
          data-testid="address-card"
          data-state={insights.addressState}
        >
          <h2>{t('deploy.card.address')}</h2>
          <p className="sub">{t('deploy.addressSub')}</p>
          <div className="fld">
            <label htmlFor={urlId} className="sr">
              {t('deploy.url')}
            </label>
            <input
              id={urlId}
              className={`inp mono${draft.sourceUrl && !urlValid ? ' bad' : ''}`}
              type="url"
              value={draft.sourceUrl}
              placeholder="https://…"
              disabled={busy}
              aria-invalid={!!draft.sourceUrl && !urlValid}
              onChange={(event) => edit({ ...draft, sourceUrl: event.target.value })}
            />
            {draft.sourceUrl && !urlValid && <span className="err">{t('deploy.urlInvalid')}</span>}
          </div>
          {showChecks && urlCheck ? (
            <div className="checks" data-testid="address-checks">
              <CheckRow status={rowStatus(urlCheck.serverId)} label={t('deploy.check.serverId')} />
              <CheckRow
                status={rowStatus(urlCheck.game)}
                label={t('deploy.check.game')}
                detail={urlCheck.game === 'mismatch' ? remoteText : undefined}
              />
              <CheckRow
                status={rowStatus(urlCheck.fileList.state)}
                label={t('deploy.check.files')}
                detail={
                  urlCheck.fileList.count !== null
                    ? t('deploy.check.count', { count: urlCheck.fileList.count })
                    : undefined
                }
              />
              <CheckRow status={rowStatus(urlCheck.range)} label={t('deploy.check.range')} />
              <CheckRow
                status={
                  urlCheck.deployment === 'current'
                    ? 'ok'
                    : urlCheck.deployment === 'older'
                      ? 'bad'
                      : 'pending'
                }
                label={t('deploy.check.deployment')}
                detail={urlCheck.deployment === 'older' ? t('deploy.check.older') : undefined}
              />
            </div>
          ) : (
            <Note tone={insights.addressState === 'stale' ? 'warn' : undefined}>{addressNote}</Note>
          )}
          {showChecks && insights.addressState === 'bad' && (
            <Note tone="warn">{t('deploy.address.bad')}</Note>
          )}
          <div className="row-actions start">
            <button
              type="button"
              className="btn"
              disabled={busy || !urlValid || !serverReady}
              onClick={() => void run('check')}
            >
              {urlCheck ? t('deploy.recheck') : t('deploy.check')}
            </button>
          </div>
          <p className="fine">{t('deploy.checkHelp')}</p>
        </section>
      </div>
    </>
  );
}
