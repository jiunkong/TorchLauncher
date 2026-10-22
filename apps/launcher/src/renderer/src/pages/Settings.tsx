import { useCallback, useEffect, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '../components/Icons';
import { ProgressBar } from '../components/ProgressBar';
import { formatBytes } from '../format';
import { useT } from '../hooks/useTranslator';
import type { LoadState } from './Mods';
import {
  defaultMaxMemoryMiB,
  exceedsRecommendedPhysicalMemory,
  memoryLimitMiB,
  parseMemoryGiB,
  validGameMemory,
} from './memory';
import { arrangePacks, canMove, movePack, packIds } from './packs';

export function SettingsPage({
  active,
  state,
  pending,
  command,
  onDelete,
}: {
  active: boolean;
  state: ProductState;
  pending: boolean;
  command(request: ProductCommand): Promise<boolean>;
  onDelete(): void;
}) {
  const t = useT();
  const busy = state.operation !== null || pending;
  const ready = state.configuration === 'ready' && !busy;
  const [packsLoad, setPacksLoad] = useState<LoadState>('unqueried');
  const [usageLoad, setUsageLoad] = useState<LoadState>('unqueried');
  // The user's unsaved pack order; null means "no draft". Progress events never touch it.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const maxMemoryMiB = state.preferences.maxMemoryMiB ?? defaultMaxMemoryMiB;
  const initialMemoryMiB = state.preferences.initialMemoryMiB;
  const [maxMemoryDraft, setMaxMemoryDraft] = useState(String(maxMemoryMiB / 1024));
  const [initialMemoryDraft, setInitialMemoryDraft] = useState(
    initialMemoryMiB === undefined ? '' : String(initialMemoryMiB / 1024),
  );
  const [memorySaving, setMemorySaving] = useState(false);
  const maxDraftMiB = parseMemoryGiB(maxMemoryDraft);
  const initialDraftMiB = initialMemoryDraft ? parseMemoryGiB(initialMemoryDraft) : undefined;
  const memoryValid =
    maxDraftMiB !== null &&
    (initialMemoryDraft === '' || initialDraftMiB !== null) &&
    validGameMemory(maxDraftMiB, initialDraftMiB ?? undefined, state.physicalMemoryMiB);
  const memoryLimit = memoryLimitMiB(state.physicalMemoryMiB);

  useEffect(() => {
    setMaxMemoryDraft(String(maxMemoryMiB / 1024));
    setInitialMemoryDraft(initialMemoryMiB === undefined ? '' : String(initialMemoryMiB / 1024));
  }, [maxMemoryMiB, initialMemoryMiB]);

  const loadPacks = useCallback(() => {
    setPacksLoad('loading');
    void command({ type: 'packs' }).then((ok) => setPacksLoad(ok ? 'loaded' : 'failed'));
  }, [command]);
  const loadUsage = useCallback(() => {
    setUsageLoad('loading');
    void command({ type: 'usage' }).then((ok) => setUsageLoad(ok ? 'loaded' : 'failed'));
  }, [command]);
  // Packs first, then usage; each waits until no other operation is running.
  useEffect(() => {
    if (!active || !ready) return;
    if (packsLoad === 'unqueried') loadPacks();
    else if (packsLoad !== 'loading' && usageLoad === 'unqueried') loadUsage();
  }, [active, ready, packsLoad, usageLoad, loadPacks, loadUsage]);
  // After the data was deleted the old usage is gone; measure again.
  const usageGone = usageLoad === 'loaded' && state.usage === null;
  useEffect(() => {
    if (usageGone) setUsageLoad('unqueried');
  }, [usageGone]);

  const packs = arrangePacks(state.packs, draft);
  const dirty = draft !== null && packIds(packs).join('\n') !== packIds(state.packs).join('\n');
  const move = (index: number, direction: -1 | 1) => {
    setSaved(false);
    setDraft(
      movePack(packs, index, direction)
        .filter((pack) => !pack.required)
        .map((pack) => pack.id),
    );
  };

  return (
    <div className="cols settings-cols">
      <div className="stack">
        <section className="card" aria-labelledby="settings-launcher">
          <h2 id="settings-launcher">{t('settings.launcher')}</h2>
          {state.preferences.error && <p role="alert">{t('settings.prefsFailed')}</p>}
          <div className="row">
            <span className="grow">
              <strong id="close-on-launch-label">{t('settings.closeOnLaunch')}</strong>
              <small id="close-on-launch-hint">{t('settings.closeOnLaunchHint')}</small>
            </span>
            <button
              className={`switch${state.preferences.closeOnLaunch ? ' on' : ''}`}
              type="button"
              role="switch"
              aria-checked={state.preferences.closeOnLaunch}
              aria-labelledby="close-on-launch-label"
              aria-describedby="close-on-launch-hint"
              data-testid="close-on-launch"
              disabled={!ready}
              onClick={() =>
                void command({
                  type: 'set-close-on-launch',
                  value: !state.preferences.closeOnLaunch,
                })
              }
            />
          </div>
        </section>
        <section className="card" aria-labelledby="settings-memory">
          <h2 id="settings-memory">{t('settings.gameMemory')}</h2>
          <p className="hint">{t('settings.memoryInitialHint')}</p>
          <div className="field">
            <span>{t('settings.maxMemory')}</span>
            <span className="input-unit memory-input">
              <input
                type="number"
                min={0.5}
                max={memoryLimit / 1024}
                step={0.25}
                inputMode="decimal"
                value={maxMemoryDraft}
                aria-label={t('settings.maxMemory')}
                data-testid="max-memory"
                disabled={memorySaving}
                onChange={(event) => setMaxMemoryDraft(event.target.value)}
              />
              <span>{t('settings.memoryUnit')}</span>
            </span>
          </div>
          <div className="field">
            <span>{t('settings.initialMemory')}</span>
            <span className="input-unit memory-input">
              <input
                type="number"
                min={0.25}
                max={maxDraftMiB === null ? 0 : Math.min(maxDraftMiB, memoryLimit) / 1024}
                step={0.25}
                inputMode="decimal"
                value={initialMemoryDraft}
                aria-label={t('settings.initialMemory')}
                data-testid="initial-memory"
                disabled={memorySaving}
                onChange={(event) => setInitialMemoryDraft(event.target.value)}
              />
              <span>{t('settings.memoryUnit')}</span>
            </span>
          </div>
          {!memoryValid && (
            <p role="alert" className="hint">
              {memoryLimit < 512
                ? t('settings.memoryUnsupported')
                : t('settings.memoryInvalid', { limit: (memoryLimit / 1024).toFixed(2) })}
            </p>
          )}
          {memoryValid &&
            maxDraftMiB !== null &&
            exceedsRecommendedPhysicalMemory(maxDraftMiB, state.physicalMemoryMiB) && (
              <p role="status" className="hint">
                {t('settings.memoryHigh')}
              </p>
            )}
          <div className="row">
            <small className="grow">{t('settings.memoryNextLaunch')}</small>
            <button
              className="btn sm primary"
              type="button"
              data-testid="save-memory"
              disabled={!memoryValid || memorySaving || maxDraftMiB === null}
              onClick={() => {
                if (maxDraftMiB === null) return;
                setMemorySaving(true);
                void command({
                  type: 'set-game-memory',
                  maxMemoryMiB: maxDraftMiB,
                  ...(initialDraftMiB == null ? {} : { initialMemoryMiB: initialDraftMiB }),
                }).then(() => setMemorySaving(false));
              }}
            >
              {t('settings.save')}
            </button>
          </div>
        </section>
        <section className="card" aria-labelledby="settings-data">
          <h2 id="settings-data">{t('settings.data')}</h2>
          {state.serverDataRoot && (
            <div className="kv">
              <span>{t('settings.location')}</span>
              <span className="mono selectable path">{state.serverDataRoot}</span>
            </div>
          )}
          <div className="kv">
            <span>{t('settings.usage')}</span>
            <span data-testid="usage">
              {state.usage
                ? t('settings.usageValue', {
                    size: formatBytes(state.usage.bytes),
                    files: state.usage.files.toLocaleString(),
                  })
                : usageLoad === 'failed'
                  ? t('settings.usageFailed')
                  : t('settings.usageLoading')}
            </span>
          </div>
          {!state.usage && usageLoad !== 'failed' && (
            <ProgressBar measured={null} unknownLabel={t('operation.usage')} />
          )}
          <p className="hint spaced-block">{t('settings.dataHint')}</p>
          <button
            className="btn danger"
            type="button"
            data-testid="delete-data"
            disabled={!ready}
            onClick={onDelete}
          >
            <TrashIcon />
            {t('settings.delete')}
          </button>
        </section>
      </div>
      <section className="card" aria-labelledby="settings-packs">
        <div className="sec-title">
          <h2 id="settings-packs">{t('settings.packs')}</h2>
          <button
            className="btn sm primary"
            type="button"
            data-testid="save-button"
            disabled={!ready || !dirty}
            onClick={() => {
              void command({ type: 'set-packs', packs: packIds(packs) }).then((ok) => {
                if (ok) {
                  setDraft(null);
                  setSaved(true);
                }
              });
            }}
          >
            {t('settings.save')}
          </button>
        </div>
        {packsLoad === 'loading' && <p role="status">{t('settings.packsLoading')}</p>}
        {packsLoad === 'failed' && (
          <div className="error" role="alert">
            <p>{t('settings.packsFailed')}</p>
            <button className="btn sm" type="button" disabled={!ready} onClick={loadPacks}>
              {t('home.retry')}
            </button>
          </div>
        )}
        {packsLoad === 'loaded' && packs.length === 0 && (
          <p className="muted">{t('settings.packsEmpty')}</p>
        )}
        {packs.length > 0 && (
          <ul className="packs" aria-label={t('settings.packList')}>
            {packs.map((pack, index) => (
              <li key={pack.id} className={`pack${pack.required ? ' fixed' : ''}`}>
                <span className="grow mono selectable">{pack.id}</span>
                {pack.required ? (
                  <span className="badge lock">{t('settings.packRequired')}</span>
                ) : (
                  <>
                    <button
                      className="iconbtn"
                      type="button"
                      aria-label={t('settings.moveUp', { name: pack.id })}
                      disabled={!ready || !canMove(packs, index, -1)}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUpIcon />
                    </button>
                    <button
                      className="iconbtn"
                      type="button"
                      aria-label={t('settings.moveDown', { name: pack.id })}
                      disabled={!ready || !canMove(packs, index, 1)}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDownIcon />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {state.missingPacks.length > 0 && (
          <p className="hint spaced">
            {t('settings.missingPacks', { packs: state.missingPacks.join(', ') })}
          </p>
        )}
        {saved && !dirty && (
          <p className="hintline" role="status">
            {t('settings.saved')}
          </p>
        )}
      </section>
    </div>
  );
}
