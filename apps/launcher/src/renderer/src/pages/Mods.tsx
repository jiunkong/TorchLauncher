import { useEffect, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';
import { FileIcon, ModsIcon, PlusIcon } from '../components/Icons';
import { useT } from '../hooks/useTranslator';
import type { Translate } from '../i18n/translate';

type Mod = ProductState['mods'][number];
export type LoadState = 'unqueried' | 'loading' | 'loaded' | 'failed';

export const modName = (path: string) => path.replace(/^mods\//, '');

/** Reasons a registered or unregistered file needs the user's attention (state and conflicts). */
export function modNotes(t: Translate, mod: Mod): string[] {
  const notes: string[] = [];
  if (mod.state === 'missing') notes.push(t('mods.stateMissing'));
  else if (mod.state === 'modified') notes.push(t('mods.stateModified'));
  else if (mod.state === 'unsafe') notes.push(t('mods.stateUnsafe'));
  if (mod.conflicts > 0) notes.push(t('mods.conflicts', { count: mod.conflicts }));
  return notes;
}

export const modNeedsCheck = (mod: Mod) =>
  mod.state !== 'ok' || mod.conflicts > 0 || mod.modIds.length === 0;

export function ModsAddButton({ disabled, onClick }: { disabled: boolean; onClick(): void }) {
  const t = useT();
  return (
    <button
      className="btn primary"
      type="button"
      data-testid="add-mod"
      disabled={disabled}
      onClick={onClick}
    >
      <PlusIcon />
      {t('mods.add')}
    </button>
  );
}

export function ModsPage({
  active,
  state,
  pending,
  command,
  onRemoveUnregistered,
}: {
  active: boolean;
  state: ProductState;
  pending: boolean;
  command(request: ProductCommand): Promise<boolean>;
  onRemoveUnregistered?(path: string): void;
}) {
  const busy = state.operation !== null || pending;
  const ready = state.configuration === 'ready' && !busy;
  const [load, setLoad] = useState<LoadState>('unqueried');
  const refresh = () => {
    setLoad('loading');
    void command({ type: 'mods' }).then((ok) => setLoad(ok ? 'loaded' : 'failed'));
  };
  useEffect(() => {
    if (!active || !ready || load !== 'unqueried') return;
    setLoad('loading');
    void command({ type: 'mods' }).then((ok) => setLoad(ok ? 'loaded' : 'failed'));
  }, [active, ready, load, command]);

  return (
    <ModsView
      state={state}
      load={load}
      ready={ready}
      command={command}
      onRetry={refresh}
      {...(onRemoveUnregistered ? { onRemoveUnregistered } : {})}
    />
  );
}

export function ModsView({
  state,
  load,
  ready,
  command,
  onRetry,
  onRemoveUnregistered,
}: {
  state: ProductState;
  load: LoadState;
  ready: boolean;
  command(request: ProductCommand): Promise<boolean>;
  onRetry(): void;
  onRemoveUnregistered?(path: string): void;
}) {
  const t = useT();
  const loaded = load === 'loaded';
  // Lists appear only for a successful query; before that the headings carry no counts.
  const entries = loaded ? state.mods : [];
  const mine = entries.filter((mod) => mod.source === 'user');
  const server = entries.filter((mod) => mod.source === 'operator');
  const unregistered = entries.filter((mod) => mod.source === 'unregistered');
  const count = (value: number) => (loaded ? String(value) : '–');

  return (
    <>
      {state.modsRecovery && <p role="alert">{t('mods.recoveryPending')}</p>}
      {load === 'loading' && <p role="status">{t('mods.loading')}</p>}
      {load === 'failed' && (
        <div className="error" role="alert">
          <p>{t('mods.failed')}</p>
          <button
            className="btn sm"
            type="button"
            disabled={!ready || state.running}
            onClick={onRetry}
          >
            {t('home.retry')}
          </button>
        </div>
      )}
      <div className="cols mods-cols">
        <section className="card" aria-labelledby="mods-mine">
          <div className="sec-title">
            <h2 id="mods-mine">{t('mods.mine', { count: count(mine.length) })}</h2>
          </div>
          <div className="list">
            {loaded && mine.length === 0 && <p className="muted">{t('mods.emptyMine')}</p>}
            {mine.map((mod) => {
              const notes = modNotes(t, mod);
              const detail = [
                mod.modIds.length > 0
                  ? t('mods.ids', { ids: mod.modIds.join(', ') })
                  : t('mods.idUnread'),
                ...notes,
              ].join(' · ');
              return (
                <div className="row" key={mod.path}>
                  <span className="fileicon">
                    <ModsIcon />
                  </span>
                  <span className="grow">
                    <strong className="selectable">{modName(mod.path)}</strong>
                    <small>{detail}</small>
                  </span>
                  {modNeedsCheck(mod) && <span className="badge warn">{t('mods.needsCheck')}</span>}
                  <button
                    className="btn sm danger"
                    type="button"
                    disabled={!ready || state.running}
                    aria-label={t('mods.removeLabel', { name: modName(mod.path) })}
                    onClick={() => {
                      if (window.confirm(t('mods.removeConfirm', { name: modName(mod.path) })))
                        void command({ type: 'remove-mod', path: mod.path });
                    }}
                  >
                    {t('mods.remove')}
                  </button>
                </div>
              );
            })}
          </div>
          {loaded && <p className="hint spaced">{t('mods.compat')}</p>}
        </section>
        <div className="stack">
          <section className="card muted-card" aria-labelledby="mods-server">
            <div className="sec-title">
              <h2 id="mods-server">{t('mods.server', { count: count(server.length) })}</h2>
              <span className="badge lock">{t('mods.serverBadge')}</span>
            </div>
            <div className="list">
              {loaded && server.length === 0 && <p className="muted">{t('mods.emptyServer')}</p>}
              {server.map((mod) => (
                <div className="row" key={mod.path}>
                  <span className="grow">
                    <strong className="selectable">{modName(mod.path)}</strong>
                  </span>
                </div>
              ))}
            </div>
          </section>
          {loaded && unregistered.length > 0 && (
            <section className="card" aria-labelledby="mods-unregistered">
              <div className="sec-title">
                <h2 id="mods-unregistered">
                  {t('mods.unregistered', { count: unregistered.length })}
                </h2>
              </div>
              <div className="list">
                {unregistered.map((mod) => {
                  const notes = modNotes(t, mod);
                  return (
                    <div className="row" key={mod.path}>
                      <span className="fileicon">
                        <FileIcon />
                      </span>
                      <span className="grow">
                        <strong className="selectable">{modName(mod.path)}</strong>
                        <small>{[t('mods.unregisteredHint'), ...notes].join(' · ')}</small>
                      </span>
                      {mod.state === 'ok' && /\.jar$/i.test(mod.path) && (
                        <button
                          className="btn sm"
                          type="button"
                          disabled={!ready || state.running}
                          aria-label={t('mods.adoptLabel', { name: modName(mod.path) })}
                          onClick={() => void command({ type: 'adopt-mod', path: mod.path })}
                        >
                          {t('mods.adopt')}
                        </button>
                      )}
                      <button
                        className="btn sm danger"
                        type="button"
                        disabled={!ready || state.running}
                        aria-label={t('mods.removeLabel', { name: modName(mod.path) })}
                        onClick={() => onRemoveUnregistered?.(mod.path)}
                      >
                        {t('mods.remove')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
