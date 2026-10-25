import { useEffect, useId, useRef, useState } from 'react';
import { minecraftVersions } from '../../../shared/minecraft-versions.js';
import { Note, PageHeader } from '../components/ui';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { parseMemoryGiBText, type ServerField, validateServer } from './validation';

const loaderCache = new Map<string, string[]>();

export function ServerPage({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, edit } = studio;
  const errors = validateServer(draft);
  const id = useId();
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderStatus, setLoaderStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryVersionLookup, setRetryVersionLookup] = useState(0);
  const pendingLoaderVersion = useRef<{ key: string; version: string } | null>(null);
  const lastRetryVersionLookup = useRef(0);
  const latest = useRef({ draft, edit });
  latest.current = { draft, edit };
  const minecraftVersion = draft.game.minecraftVersion;
  const loaderKind = draft.game.loader.kind;
  const selectionKey = `${minecraftVersion}:${loaderKind}`;

  useEffect(() => {
    let active = true;
    setLoaderVersions([]);
    setLoaderStatus('loading');
    const forceRefresh = lastRetryVersionLookup.current !== retryVersionLookup;
    lastRetryVersionLookup.current = retryVersionLookup;
    const cached = forceRefresh ? undefined : loaderCache.get(selectionKey);
    const load = cached
      ? Promise.resolve(cached)
      : window.torchlauncher
          .request({ action: 'loaderVersions', minecraftVersion, kind: loaderKind })
          .then((reply) => {
            if (!reply.ok) throw new Error(reply.code);
            if (!reply.loaderVersions) throw new Error('Missing loader catalog');
            loaderCache.set(selectionKey, reply.loaderVersions);
            return reply.loaderVersions;
          });
    void load
      .then((versions) => {
        if (!active) return;
        setLoaderVersions(versions);
        setLoaderStatus('ready');
        const current = latest.current.draft;
        const candidate = pendingLoaderVersion.current;
        const version =
          candidate?.key === selectionKey ? candidate.version : current.game.loader.version;
        if (candidate?.key === selectionKey) pendingLoaderVersion.current = null;
        if (versions.includes(version)) {
          if (current.game.loader.version !== version)
            latest.current.edit({
              ...current,
              game: { ...current.game, loader: { ...current.game.loader, version } },
            });
        } else if (current.game.loader.version) {
          latest.current.edit({
            ...current,
            game: { ...current.game, loader: { ...current.game.loader, version: '' } },
          });
        }
      })
      .catch(() => {
        if (active) setLoaderStatus('error');
      });
    return () => {
      active = false;
    };
  }, [minecraftVersion, loaderKind, retryVersionLookup, selectionKey]);

  const gibText = (mib: number | undefined) =>
    mib === undefined || Number.isNaN(mib) ? '' : String(mib / 1024);
  const [maxText, setMaxText] = useState(gibText(draft.memory?.maxMiB));
  const [initialText, setInitialText] = useState(gibText(draft.memory?.initialMiB));
  const memoryOwner = useRef(draft.serverId);
  if (memoryOwner.current !== draft.serverId) {
    memoryOwner.current = draft.serverId;
    setMaxText(gibText(draft.memory?.maxMiB));
    setInitialText(gibText(draft.memory?.initialMiB));
  }
  const editMemory = (nextMax: string, nextInitial: string) => {
    setMaxText(nextMax);
    setInitialText(nextInitial);
    const maxMiB = parseMemoryGiBText(nextMax);
    const initialMiB = parseMemoryGiBText(nextInitial);
    const { memory: _previous, ...rest } = draft;
    edit(
      maxMiB === undefined && initialMiB === undefined
        ? rest
        : {
            ...rest,
            memory: {
              maxMiB: maxMiB ?? Number.NaN,
              ...(initialMiB === undefined ? {} : { initialMiB }),
            },
          },
    );
  };
  const memoryField = (
    key: 'memoryMax' | 'memoryInitial',
    label: string,
    text: string,
    change: (value: string) => void,
    options: { min: number; help: string; testId: string },
  ) => {
    const error = errors[key];
    return (
      <div className="fld">
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <span className="inp-unit">
          <input
            id={`${id}-${key}`}
            className={`inp narrow mono${error ? ' bad' : ''}`}
            type="number"
            min={options.min}
            max={64}
            step={options.min}
            inputMode="decimal"
            value={text}
            data-testid={options.testId}
            disabled={busy}
            aria-invalid={!!error}
            aria-describedby={`${id}-${key}-d`}
            onChange={(event) => change(event.target.value)}
          />
          <span>{t('server.memory.unit')}</span>
        </span>
        <span id={`${id}-${key}-d`} className={error ? 'err' : 'help'}>
          {error ? t(error) : options.help}
        </span>
      </div>
    );
  };
  const patch = (values: Partial<typeof draft>) => edit({ ...draft, ...values });
  const field = (
    key: ServerField,
    label: string,
    value: string,
    change: (value: string) => void,
    options: { help?: string; narrow?: boolean; mono?: boolean } = {},
  ) => {
    const error = errors[key];
    return (
      <div className="fld">
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <input
          id={`${id}-${key}`}
          className={`inp${error ? ' bad' : ''}${options.mono ? ' mono' : ''}${options.narrow ? ' narrow' : ''}`}
          type="text"
          value={value}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={`${id}-${key}-d`}
          onChange={(event) => change(event.target.value)}
        />
        <span id={`${id}-${key}-d`} className={error ? 'err' : 'help'}>
          {error ? t(error) : options.help}
        </span>
      </div>
    );
  };
  return (
    <>
      <PageHeader eyebrow={t('server.eyebrow')} title={t('server.title')} lead={t('server.lead')} />
      <div className="grid2">
        <div className="stack">
          <section className="card">
            <h2>{t('server.card.server')}</h2>
            <div className="card-body">
              {field('name', t('server.name'), draft.name, (name) => patch({ name }))}
              {field(
                'address',
                t('server.address'),
                draft.address,
                (address) => patch({ address }),
                {
                  help: t('server.addressHelp'),
                },
              )}
            </div>
          </section>
          <section className="card">
            <h2>{t('server.card.game')}</h2>
            <div className="card-body">
              <div className="fld">
                <label htmlFor={`${id}-minecraftVersion`}>{t('server.minecraft')}</label>
                <select
                  id={`${id}-minecraftVersion`}
                  className={`inp narrow${errors.minecraftVersion ? ' bad' : ''}`}
                  value={
                    (minecraftVersions as readonly string[]).includes(draft.game.minecraftVersion)
                      ? draft.game.minecraftVersion
                      : ''
                  }
                  disabled={busy}
                  aria-invalid={!!errors.minecraftVersion}
                  aria-describedby={
                    errors.minecraftVersion ? `${id}-minecraftVersion-d` : undefined
                  }
                  onChange={(event) => {
                    const nextVersion = event.target.value;
                    pendingLoaderVersion.current = {
                      key: `${nextVersion}:${draft.game.loader.kind}`,
                      version: draft.game.loader.version,
                    };
                    patch({
                      game: {
                        ...draft.game,
                        minecraftVersion: nextVersion,
                        loader: { ...draft.game.loader, version: '' },
                      },
                    });
                  }}
                >
                  <option value="" disabled>
                    {t('server.chooseMinecraft')}
                  </option>
                  {minecraftVersions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
                {errors.minecraftVersion ? (
                  <span id={`${id}-minecraftVersion-d`} className="err">
                    {t(errors.minecraftVersion)}
                  </span>
                ) : null}
              </div>
              <div className="fld">
                <span className="lbl" id={`${id}-loader`}>
                  {t('server.loader')}
                </span>
                <div className="seg" role="radiogroup" aria-labelledby={`${id}-loader`}>
                  {(['fabric', 'neoforge'] as const).map((kind) => (
                    // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={draft.game.loader.kind === kind}
                      className={draft.game.loader.kind === kind ? 'on' : undefined}
                      disabled={busy}
                      onClick={() => {
                        pendingLoaderVersion.current = {
                          key: `${draft.game.minecraftVersion}:${kind}`,
                          version: draft.game.loader.version,
                        };
                        patch({
                          game: {
                            ...draft.game,
                            loader: { ...draft.game.loader, kind, version: '' },
                          },
                        });
                      }}
                    >
                      {kind === 'fabric' ? 'Fabric' : 'NeoForge'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fld">
                <label htmlFor={`${id}-loaderVersion`}>{t('server.loaderVersion')}</label>
                <select
                  id={`${id}-loaderVersion`}
                  className={`inp narrow${errors.loaderVersion ? ' bad' : ''}`}
                  value={
                    loaderStatus === 'ready' && loaderVersions.includes(draft.game.loader.version)
                      ? draft.game.loader.version
                      : ''
                  }
                  disabled={busy || loaderStatus !== 'ready' || loaderVersions.length === 0}
                  aria-invalid={!!errors.loaderVersion}
                  aria-describedby={`${id}-loaderVersion-d`}
                  onChange={(event) =>
                    patch({
                      game: {
                        ...draft.game,
                        loader: { ...draft.game.loader, version: event.target.value },
                      },
                    })
                  }
                >
                  <option value="" disabled>
                    {loaderStatus === 'ready'
                      ? t('server.chooseLoader')
                      : t('server.loaderVersion')}
                  </option>
                  {loaderVersions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
                <span
                  id={`${id}-loaderVersion-d`}
                  className={errors.loaderVersion ? 'err' : 'help'}
                  aria-live="polite"
                >
                  {loaderStatus === 'loading' ? (
                    t('server.loaderLoading')
                  ) : loaderStatus === 'error' ? (
                    <>
                      {t('server.loaderError')}{' '}
                      <button
                        type="button"
                        className="chip link"
                        disabled={busy}
                        onClick={() => setRetryVersionLookup((value) => value + 1)}
                      >
                        {t('common.retry')}
                      </button>
                    </>
                  ) : loaderVersions.length === 0 ? (
                    t('server.noLoaderVersions')
                  ) : null}
                </span>
              </div>
              <div className="fld memory-group">
                <span className="lbl">{t('server.memory.title')}</span>
                <span className="help">{t('server.memory.help')}</span>
              </div>
              {memoryField(
                'memoryMax',
                t('server.memory.max'),
                maxText,
                (value) => editMemory(value, initialText),
                { min: 0.5, help: t('server.memory.maxHelp'), testId: 'memory-max' },
              )}
              {memoryField(
                'memoryInitial',
                t('server.memory.initial'),
                initialText,
                (value) => editMemory(maxText, value),
                { min: 0.25, help: t('server.memory.initialHelp'), testId: 'memory-initial' },
              )}
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <h2>{t('server.card.id')}</h2>
            <p className="sub">{t('server.idSub')}</p>
            <div className="inp mono block" data-testid="server-id">
              {draft.serverId}
            </div>
            <p className="fine">{t('server.idHelp')}</p>
          </section>
          <Note tone="warn">{t('server.reexport')}</Note>
          <p className="fine">{t('server.validated')}</p>
        </div>
      </div>
    </>
  );
}
