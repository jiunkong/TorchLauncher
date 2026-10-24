import { useEffect, useId, useState } from 'react';
import type {
  SettingPolicyChoice,
  StudioConfigFile,
  StudioGameSettings,
} from '../../../../shared/studio.js';
import { FolderIcon } from '../../components/Icons';
import { Chip, Note, PolicyControl } from '../../components/ui';
import { useStudioLocale } from '../../i18n';
import type { PageProps } from '../types';
import { type Labels, PresetDialog, packColor, type Send, usePolicyLabels } from './shared';

/** Config files the project manages plus the candidates the last test run found. */
export function mergeConfigFiles(
  game: StudioGameSettings | undefined,
  candidates: StudioConfigFile[] | null | undefined,
): StudioConfigFile[] {
  const byPath = new Map((game?.configFiles ?? []).map((file) => [file.path, file]));
  for (const candidate of candidates ?? [])
    if (!byPath.has(candidate.path)) byPath.set(candidate.path, candidate);
  return [...byPath.values()];
}

const fileName = (path: string) => path.split('/').pop() ?? path;

export function ModConfigSection({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const [dialog, setDialog] = useState(false);
  const labels = usePolicyLabels();
  const send: Send = (request) => void studio.command(request);
  // The mod settings route reads the instance's config files once when it is entered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: execute once when entering the route.
  useEffect(() => {
    void studio.command({ action: 'settingsTestConfigs' }, { quiet: true });
  }, []);
  const files = mergeConfigFiles(draft.gameSettings, state?.testRun.configFiles);
  const unsupported = state?.testRun.configPreview?.skippedConfigs ?? [];
  return (
    <>
      <section className="card" data-testid="settings-config-section">
        <div className="sechead">
          <div>
            <h2>{t('settings.config.title')}</h2>
            <p className="sub tight">{t('settings.config.lead')}</p>
          </div>
        </div>
        <ConfigPanes
          files={files}
          managed={new Set((draft.gameSettings?.configFiles ?? []).map((file) => file.path))}
          unsupported={unsupported.map((file) => file.path)}
          labels={labels}
          send={send}
          busy={busy}
        />
        <div>
          <button className="btn sm" type="button" disabled={busy} onClick={() => setDialog(true)}>
            <FolderIcon />
            {t('settings.dialog.folderAction')}
          </button>
        </div>
        <Note>{t('settings.config.note')}</Note>
      </section>
      {dialog && (
        <PresetDialog
          busy={busy}
          onCancel={() => setDialog(false)}
          onImport={async (source) => {
            if (await studio.command({ action: 'settingsImport', source })) setDialog(false);
          }}
        />
      )}
    </>
  );
}

export function ConfigPanes({
  files,
  managed,
  unsupported,
  labels,
  send,
  busy,
}: {
  files: StudioConfigFile[];
  managed: ReadonlySet<string>;
  unsupported: string[];
  labels: Labels;
  send: Send;
  busy: boolean;
}) {
  const { t } = useStudioLocale();
  const searchId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const current = files.find((file) => file.path === picked) ?? files[0];
  const items = (current?.items ?? []).filter((item) =>
    item.key.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const setCount = (file: StudioConfigFile) =>
    file.items.filter((item) => item.policy !== 'none').length;
  const change = (path: string, changes: { key: string; policy: SettingPolicyChoice }[]) =>
    send({ action: 'settingsConfigItems', path, changes });
  return (
    <div className="cols mods" data-testid="settings-config">
      <section className="card">
        <div className="sechead">
          <div>
            <h2>{t('settings.config.listTitle')}</h2>
            <p className="sub tight">{t('settings.config.sub')}</p>
          </div>
        </div>
        {files.length === 0 && unsupported.length === 0 && (
          <p className="empty-row">{t('settings.config.none')}</p>
        )}
        <div className="packlist">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`pk pick${file.path === current?.path ? ' on' : ''}`}
              aria-pressed={file.path === current?.path}
              data-testid="config-file"
              onClick={() => setPicked(file.path)}
            >
              <span className="pic" style={{ background: packColor(file.path) }} aria-hidden="true">
                {[...fileName(file.path)][0]?.toUpperCase()}
              </span>
              <span className="n">
                <strong>{fileName(file.path)}</strong>
                <small>
                  {t('settings.config.fileMeta', { count: file.items.length, set: setCount(file) })}
                </small>
              </span>
            </button>
          ))}
          {unsupported.map((path) => (
            <div className="pk dim" key={path} data-testid="config-unsupported">
              <span className="pic muted" aria-hidden="true">
                {[...fileName(path)][0]?.toUpperCase()}
              </span>
              <span className="n">
                <strong>{fileName(path)}</strong>
                <small>{t('settings.config.unsupportedHelp')}</small>
              </span>
              <Chip>{t('settings.config.unsupported')}</Chip>
            </div>
          ))}
        </div>
      </section>
      <section className="card slimlist">
        {current ? (
          <>
            <div className="itemhead">
              <div className="grow">
                <h2>{fileName(current.path)}</h2>
                <p className="sub tight">
                  {t('settings.config.itemsMeta', {
                    path: current.path,
                    count: current.items.length,
                  })}
                </p>
              </div>
              <label className="sr" htmlFor={searchId}>
                {t('settings.config.search')}
              </label>
              <input
                id={searchId}
                className="inp sr-in"
                type="search"
                value={query}
                placeholder={t('settings.config.search')}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn sm"
                disabled={busy || setCount(current) === 0}
                onClick={() =>
                  change(
                    current.path,
                    current.items
                      .filter((item) => item.policy !== 'none')
                      .map((item) => ({ key: item.key, policy: 'none' })),
                  )
                }
              >
                {t('settings.config.clear')}
              </button>
              {managed.has(current.path) && (
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={busy}
                  aria-label={t('settings.config.remove', { path: current.path })}
                  onClick={() => send({ action: 'settingsConfigRemove', path: current.path })}
                >
                  {t('brand.remove')}
                </button>
              )}
            </div>
            <div data-testid="config-items">
              {items.length === 0 && <p className="empty-row">{t('settings.keys.noMatch')}</p>}
              {items.map((item) => (
                <div className="kr" key={item.key}>
                  <span className="n">
                    <strong className="mono">{item.key}</strong>
                    <small>
                      {t('settings.config.currentValue')} <span className="mono">{item.value}</span>
                    </small>
                  </span>
                  <PolicyControl
                    value={item.policy}
                    disabled={busy}
                    onChange={(policy) => change(current.path, [{ key: item.key, policy }])}
                    labels={labels}
                    groupLabel={t('settings.policyOf', { name: item.key })}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-row">{t('settings.config.noneSelected')}</p>
        )}
      </section>
    </div>
  );
}
