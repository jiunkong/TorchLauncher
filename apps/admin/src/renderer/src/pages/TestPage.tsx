import { type RefObject, useEffect, useRef, useState } from 'react';
import type { StudioProject, StudioTestRun } from '../../../shared/studio.js';
import { PersonIcon, PlayIcon, StopIcon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/ui';
import { formatBytes, loaderLabel } from '../format';
import type { StudioController } from '../hooks/useStudio';
import { useStudioLocale } from '../i18n';
import type { PageId } from './types';

type Translator = ReturnType<typeof useStudioLocale>['t'];

const activePhases = new Set<StudioTestRun['phase']>([
  'preparing',
  'installing',
  'syncing',
  'running',
  'analyzing',
]);

export function TestPage({
  studio,
  draft,
}: {
  studio: StudioController;
  draft: StudioProject;
  go(page: PageId): void;
}) {
  const { t } = useStudioLocale();
  const [confirm, setConfirm] = useState<'stop' | 'reset' | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const run = studio.state?.testRun;
  const logCount = run?.logs.length ?? 0;
  const account = studio.state?.account;
  const active = run ? activePhases.has(run.phase) : false;
  const canStart =
    !studio.busy &&
    !!draft.serverId &&
    !!studio.state?.projectName &&
    !!account?.signedIn &&
    !!account.available &&
    !active;

  useEffect(() => {
    if (logCount === 0) return;
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logCount]);

  const send = (action: 'testLogin' | 'testLogout' | 'testStart') =>
    void (action === 'testLogout' ? studio.testCommand({ action }) : studio.command({ action }));
  const progressText = run?.progress
    ? t(`test.progress.${run.progress.component}`, {
        completed: run.progress.completed,
        total: run.progress.total ?? '—',
      })
    : null;

  return (
    <>
      <div data-testid="test-page">
        <PageHeader
          eyebrow={t('nav.group.test')}
          title={t('nav.test')}
          lead={t('test.lead')}
          actions={
            run?.phase === 'running' ? (
              <span className="pill run" data-testid="test-running-pill">
                <i />
                {t('test.running.pill')}
              </span>
            ) : undefined
          }
        />

        {!account?.available && (
          <div className="note warn" data-testid="test-account-unavailable">
            {t('test.account.unavailable')}
          </div>
        )}
        {account?.error && (
          <div className="note warn" role="status">
            {t('test.account.error')}
          </div>
        )}

        {(!run || run.phase === 'idle') && (
          <TestStart
            studio={studio}
            draft={draft}
            canStart={canStart}
            onStart={() => send('testStart')}
            onLogin={() => send('testLogin')}
            onLogout={() => send('testLogout')}
            onReset={() => setConfirm('reset')}
          />
        )}

        {run && active && (
          <section className="card test-progress" data-testid="test-progress" aria-live="polite">
            {run.phase !== 'running' && (
              <div className="test-progress-heading">
                <span className="test-spinner" aria-hidden="true" />
                <div>
                  <h2>{phaseLabel(run.phase, t)}</h2>
                  <p className="sub">{progressText ?? t('test.progress.waiting')}</p>
                </div>
                {run.progress?.total != null && run.progress.total > 0 && (
                  <progress
                    className="test-progress-bar"
                    max={run.progress.total}
                    value={Math.min(run.progress.completed, run.progress.total)}
                    aria-label={t('test.progress.label')}
                  />
                )}
              </div>
            )}
            {run.phase !== 'running' && (
              <p className="test-phase-hint">{t('test.progress.detail')}</p>
            )}
            <TestLog run={run} logRef={log} t={t} />
            <div className="test-start-actions">
              <button
                type="button"
                className="btn lg"
                data-testid="test-stop-open"
                onClick={() => setConfirm('stop')}
              >
                {run.phase === 'running' && <StopIcon />}
                {t(run.phase === 'running' ? 'test.stop' : 'test.cancel')}
              </button>
            </div>
          </section>
        )}

        {run?.phase === 'failed' && (
          <section className="card test-outcome test-outcome-error" data-testid="test-failed">
            <h2>{t('test.failed.title')}</h2>
            <p>{t('test.error.title')}</p>
            <p className="test-safe-error">{translateError(t, run.error)}</p>
            <TestLog run={run} logRef={log} t={t} />
            <div className="test-start-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!canStart}
                onClick={() => send('testStart')}
              >
                {t('common.retry')}
              </button>
            </div>
          </section>
        )}

        {run?.phase === 'analyzing' && (
          <section className="card test-progress" data-testid="test-analyzing" aria-live="polite">
            <span className="test-spinner" aria-hidden="true" /> {t('test.phase.analyzing')}
          </section>
        )}

        {run?.phase === 'done' && (
          <TestResult
            run={run}
            t={t}
            logRef={log}
            canStart={canStart}
            onStart={() => send('testStart')}
            onOpenLogs={() => void studio.command({ action: 'testOpenLogs' })}
            busy={studio.busy}
          />
        )}

        {(run?.phase === 'done' || run?.phase === 'failed') && (
          <div className="test-reset-row">
            <ResetButton busy={studio.busy} onClick={() => setConfirm('reset')} />
          </div>
        )}
      </div>

      {confirm && (
        <Modal
          titleId="test-confirm-title"
          testId={confirm === 'stop' ? 'test-stop-dialog' : 'test-reset-dialog'}
          onCancel={() => setConfirm(null)}
        >
          <h2 id="test-confirm-title">
            {t(confirm === 'stop' ? 'test.stop.title' : 'test.reset.title')}
          </h2>
          <p className="lead">{t(confirm === 'stop' ? 'test.stop.body' : 'test.reset.body')}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn ghost"
              data-autofocus
              onClick={() => setConfirm(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={confirm === 'reset' ? 'btn danger' : 'btn primary'}
              data-testid={confirm === 'reset' ? 'test-reset-confirm' : 'test-stop-confirm'}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'reset')
                  void studio.command({ action: 'testReset', confirmed: true });
                else void studio.testCommand({ action: 'testStop' });
              }}
            >
              {t(confirm === 'stop' ? 'test.stop.confirm' : 'test.reset.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function TestLog({
  run,
  logRef,
  t,
}: {
  run: StudioTestRun;
  logRef: RefObject<HTMLDivElement | null>;
  t: Translator;
}) {
  return (
    <section className="test-log-wrap" aria-label={t('test.logs.title')}>
      <div className="test-log-title">
        <h3>{t('test.logs.title')}</h3>
        <span>
          {t('test.logs.count', { count: run.logs.length })}
          {run.truncated ? ` · ${t('test.logs.truncated')}` : ''}
        </span>
      </div>
      <div className="test-log" data-testid="test-log" ref={logRef} role="log" aria-live="off">
        {run.logs.length === 0 ? (
          <span className="test-log-empty">{t('test.logs.empty')}</span>
        ) : (
          run.logs.map((entry, index) => (
            // The backend sends a bounded rolling tail; position distinguishes repeated identical lines.
            // biome-ignore lint/suspicious/noArrayIndexKey: bounded log entries have no persistent identifier.
            <div className={`test-log-line ${entry.stream}`} key={`${index}-${entry.text}`}>
              <span className="test-log-stream">{entry.stream === 'stderr' ? 'ERR' : 'OUT'}</span>
              <span>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TestResult({
  run,
  t,
  logRef,
  canStart,
  onStart,
  onOpenLogs,
  busy,
}: {
  run: StudioTestRun;
  t: Translator;
  logRef: RefObject<HTMLDivElement | null>;
  canStart: boolean;
  onStart(): void;
  onOpenLogs(): void;
  busy: boolean;
}) {
  const report = run.report;
  const errors = report?.items.filter((item) => item.severity === 'error').length ?? '—';
  const warnings = report?.items.filter((item) => item.severity === 'warning').length ?? '—';
  return (
    <section className="card test-outcome" data-testid="test-result">
      <div className="test-outcome-heading">
        <div>
          <h2>{t('test.result.problems', { errors, warnings })}</h2>
          <p className="fine">{t('test.exit.code', { code: run.exit?.code ?? '—' })}</p>
        </div>
        <div className="test-result-actions">
          <button type="button" className="btn" disabled={!canStart} onClick={onStart}>
            {t('test.result.again')}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="test-open-logs"
            disabled={busy}
            onClick={onOpenLogs}
          >
            {t('test.logs.open')}
          </button>
        </div>
      </div>
      <TestLog run={run} logRef={logRef} t={t} />
    </section>
  );
}

function translateError(t: Translator, error: string | null) {
  const keys: Record<string, Parameters<Translator>[0]> = {
    cancelled: 'test.error.cancelled',
    CANCELLED: 'test.error.CANCELLED',
    BUSY: 'test.error.BUSY',
    IO: 'test.error.IO',
    MISMATCH: 'test.error.MISMATCH',
    ENCRYPTION_UNAVAILABLE: 'test.error.ENCRYPTION_UNAVAILABLE',
    INVALID: 'test.error.INVALID',
    'test-failed': 'test.error.test-failed',
    'lock-error': 'test.error.lock-error',
  };
  return translate(t, keys[error ?? ''] ?? 'test.error.unknown');
}

function translate(t: Translator, key: string, values: Record<string, string | number> = {}) {
  return (t as unknown as (key: string, values: Record<string, string | number>) => string)(
    key,
    values,
  );
}

function phaseLabel(phase: StudioTestRun['phase'], t: Translator) {
  switch (phase) {
    case 'preparing':
      return t('test.phase.preparing');
    case 'installing':
      return t('test.phase.installing');
    case 'syncing':
      return t('test.phase.syncing');
    case 'running':
      return t('test.phase.running');
    case 'analyzing':
      return t('test.phase.analyzing');
    default:
      return t('test.phase.preparing');
  }
}

function ResetButton({ busy, onClick }: { busy: boolean; onClick(): void }) {
  const { t } = useStudioLocale();
  return (
    <button
      type="button"
      className="btn sm ghost"
      disabled={busy}
      data-testid="test-reset-open"
      onClick={onClick}
    >
      {t('test.reset.open')}
    </button>
  );
}

/** Start screen: the environment the test will use next to the test account, run button below. */
export function TestStart({
  studio,
  draft,
  canStart,
  onStart,
  onLogin,
  onLogout,
  onReset,
}: {
  studio: StudioController;
  draft: StudioProject;
  canStart: boolean;
  onStart(): void;
  onLogin(): void;
  onLogout(): void;
  onReset(): void;
}) {
  const { t } = useStudioLocale();
  const account = studio.state?.account;
  const files = studio.state?.files?.counts;
  const run = studio.state?.testRun;
  const last = run?.phase === 'failed' ? 'failed' : run?.report ? 'done' : 'none';
  const reason = !account?.signedIn
    ? t('test.start.loginRequired')
    : !studio.state?.projectName
      ? t('test.start.sourceRequired')
      : undefined;
  const rows: [string, string][] = [
    [
      t('test.env.game'),
      `Minecraft ${draft.game.minecraftVersion} · ${loaderLabel(draft.game.loader.kind)} ${draft.game.loader.version}`,
    ],
    [
      t('test.env.files'),
      files
        ? t('test.env.filesValue', { count: files.total, size: formatBytes(files.totalBytes) })
        : '—',
    ],
    [t('test.env.source'), studio.state?.projectName ?? t('test.env.sourceNone')],
    [t('test.env.last'), t(`test.env.last.${last}`)],
  ];
  return (
    <div data-testid="test-start" className="test-start">
      <div className="two">
        <section className="card" data-testid="test-env">
          <h2>{t('test.env.title')}</h2>
          {rows.map(([name, value]) => (
            <div className="kv" key={name}>
              <span>{name}</span>
              <span>{value}</span>
            </div>
          ))}
          <div className="row-actions start">
            <ResetButton busy={studio.busy} onClick={onReset} />
          </div>
        </section>
        <section className="card" data-testid="test-account-card">
          <h2>{t('test.account.title')}</h2>
          <div className="acct">
            <span className="av">
              <PersonIcon />
            </span>
            <span className="g">
              <strong data-testid="test-account">
                {account?.signedIn
                  ? (account.name ?? t('test.account.signedIn'))
                  : t('test.account.out')}
              </strong>
              <small>{t('test.account.use')}</small>
            </span>
          </div>
          <div className="row-actions start">
            {account?.signedIn ? (
              <button
                type="button"
                className="btn"
                disabled={studio.busy}
                data-testid="test-logout"
                onClick={onLogout}
              >
                {t('test.account.logout')}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={!account?.available || studio.busy}
                data-testid="test-login"
                onClick={onLogin}
              >
                {t('test.account.login')}
              </button>
            )}
          </div>
        </section>
      </div>
      <div className="test-start-actions">
        <button
          type="button"
          className="btn primary lg"
          disabled={!canStart}
          title={canStart ? undefined : reason}
          data-testid="test-start-button"
          onClick={onStart}
        >
          <PlayIcon />
          {t('test.start.run')}
        </button>
      </div>
    </div>
  );
}
