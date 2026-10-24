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
  go,
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
  const report = run?.report;
  const canStart =
    !studio.busy &&
    !!draft.serverId &&
    !!studio.state?.sourceName &&
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

        {run?.phase === 'done' && report && (
          <TestResult
            run={run}
            go={go}
            t={t}
            logRef={log}
            canStart={canStart}
            onStart={() => send('testStart')}
          />
        )}

        {(run?.phase === 'done' || run?.phase === 'failed') && (
          <div className="test-reset-row">
            <ResetButton busy={studio.busy} onClick={() => setConfirm('reset')} />
          </div>
        )}

        {run?.phase === 'done' && !report && (
          <section className="card test-outcome" data-testid="test-result-unavailable">
            <h2>{t('test.result.unavailable')}</h2>
            <p>{t('test.result.unavailableHelp')}</p>
            <TestLog run={run} logRef={log} t={t} />
            <div className="test-start-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!canStart}
                onClick={() => send('testStart')}
              >
                {t('test.result.again')}
              </button>
            </div>
          </section>
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
  go,
  t,
  logRef,
  canStart,
  onStart,
}: {
  run: StudioTestRun;
  go(page: PageId): void;
  t: Translator;
  logRef: RefObject<HTMLDivElement | null>;
  canStart: boolean;
  onStart(): void;
}) {
  const report = run.report;
  if (!report) return null;
  const errors = report.items.filter((item) => item.severity === 'error').length;
  const warnings = report.items.filter((item) => item.severity === 'warning').length;
  const mods = run.mods.flatMap((file) => file.mods.map((mod) => ({ ...mod, file: file.file })));
  const affectedMods = new Map<string, 'error' | 'warning'>();
  for (const item of report.items) {
    if (item.severity === 'info') continue;
    for (const id of item.modIds ?? []) {
      if (item.severity === 'error' || affectedMods.get(id) !== 'error')
        affectedMods.set(id, item.severity);
    }
  }
  const title =
    report.status === 'problems'
      ? t('test.result.problems', { errors, warnings })
      : report.status === 'incomplete'
        ? t('test.result.incomplete')
        : t('test.result.ok');
  return (
    <>
      <section
        className={`card test-outcome ${report.status === 'problems' ? 'test-outcome-error' : report.status === 'no-problems-found' ? 'test-outcome-ok' : ''}`}
        data-testid="test-result"
      >
        <div className="test-outcome-heading">
          <div>
            <span className="eyebrow">{t('test.result.eyebrow')}</span>
            <h2>{title}</h2>
            {report.status === 'no-problems-found' && <p>{t('test.result.okHelp')}</p>}
            {report.status === 'incomplete' && <p>{t('test.result.incompleteHelp')}</p>}
            {run.exit && (
              <p className="fine">
                {t(`test.exit.${run.exit.reason}`)}
                {run.exit.code == null ? '' : ` · ${t('test.exit.code', { code: run.exit.code })}`}
              </p>
            )}
          </div>
          <div className="test-result-actions">
            <button type="button" className="btn" disabled={!canStart} onClick={onStart}>
              {t('test.result.again')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!run.extracted}
              onClick={() => go('playerSettings')}
            >
              {t('test.result.settings')}
            </button>
          </div>
        </div>
        {report.truncated && <div className="note warn">{t('test.result.truncated')}</div>}
        <div className="test-result-grid">
          <div className="test-findings" data-testid="test-findings">
            {report.items.length === 0 ? (
              <div className="card test-no-findings">{t('test.result.noFindings')}</div>
            ) : (
              report.items.map((item) => (
                <article
                  className={`test-finding ${item.severity}`}
                  key={`${item.summary.code}-${item.evidence.map((entry) => `${entry.source}-${entry.line}-${entry.text}`).join('|')}`}
                >
                  <div className="test-finding-heading">
                    <span className={`test-severity ${item.severity}`}>
                      {translate(t, `test.severity.${item.severity}`)}
                    </span>
                    <strong>
                      {translate(
                        t,
                        summaryKeys[item.summary.code] ?? 'test.summary.unknown-error',
                        item.summary.parameters,
                      )}
                    </strong>
                  </div>
                  <p>
                    {translate(t, `test.category.${item.category}`)}
                    {item.modIds?.length ? ` · ${item.modIds.join(', ')}` : ''}
                    {item.files?.length ? ` · ${item.files.join(', ')}` : ''}
                  </p>
                  {item.evidence.length > 0 && (
                    <div className="test-evidence">
                      {item.evidence.map((evidence) => (
                        <div key={`${evidence.source}-${evidence.line}-${evidence.text}`}>
                          <span>{t('test.evidence.line', { line: evidence.line })}</span>
                          <code>{evidence.text}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
          <aside className="card test-mods-card" data-testid="test-mods">
            <h3>{t('test.mods.title', { count: mods.length })}</h3>
            {mods.length === 0 ? (
              <p className="sub">{t('test.mods.empty')}</p>
            ) : (
              <ul className="test-mod-list">
                {mods.slice(0, 100).map((mod) => (
                  <li key={`${mod.file}-${mod.id}-${mod.version}`}>
                    <span
                      className={`test-mod-dot ${affectedMods.get(mod.id) ?? 'ok'}`}
                      aria-hidden="true"
                    />
                    <span className="test-mod-id">{mod.id}</span>
                    <span className="test-mod-version">{mod.version}</span>
                  </li>
                ))}
              </ul>
            )}
            {run.metadataErrors.length > 0 && (
              <p className="fine">
                {t('test.mods.metadataErrors', { count: run.metadataErrors.length })}
              </p>
            )}
            {run.extracted && (
              <div className="test-extracted" data-testid="test-extracted">
                <h3>{t('test.extracted.title')}</h3>
                <div className="test-extracted-row">
                  <span>{t('test.extracted.keybinds')}</span>
                  <strong>{run.extracted.keybindCount}</strong>
                </div>
                <div className="test-extracted-row">
                  <span>{t('test.extracted.options')}</span>
                  <strong>{run.extracted.otherOptionCount}</strong>
                </div>
                <div className="test-extracted-row">
                  <span>{t('test.extracted.configs')}</span>
                  <strong>{run.extracted.newConfigCount}</strong>
                </div>
                {run.extractionError && <p className="fine">{t('test.extracted.unavailable')}</p>}
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!run.extracted}
                  onClick={() => go('playerSettings')}
                >
                  {t('test.extracted.import')}
                </button>
              </div>
            )}
          </aside>
        </div>
        <TestLog run={run} logRef={logRef} t={t} />
      </section>
      {run.configFiles && run.configFiles.length > 0 && (
        <section className="card test-config-summary">
          <h2>{t('test.config.title', { count: run.configFiles.length })}</h2>
          <p>{t('test.config.help')}</p>
          <button type="button" className="btn ghost" onClick={() => go('mods')}>
            {t('test.config.open')}
          </button>
        </section>
      )}
    </>
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

const summaryKeys: Record<string, Parameters<Translator>[0]> = {
  'loader-resolution-failed': 'test.summary.loader-resolution-failed',
  'dependency-mismatch': 'test.summary.dependency-mismatch',
  'environment-mismatch': 'test.summary.environment-mismatch',
  'duplicate-mod': 'test.summary.duplicate-mod',
  'mixin-failed': 'test.summary.mixin-failed',
  'class-loading-failed': 'test.summary.class-loading-failed',
  'out-of-memory': 'test.summary.out-of-memory',
  'java-version-mismatch': 'test.summary.java-version-mismatch',
  'game-crashed': 'test.summary.game-crashed',
  'unknown-error': 'test.summary.unknown-error',
  'crash-report-present': 'test.summary.crash-report-present',
  'abnormal-exit': 'test.summary.abnormal-exit',
};

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
    : !studio.state?.sourceName
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
    [t('test.env.source'), studio.state?.sourceName ?? t('test.env.sourceNone')],
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
