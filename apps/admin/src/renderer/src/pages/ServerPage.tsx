import { useId } from 'react';
import { Note, PageHeader } from '../components/ui';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';
import { type ServerField, validateServer } from './validation';

export function ServerPage({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, edit } = studio;
  const errors = validateServer(draft);
  const id = useId();
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
              {field(
                'minecraftVersion',
                t('server.minecraft'),
                draft.game.minecraftVersion,
                (minecraftVersion) => patch({ game: { ...draft.game, minecraftVersion } }),
                { narrow: true },
              )}
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
                      onClick={() =>
                        patch({ game: { ...draft.game, loader: { ...draft.game.loader, kind } } })
                      }
                    >
                      {kind === 'fabric' ? 'Fabric' : 'NeoForge'}
                    </button>
                  ))}
                </div>
              </div>
              {field(
                'loaderVersion',
                t('server.loaderVersion'),
                draft.game.loader.version,
                (version) =>
                  patch({ game: { ...draft.game, loader: { ...draft.game.loader, version } } }),
                { narrow: true },
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
