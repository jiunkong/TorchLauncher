import { useId } from 'react';
import { CheckRow, Note, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { validateServer, validHttps } from './validation';

export function DeployPage({ studio, draft, insights, go }: PageProps) {
  const { t, locale } = useStudioLocale();
  const { busy, state, run, edit } = studio;
  const { deploy, address } = insights;
  const urlId = useId();
  const sourceReady = !!state?.sourceName;
  const serverReady = Object.keys(validateServer(draft)).length === 0;
  const urlValid = validHttps(draft.sourceUrl);
  const canBuild = sourceReady && serverReady;
  const stateClass =
    deploy.state === 'current' ? 'ok' : deploy.state === 'stale' ? 'warn' : undefined;
  const addressNote = {
    unchecked: t('deploy.address.unchecked'),
    ok: t('deploy.address.ok'),
    bad: t('deploy.address.bad'),
    stale: t('deploy.address.stale'),
  }[address.state];
  const checkLabel = {
    serverId: t('deploy.check.serverId'),
    game: t('deploy.check.game'),
    files: t('deploy.check.files'),
    range: t('deploy.check.range'),
  } as const;
  const showChecks = address.state === 'ok' || address.state === 'bad';
  return (
    <>
      <PageHeader eyebrow={t('deploy.eyebrow')} title={t('deploy.title')} lead={t('deploy.lead')} />
      <div className="grid2">
        <div className="stack">
          <section className="card" data-testid="deploy-card" data-state={deploy.state}>
            <h2>{t('deploy.card.file')}</h2>
            <div className="card-body">
              <Note tone={stateClass}>
                {deploy.state === 'stale'
                  ? t('deploy.stale', {
                      added: deploy.changes.added,
                      modified: deploy.changes.modified,
                      excluded: deploy.changes.excluded,
                    })
                  : deploy.state === 'current'
                    ? t('deploy.current')
                    : t('deploy.unknown')}
              </Note>
              {deploy.builtAt && deploy.fileCount !== null && (
                <div className="fi">
                  <div className="mono">*.torchpack</div>
                  <div className="fine">
                    {t('deploy.built', {
                      date: formatDateTime(deploy.builtAt, locale),
                      count: deploy.fileCount,
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
                  className={`btn${deploy.state === 'current' ? ' sm' : ' primary'}`}
                  disabled={busy || !canBuild}
                  onClick={() => void run('build')}
                >
                  {deploy.state === 'current' ? t('deploy.rebuild') : t('deploy.build')}
                </button>
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
          className={`card${address.state === 'ok' ? ' okedge' : ''}`}
          data-testid="address-card"
          data-state={address.state}
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
          {showChecks ? (
            <div className="checks" data-testid="address-checks">
              {address.checks.map((check) => (
                <CheckRow key={check.id} status={check.status} label={checkLabel[check.id]} />
              ))}
            </div>
          ) : (
            <Note>{addressNote}</Note>
          )}
          {showChecks && address.state === 'bad' && (
            <Note tone="warn">{t('deploy.address.bad')}</Note>
          )}
          <div className="row-actions start">
            <button
              type="button"
              className="btn"
              disabled={busy || !urlValid || !serverReady}
              onClick={() => void run('check')}
            >
              {showChecks ? t('deploy.recheck') : t('deploy.check')}
            </button>
          </div>
          <p className="fine">{t('deploy.checkHelp')}</p>
        </section>
      </div>
    </>
  );
}
