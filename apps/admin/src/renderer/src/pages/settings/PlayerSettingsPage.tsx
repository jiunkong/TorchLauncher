import { useId, useState } from 'react';
import type { SettingPolicyChoice, StudioGameOption } from '../../../../shared/studio.js';
import { FileIcon, PlayIcon, RefreshIcon } from '../../components/Icons';
import { Checkbox, Chip, Note, PageHeader, PolicyControl } from '../../components/ui';
import { importFailureKey } from '../../hooks/errors';
import type { StudioController } from '../../hooks/useStudio';
import { useStudioLocale } from '../../i18n';
import {
  matchesKey,
  optionLabel,
  type SettingsState,
  type SettingsTab,
} from '../../settings/state';
import type { PageProps } from '../types';
import { isKeybind, type Labels, type Send, usePolicyLabels } from './shared';

const tabs: SettingsTab[] = ['keys', 'options'];
type ImportSource = 'test' | 'file';

export function PlayerSettingsPage({
  studio,
  draft,
  settings,
  go,
}: PageProps & { settings: SettingsState }) {
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const labels = usePolicyLabels();
  const send: Send = (request) => void studio.command(request);
  const game = draft.gameSettings;
  const loaded = !!game && (game.options.length > 0 || !!state?.preset);
  const failure = importFailureKey(studio.lastRun);
  const tabLabel: Record<SettingsTab, string> = {
    keys: t('settings.tab.keys'),
    options: t('settings.tab.options'),
  };
  return (
    <>
      <PageHeader eyebrow={t('player.eyebrow')} title={t('player.title')} lead={t('player.lead')} />
      {loaded ? (
        <ImportBar studio={studio} game={game} go={go} />
      ) : (
        <ImportEmpty studio={studio} go={go} />
      )}
      {failure && <Note tone="warn">{t(failure)}</Note>}
      {loaded && (
        <>
          <div className="tabs" role="tablist" aria-label={t('settings.tabs')}>
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={settings.tab === item}
                className={`tab${settings.tab === item ? ' on' : ''}`}
                onClick={() => {
                  settings.setSelected(new Set());
                  settings.setTab(item);
                }}
              >
                {tabLabel[item]}
              </button>
            ))}
          </div>
          <OptionsTab
            kind={settings.tab}
            options={game?.options ?? []}
            settings={settings}
            labels={labels}
            send={send}
            busy={busy}
          />
        </>
      )}
    </>
  );
}

/** First visit: choose where the options come from (test run result or an options.txt file). */
export function ImportEmpty({ studio, go }: { studio: StudioController; go: PageProps['go'] }) {
  const { t } = useStudioLocale();
  const busy = studio.busy;
  const hasResult = !!studio.state?.testRun.extracted;
  return (
    <div className="src2" data-testid="settings-empty">
      <section className="card srcc">
        <span className="ic">
          <PlayIcon />
        </span>
        <h2>{t('settings.import.test.title')}</h2>
        <p>{t('settings.import.test.help')}</p>
        <div className="inp mono dim">
          {hasResult ? t('settings.import.test.ready') : t('settings.import.test.none')}
        </div>
        {hasResult ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void studio.command(
                { action: 'settingsImportOptions', source: 'test' },
                { quiet: true },
              )
            }
          >
            {t('settings.import.load')}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => go('test')}>
            {t('settings.import.test.go')}
          </button>
        )}
      </section>
      <section className="card srcc">
        <span className="ic">
          <FileIcon />
        </span>
        <h2>{t('settings.import.file.title')}</h2>
        <p>{t('settings.import.file.help')}</p>
        <div className="inp mono dim">{t('settings.import.file.none')}</div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void studio.command(
              { action: 'settingsImportOptions', source: 'file' },
              { quiet: true },
            )
          }
        >
          {t('settings.import.file.choose')}
        </button>
      </section>
    </div>
  );
}

/** One row: source toggle, what was imported, run a test, import again. */
export function ImportBar({
  studio,
  game,
  go,
}: {
  studio: StudioController;
  game: PageProps['draft']['gameSettings'];
  go: PageProps['go'];
}) {
  const { t } = useStudioLocale();
  const preset = studio.state?.preset ?? null;
  const [source, setSource] = useState<ImportSource>(preset?.source === 'test' ? 'test' : 'file');
  const options = game?.options ?? [];
  const keys = options.filter(isKeybind).length;
  return (
    <div className="preset" data-testid="settings-imported">
      <span className="seg" role="tablist" aria-label={t('settings.import.sourceTitle')}>
        {(['test', 'file'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={source === value}
            className={source === value ? 'on' : undefined}
            onClick={() => setSource(value)}
          >
            {t(`settings.import.source.${value}`)}
          </button>
        ))}
      </span>
      <div className="presetbody">
        <div className="fine">
          {t('settings.import.summary', { keys, options: options.length - keys })}
        </div>
        <div className="mono">
          {t(`settings.import.source.${preset?.source === 'test' ? 'test' : 'file'}`)}
        </div>
      </div>
      <button type="button" className="btn sm" onClick={() => go('test')}>
        <PlayIcon />
        {t('settings.import.runTest')}
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={studio.busy}
        onClick={() =>
          void studio.command({ action: 'settingsImportOptions', source }, { quiet: true })
        }
      >
        <RefreshIcon />
        {t('settings.import.reload')}
      </button>
    </div>
  );
}

