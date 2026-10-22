import type { ProductState } from '../../../shared/product';
import { type ActivityStage, stageChips, stageMeasure } from '../activity';
import { BrandingVisual } from '../components/BrandingVisual';
import { MicrosoftIcon, PlayFilledIcon, RetryIcon, StopIcon } from '../components/Icons';
import { ProgressBar } from '../components/ProgressBar';
import { elapsedParts, gameParts, homeView } from '../home';
import { useT } from '../hooks/useTranslator';
import {
  failureMessage,
  operationLabel,
  recoveryIssueText,
  stageLabel,
  stageNowLabel,
} from '../labels';

/** The product state carries no game/loader description yet, so the supported target is fixed. */
export const homeGameVersion = '1.21.1';
export interface HomeProps {
  state: ProductState;
  brandingBackground?: string | null;
  productError: string | null;
  pending: boolean;
  elapsedMs: number;
  /** Furthest installation stage reached in the current operation (never moves backwards). */
  stage: ActivityStage | null;
  applicationVersion: string | null;
  applicationInfoFailed: boolean;
  onPrimary(): void;
  onCancel(): void;
  onStop(): void;
  onViewLogs(): void;
  onReviewRecovery(): void;
}

export function Home(props: HomeProps) {
  const t = useT();
  const { state } = props;
  const game = gameParts(state);
  const view = homeView(state, props.productError, props.pending);
  const formatElapsed = (ms: number) => {
    const { h, m, s } = elapsedParts(ms);
    if (h > 0) return t('time.hours', { h, m });
    if (m > 0) return t('time.minutes', { m, s });
    return t('time.seconds', { s });
  };

  const status = (() => {
    if (view.kind === 'running')
      return {
        dot: 'run',
        text: t('home.status.running', { elapsed: formatElapsed(props.elapsedMs) }),
      };
    const info = state.status;
    if (info.state === 'online')
      return {
        dot: 'ok',
        text:
          info.latencyMs === undefined
            ? t('home.status.online', { online: info.online ?? 0 })
            : t('home.status.onlineLatency', {
                online: info.online ?? 0,
                latency: info.latencyMs,
              }),
      };
    if (info.state === 'unavailable') return { dot: 'warn', text: t('home.status.unavailable') };
    return {
      dot: '',
      text: state.operation === 'status' ? t('home.status.checking') : t('home.status.unknown'),
    };
  })();

  const activity = state.activity;
  const stage = activity ? props.stage : null;
  const measure = stage ? stageMeasure(stage, activity) : null;
  const busyLabel = stage
    ? stageNowLabel(t, stage)
    : operationLabel(t, state.operation ?? 'launch', state.phase);
  const known = state.progress && state.progress.total > 0 ? state.progress : null;
  const measured =
    measure?.kind === 'ratio'
      ? { completed: measure.completed, total: measure.total }
      : activity
        ? null
        : known;
  const countText =
    measure?.kind === 'ratio'
      ? t('progress.count', { completed: measure.completed, total: measure.total })
      : measure?.kind === 'completed'
        ? t('progress.done', { completed: measure.completed })
        : null;
  const recovery = state.recovery;
  const recoveryError = view.error === 'recovery-required';
  const recoveryReview = recoveryError && recovery?.needed === true && recovery.confirmable;
  const primaryLabel =
    view.primary?.type === 'login'
      ? t('home.login')
      : view.kind === 'error'
        ? t('home.retry')
        : t('home.play');
  const warnTitle =
    view.kind === 'unconfigured'
      ? t('home.configTitle')
      : view.kind === 'unsupported'
        ? t('home.unsupportedTitle')
        : t('home.errorTitle');
  const warnText =
    view.kind === 'unconfigured'
      ? failureMessage(t, 'configuration-unavailable')
      : view.kind === 'unsupported'
        ? failureMessage(t, 'unsupported-platform')
        : recoveryError
          ? recovery?.needed && !recovery.confirmable
            ? recoveryIssueText(t, recovery.issues)
            : t('recovery.panel')
          : failureMessage(t, view.error ?? 'operation-failed');

  return (
    <section
      className="stage-home"
      aria-label={t('home.region')}
      data-testid="home"
      data-kind={view.kind}
    >
      <BrandingVisual kind="background" value={props.brandingBackground ?? null} />
      <div className="shade" />
      <div className="copy">
        <span className="status" data-testid="server-status">
          <span className={`dot ${status.dot}`.trim()} aria-hidden="true" />
          {status.text}
        </span>
        <h1>{state.server?.name ?? t('home.noServer')}</h1>
        <span className="meta2" data-testid="game-version">
          {[t('home.game', { version: game.minecraft ?? homeGameVersion }), game.loader]
            .filter(Boolean)
            .join(' · ')}
        </span>

        {view.kind === 'busy' && (
          <div className="panel" role="status" aria-live="polite">
            <div className="top">
              <strong>{busyLabel}</strong>
              {countText && <span data-testid="progress-count">{countText}</span>}
            </div>
            <ProgressBar
              measured={measured}
              unknownLabel={t('home.progressUnknown')}
              label={busyLabel}
            />
            {activity && (
              <ul className="cs" aria-label={t('steps.label')} data-testid="stage-chips">
                {stageChips(stage).map((chip) => (
                  <li key={chip.id} className={chip.state === 'todo' ? '' : chip.state}>
                    {stageLabel(t, chip.id)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(view.kind === 'error' || view.kind === 'unconfigured' || view.kind === 'unsupported') && (
          <div className="panel warn selectable" role="alert">
            <div className="top">
              <strong>{warnTitle}</strong>
            </div>
            <p>{warnText}</p>
            {view.kind === 'error' && (
              <div className="panel-links">
                {recoveryReview && (
                  <button
                    className="hintline linklike"
                    type="button"
                    data-testid="review-recovery"
                    onClick={props.onReviewRecovery}
                  >
                    {t('recovery.review')}
                  </button>
                )}
                <button className="hintline linklike" type="button" onClick={props.onViewLogs}>
                  {t('home.viewLogs')}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="actions">
          {view.kind === 'running' ? (
            <button
              className="btn stop lg"
              type="button"
              data-testid="stop-button"
              onClick={props.onStop}
            >
              <StopIcon />
              {t('home.stop')}
            </button>
          ) : view.kind === 'busy' ? (
            <>
              <span className="btn primary lg busy" role="status" data-testid="launch-button">
                <span className="spin" aria-hidden="true" />
                {state.operation === 'launch' ? t('home.installing') : busyLabel}
              </span>
              <button
                className="btn ghost"
                type="button"
                data-testid="cancel-button"
                onClick={props.onCancel}
              >
                {t('home.cancel')}
              </button>
            </>
          ) : (
            <button
              className="btn primary lg"
              type="button"
              data-testid="launch-button"
              disabled={view.disabled}
              onClick={props.onPrimary}
            >
              {view.primary?.type === 'login' ? (
                <MicrosoftIcon />
              ) : view.kind === 'error' ? (
                <RetryIcon />
              ) : (
                <PlayFilledIcon />
              )}
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
      {props.applicationInfoFailed ? (
        <span className="ver error" role="alert">
          {t('shell.appInfoFailed')}
        </span>
      ) : (
        <span className="ver" data-testid="application-info">
          {props.applicationVersion
            ? `TorchLauncher ${props.applicationVersion}`
            : t('shell.appInfoLoading')}
        </span>
      )}
    </section>
  );
}
