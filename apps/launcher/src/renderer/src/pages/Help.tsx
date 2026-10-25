import type { UpdateCommand, UpdateState } from '../../../shared/updates';
import { formatBytes } from '../format';
import { useT } from '../hooks/useTranslator';
import { useUpdates } from '../hooks/useUpdates';
import type { Translate } from '../i18n/translate';

export function updateStatus(t: Translate, state: UpdateState | null): string {
  if (!state) return t('common.loading');
  switch (state.phase) {
    case 'available':
      return t('help.available', { version: state.version });
    case 'downloaded':
      return t('help.downloaded', { version: state.version });
    case 'downloading':
      return t('help.downloading', { size: formatBytes(state.received) });
    case 'error':
      if (state.code === 'LAUNCHER_NO_RELEASE') return t('help.noRelease');
      if (state.code === 'LAUNCHER_OFFLINE') return t('help.offline');
      if (
        state.code === 'LAUNCHER_VERIFY' ||
        state.code === 'INVALID' ||
        state.code === 'TOO_LARGE'
      )
        return t('help.verifyFailed');
      if (state.code === 'UNSUPPORTED_TARGET') return t('help.unsupported');
      return t('help.failed');
    case 'idle':
      return t('help.idle');
    case 'checking':
      return t('help.checking');
    case 'current':
      return t('help.current');
    case 'cancelled':
      return t('help.cancelled');
  }
}
export function HelpView({
  hidden,
  version,
  state,
  pending,
  command,
}: {
  hidden: boolean;
  version: string | null;
  state: UpdateState | null;
  pending: boolean;
  command(request: UpdateCommand): Promise<void>;
}) {
  const t = useT();
  const busy = pending || !state || state.phase === 'checking' || state.phase === 'downloading';
  const unsupported = state?.phase === 'error' && state.code === 'UNSUPPORTED_TARGET';
  return (
    <div className="page-col" hidden={hidden} data-testid="page-help">
      <div className="main">
        <header className="page-head">
          <div className="page-title">
            <h1>{t('menu.help')}</h1>
            <p>{t('help.subtitle')}</p>
          </div>
        </header>
        <section className="card update-card" aria-label={t('help.launcher')}>
          <h2>{t('help.launcher')}</h2>
          <p className="hint">
            {t('help.version', { version: version ?? t('help.versionUnknown') })}
          </p>
          <div className="update-actions">
            <button
              className="btn"
              type="button"
              data-testid="update-check"
              disabled={busy || unsupported}
              onClick={() => void command({ action: 'check' })}
            >
              {t('help.check')}
            </button>
            <button
              className="btn primary"
              type="button"
              data-testid="update-download"
              disabled={busy || state?.phase !== 'available'}
              onClick={() => void command({ action: 'download' })}
            >
              {t('help.update')}
            </button>
          </div>
          <p className="update-status" role="status" aria-live="polite" data-testid="update-status">
            {updateStatus(t, state)}
          </p>
        </section>
      </div>
    </div>
  );
}
export function HelpPage({ hidden, version }: { hidden: boolean; version: string | null }) {
  const updates = useUpdates();
  return <HelpView hidden={hidden} version={version} {...updates} />;
}