export function OptionsTab({
  kind,
  options,
  settings,
  labels,
  send,
  busy,
}: {
  kind: 'keys' | 'options';
  options: StudioGameOption[];
  settings: SettingsState;
  labels: Labels;
  send: Send;
  busy: boolean;
}) {
  const { t } = useStudioLocale();
  const searchId = useId();
  const { search, filter, selected } = settings;
  const own = options.filter((option) => (kind === 'keys') === isKeybind(option));
  const visible = own.filter((option) =>
    matchesKey(
      { id: option.key, mod: option.kind === 'mod-keybind' },
      search,
      kind === 'keys' ? filter : 'all',
      option.policy,
    ),
  );
  const groups = [...new Set(visible.map((option) => option.group ?? ''))];
  const chosen = visible.filter((option) => selected.has(option.key)).map((option) => option.key);
  const chosenPolicies = new Set(
    visible.filter((option) => selected.has(option.key)).map((option) => option.policy),
  );
  const common = chosenPolicies.size === 1 ? ([...chosenPolicies][0] ?? null) : null;
  const change = (keys: string[], policy: SettingPolicyChoice) =>
    send({ action: 'settingsOptions', changes: keys.map((key) => ({ key, policy })) });
  const modCount = own.filter((option) => option.kind === 'mod-keybind').length;
  const chips = [
    ['all', t('settings.keys.all', { count: own.length })],
    ['base', t('settings.keys.base', { count: own.length - modCount })],
    ['mod', t('settings.keys.mod', { count: modCount })],
    [
      'set',
      t('settings.keys.set', { count: own.filter((option) => option.policy !== 'none').length }),
    ],
  ] as const;
  return (
    <>
      {chosen.length > 0 && (
        <div className="bulk" data-testid="settings-bulk">
          <span>
            <b>{t('settings.keys.selected', { count: chosen.length })}</b> ·{' '}
            {t('settings.keys.bulk')}
          </span>
          <PolicyControl
            value={common}
            onChange={(value) => {
              change(chosen, value);
              settings.setSelected(new Set());
            }}
            labels={labels}
            groupLabel={t('settings.keys.bulk')}
          />
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => settings.setSelected(new Set())}
          >
            {t('files.clear')}
          </button>
        </div>
      )}
      <div className="tools">
        <label className="sr" htmlFor={searchId}>
          {t('settings.keys.search')}
        </label>
        <input
          id={searchId}
          className="inp sr-in"
          type="search"
          value={search}
          placeholder={t('settings.keys.search')}
          onChange={(event) => settings.setSearch(event.target.value)}
        />
        {kind === 'keys' &&
          chips.map(([id, text]) => (
            <button
              key={id}
              type="button"
              className={`chip pick${filter === id ? ' on' : ''}`}
              aria-pressed={filter === id}
              onClick={() => settings.setFilter(id)}
            >
              {text}
            </button>
          ))}
        <span className="grow" />
        <button
          type="button"
          className="btn sm"
          disabled={visible.length === 0}
          onClick={() => settings.setSelected(new Set(visible.map((option) => option.key)))}
        >
          {t('settings.keys.selectVisible')}
        </button>
      </div>
      <div className="keylist" data-testid={kind === 'keys' ? 'settings-keys' : 'settings-options'}>
        {visible.length === 0 && <p className="empty-row">{t('settings.keys.noMatch')}</p>}
        {groups.map((group) => {
          const rows = visible.filter((option) => (option.group ?? '') === group);
          return (
            <div key={group || 'other'}>
              {(kind === 'keys' || group) && (
                <div className="grp">
                  {group || t('settings.keys.otherGroup')}
                  {rows.some((option) => option.kind === 'mod-keybind') && (
                    <Chip>{t('settings.keys.modChip')}</Chip>
                  )}
                </div>
              )}
              {rows.map((option) => {
                const name = optionLabel(option.key);
                return (
                  <div
                    className={`kr${selected.has(option.key) ? ' sel' : ''}`}
                    key={option.key}
                    data-testid="settings-key-row"
                  >
                    <Checkbox
                      checked={selected.has(option.key)}
                      label={t('settings.keys.select', { name })}
                      onChange={(on) => settings.toggle(option.key, on)}
                    />
                    <span className="n">
                      <strong>{name}</strong>
                      <small>{option.key}</small>
                    </span>
                    <span className="key">{option.value}</span>
                    <PolicyControl
                      value={option.policy}
                      disabled={busy}
                      onChange={(value) => change([option.key], value)}
                      labels={labels}
                      groupLabel={t('settings.policyOf', { name })}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
