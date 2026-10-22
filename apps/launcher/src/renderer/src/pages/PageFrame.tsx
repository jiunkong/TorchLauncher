import type { ReactNode } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';
import { type ActivityStage, stageOf } from '../activity';
import type { PageId } from '../components/Menu';
import { ProgressBar } from '../components/ProgressBar';
import { operationControl } from '../flow';
import { useT } from '../hooks/useTranslator';
import { failureMessage, operationLabel, outcomeLabel, stageNowLabel } from '../labels';

export interface FrameProps {
  state: ProductState | null;
  stage: ActivityStage | null;
  productError: string | null;
  command(request: ProductCommand): Promise<boolean>;
  onNavigate(page: PageId): void;
  onStop(): void;
}

/** Page chrome shared by mods, settings, and logs: header, running-operation bar, errors, footer. */
export function PageFrame({
  testId,
  hidden,
  title,
  subtitle,
  actions,
  state,
  stage,
  productError,
  command,
  onNavigate,
  onStop,
  showOutcome = false,
  footer,
  children,
}: {
  testId: string;
  hidden: boolean;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  state: ProductState | null;
  stage: ActivityStage | null;
  productError: string | null;
  command(request: ProductCommand): Promise<boolean>;
  onNavigate(page: PageId): void;
  onStop(): void;
  showOutcome?: boolean;
  footer: string | null;
  children: ReactNode;
}) {
  const t = useT();
  // Short page actions (mods, packs, usage) finish quickly; only the launch flow gets a status strip.
  const control =
    state && (state.running || state.operation === 'launch') ? operationControl(state) : null;
  const error = productError ?? state?.error ?? null;
  const label = state
    ? state.running
      ? operationLabel(t, 'launch', 'game-running')
      : state.activity
        ? stageNowLabel(t, stage ?? stageOf(state.activity))
        : operationLabel(t, state.operation ?? 'launch', state.phase)
    : '';
  return (
    <div className="page-col" hidden={hidden} data-testid={testId}>
      <div className="main">
        <header className="page-head">
          <div className="page-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {actions}
        </header>
        {state && control && (
          <div className="operation-status" role="status" aria-live="polite">
            <strong>{label}</strong>
            {!state.running && (
              <ProgressBar
                measured={state.progress && state.progress.total > 0 ? state.progress : null}
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
          <div className="error selectable" role="alert">
            <p>{t('error.result', { message: failureMessage(t, error) })}</p>
            {(error === 'no_session' || error === 'reauthentication_required') && (
              <button className="btn sm" type="button" onClick={() => onNavigate('home')}>
                {t('error.loginHome')}
              </button>
            )}
            {error === 'recovery-required' && (
              <button className="btn sm" type="button" onClick={() => onNavigate('home')}>
                {t('recovery.review')}
              </button>
            )}
            {(error === 'network_failed' ||
              error === 'timeout' ||
              error === 'operation-failed') && (
              <button
                className="btn sm"
                type="button"
                onClick={() => onNavigate('troubleshooting')}
              >
                {t('home.viewLogs')}
              </button>
            )}
          </div>
        )}
        {showOutcome && state?.outcome && (
          <p className="hintline" role="status">
            {t('home.recentResult', { outcome: outcomeLabel(t, state.outcome) })}
          </p>
        )}
        {state ? children : <p role="status">{t('shell.connecting')}</p>}
      </div>
      {footer !== null && (
        <div className="foot">
          <span>TorchLauncher</span>
          <span>{footer}</span>
        </div>
      )}
    </div>
  );
}
