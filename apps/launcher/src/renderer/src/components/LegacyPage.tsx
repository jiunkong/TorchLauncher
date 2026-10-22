import type { ProductCommand, ProductState } from '../../../shared/product';
import { activityLabel, activityProgress } from '../activity';
import { operationControl } from '../flow';
import { useT } from '../hooks/useTranslator';
import { failureMessage, operationLabel, outcomeLabel } from '../labels';
import { PageContent } from '../pages/Pages';
import { ActivityProgressBar } from './ActivityProgressBar';
import type { PageId } from './Menu';

const titleKeys = {
  mods: 'menu.mods',
  settings: 'menu.settings',
  troubleshooting: 'menu.logs',
} as const;

/** Shell for the pre-redesign pages (L2 replaces them): token styling, same behavior. */
export function LegacyPage({
  page,
  state,
  productError,
  pending,
  command,
  hidden,
  onNavigate,
  onStop,
}: {
  page: Exclude<PageId, 'home'>;
  state: ProductState | null;
  productError: string | null;
  pending: boolean;
  command(request: ProductCommand): Promise<boolean>;
  hidden: boolean;
  onNavigate(page: PageId): void;
  onStop(): void;
}) {
  const t = useT();
  const control = state ? operationControl(state) : null;
  const error = productError ?? state?.error ?? null;
  return (
    <div className="page-scroll" hidden={hidden} data-testid={`page-${page}`}>
      <h1 className="page-title">{t(titleKeys[page])}</h1>
      {state && control && (
        <div className="operation-status" role="status" aria-live="polite">
          <strong>
            {state.running
              ? operationLabel('launch', 'game-running')
              : state.activity
                ? activityLabel(state.activity)
                : operationLabel(state.operation ?? 'launch', state.phase)}
          </strong>
          {state.activity && <span>{activityProgress(state.activity)}</span>}
          {!state.running && (
            <ActivityProgressBar
              activity={state.activity}
              progress={state.progress && state.progress.total > 0 ? state.progress : null}
              unknownLabel={t('home.progressUnknown')}
            />
          )}
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              if (control === 'stop') onStop();
              else void command({ type: 'cancel' });
            }}
          >
            {control === 'stop' ? t('home.stop') : t('operation.cancel')}
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <p>{t('error.result', { message: failureMessage(error) })}</p>
          {(error === 'no_session' || error === 'reauthentication_required') && (
            <button className="btn sm" type="button" onClick={() => onNavigate('home')}>
              {t('error.loginHome')}
            </button>
          )}
          {(error === 'recovery-required' ||
            error === 'network_failed' ||
            error === 'timeout' ||
            error === 'operation-failed') && (
            <button className="btn sm" type="button" onClick={() => onNavigate('troubleshooting')}>
              {t('home.viewLogs')}
            </button>
          )}
        </div>
      )}
      {state?.outcome && (
        <p role="status">{t('home.recentResult', { outcome: outcomeLabel(state.outcome) })}</p>
      )}
      {state ? (
        <PageContent page={page} state={state} pending={pending} command={command} />
      ) : (
        <p role="status">{t('shell.connecting')}</p>
      )}
    </div>
  );
}
