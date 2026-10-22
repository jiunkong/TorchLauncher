import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProductCommand, ProductLogEntry, ProductState } from '../../../shared/product';
import { useT } from '../hooks/useTranslator';
import { type FrameProps, PageFrame } from './PageFrame';

export type LogFilter = 'all' | 'launcher' | 'game';
const filters = [
  { id: 'all', key: 'logs.all' },
  { id: 'launcher', key: 'logs.launcher' },
  { id: 'game', key: 'logs.game' },
] as const;

/** `logs` is launcher lines followed by game lines; filtering keeps each group's order. */
export function filterLogs(logs: readonly ProductLogEntry[], filter: LogFilter): string[] {
  return logs
    .filter((entry) => filter === 'all' || entry.source === filter)
    .map((entry) => entry.text);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LogsPage({
  frame,
  hidden,
  state,
  command,
}: {
  frame: FrameProps;
  hidden: boolean;
  state: ProductState | null;
  command?(request: ProductCommand): Promise<boolean>;
}) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [copyResult, setCopyResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const lines = filterLogs(state?.logs ?? [], filter);
  const copy = () => {
    void copyText(lines.join('\n')).then((ok) => setCopyResult(ok ? 'copied' : 'failed'));
  };
  useEffect(() => {
    if (copyResult !== 'copied') return;
    const timer = setTimeout(() => setCopyResult('idle'), 3000);
    return () => clearTimeout(timer);
  }, [copyResult]);
  const select = (next: LogFilter) => {
    pinned.current = true;
    setFilter(next);
    setCopyResult('idle');
  };
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Follow new lines only while the reader is at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when lines or the filter change
  useLayoutEffect(() => {
    const node = box.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [lines.length, filter]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = filters.findIndex((item) => item.id === filter);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + filters.length) % filters.length;
    const target = filters[next];
    if (target) {
      select(target.id);
      tabs.current[next]?.focus();
    }
  };
  return (
    <PageFrame
      {...frame}
      testId="page-troubleshooting"
      hidden={hidden}
      title={t('menu.logs')}
      subtitle={t('logs.subtitle')}
      footer={null}
      actions={
        <div className="head-actions">
          {openFailed && <span role="alert">{t('logs.openFailed')}</span>}
          <button
            className="btn sm"
            type="button"
            data-testid="open-logs"
            disabled={!command || state?.configuration !== 'ready' || opening}
            onClick={() => {
              if (!command) return;
              setOpening(true);
              setOpenFailed(false);
              void command({ type: 'open-logs' })
                .then((ok) => setOpenFailed(!ok))
                .finally(() => setOpening(false));
            }}
          >
            {t('logs.openFolder')}
          </button>
          {copyResult !== 'idle' && (
            <span
              className={copyResult === 'failed' ? 'copy-note failed' : 'copy-note'}
              role={copyResult === 'failed' ? 'alert' : 'status'}
            >
              {copyResult === 'failed' ? t('logs.copyFailed') : t('logs.copied')}
            </span>
          )}
          <button
            className="btn sm"
            type="button"
            data-testid="copy-logs"
            disabled={lines.length === 0}
            onClick={copy}
          >
            {t('logs.copy')}
          </button>
        </div>
      }
    >
      <div className="tabs" role="tablist" aria-label={t('logs.tabs')} onKeyDown={onKeyDown}>
        {filters.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            className={`tab${filter === item.id ? ' on' : ''}`}
            type="button"
            role="tab"
            id={`log-tab-${item.id}`}
            aria-selected={filter === item.id}
            aria-controls="log-panel"
            tabIndex={filter === item.id ? 0 : -1}
            onClick={() => select(item.id)}
          >
            {t(item.key)}
          </button>
        ))}
      </div>
      <div
        ref={box}
        id="log-panel"
        className="log mono game-log"
        role="tabpanel"
        aria-labelledby={`log-tab-${filter}`}
        aria-label={t('logs.region')}
        data-testid="log-view"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable
        tabIndex={0}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {lines.length === 0 ? (
          <p className="muted">{t('logs.empty')}</p>
        ) : (
          lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only text without ids
            <div key={index} className="log-line">
              {line}
            </div>
          ))
        )}
      </div>
    </PageFrame>
  );
}
