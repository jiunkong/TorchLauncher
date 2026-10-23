import { type ReactNode, useId, useState } from 'react';
import type {
  PackKind,
  SettingPolicyChoice,
  StudioConfigItem,
  StudioGameOption,
  StudioGameSettings,
  StudioPack,
  StudioRequest,
  StudioShaderSettings,
} from '../../../shared/studio.js';
import {
  CheckIcon,
  DownIcon,
  FolderIcon,
  GamepadIcon,
  PlusIcon,
  RefreshIcon,
  UpIcon,
} from '../components/Icons';
import { Modal } from '../components/Modal';
import { Checkbox, Chip, Note, PageHeader, type Policy3, PolicyControl } from '../components/ui';
import { formatBytes } from '../format';
import { useStudioLocale } from '../i18n';
import { matchesKey, optionLabel, type SettingsState, type SettingsTab } from '../settings/state';
import type { PageProps } from './types';

const tabs: SettingsTab[] = ['keys', 'options', 'config', 'packs', 'shaders'];
type Send = (request: StudioRequest) => void;
type Labels = Record<Policy3, string>;

const isKeybind = (option: StudioGameOption) =>
  option.kind === 'keybind' || option.kind === 'mod-keybind' || option.key.startsWith('key_');

export function SettingsPage({ studio, draft, settings }: PageProps & { settings: SettingsState }) {
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const [dialog, setDialog] = useState(false);
  const send: Send = (request) => void studio.command(request);
  const game: StudioGameSettings | undefined = draft.gameSettings;
  const loaded = !!game && (game.options.length > 0 || !!state?.preset);
  const preset = state?.preset ?? null;
  const policy = state?.policy ?? null;
  const labels: Labels = {
    none: t('settings.policy.none'),
    initial: t('settings.policy.initial'),
    required: t('settings.policy.required'),
  };
  const tabLabel: Record<SettingsTab, string> = {
    keys: t('settings.tab.keys'),
    options: t('settings.tab.options'),
    config: t('settings.tab.config'),
    packs: t('settings.tab.packs'),
    shaders: t('settings.tab.shaders'),
  };
  const keyCount = game?.options.filter(isKeybind).length ?? 0;
  const files = ['options.txt', ...(preset?.importedConfigs ?? [])];

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        lead={t('settings.lead')}
      />
      <div className="preset" data-testid="settings-preset" data-loaded={loaded}>
        {loaded ? (
          <>
            <span className="ic2">
              <CheckIcon />
            </span>
            <div className="presetbody">
              <div className="fine">
                {t('settings.preset.loaded', {
                  options: game?.options.length ?? 0,
                  keys: keyCount,
                })}
                {preset &&
                  preset.ignored > 0 &&
                  ` · ${t('settings.preset.ignored', { count: preset.ignored })}`}
              </div>
              <div className="mono">{files.join(', ')}</div>
              <div className="fine">{t('settings.preset.reloadHint')}</div>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => setDialog(true)}
            >
              <RefreshIcon />
              {t('settings.preset.reload')}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => setDialog(true)}
            >
              {t('settings.preset.other')}
            </button>
          </>
        ) : (
          <>
            <div className="presetbody">
              <div className="fine">{t('settings.preset.label')}</div>
              <div className="dim">{t('settings.preset.none')}</div>
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => setDialog(true)}
            >
              {t('settings.preset.load')}
            </button>
          </>
        )}
      </div>
      {game && policy && (
        <div className="usage" data-testid="settings-policy">
          <Chip tone={policy.error ? 'warn' : undefined}>
            {t('settings.usage', {
              bytes: formatBytes(policy.bytes),
              limit: formatBytes(policy.limit),
            })}
          </Chip>
          <span className="meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (policy.bytes / policy.limit) * 100)}%` }} />
          </span>
        </div>
      )}
      {policy?.error && (
        <Note tone="warn" testId="settings-policy-error">
          <b>{t('settings.usage.error')}</b> {policy.error.message}
        </Note>
      )}
      {preset && preset.skippedConfigs.length > 0 && (
        <Note>{t('settings.preset.skipped', { count: preset.skippedConfigs.length })}</Note>
      )}
      <div className="tabs" role="tablist" aria-label={t('settings.tabs')}>
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: tab buttons
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
      {!loaded && settings.tab !== 'packs' && settings.tab !== 'shaders' ? (
        <section className="empty" data-testid="settings-empty">
          <span className="ic">
            <GamepadIcon />
          </span>
          <h2>{t('settings.empty.title')}</h2>
          <ol className="ol">
            <li>
              <b>1</b>
              <span>
                {t('settings.empty.1a')} <strong>{t('settings.empty.1b')}</strong>
                {t('settings.empty.1c')}
              </span>
            </li>
            <li>
              <b>2</b>
              <span>{t('settings.empty.2')}</span>
            </li>
          </ol>
          <button
            type="button"
            className="btn primary lg"
            disabled={busy}
            onClick={() => setDialog(true)}
          >
            {t('settings.preset.load')}
          </button>
        </section>
      ) : settings.tab === 'keys' || settings.tab === 'options' ? (
        <OptionsTab
          kind={settings.tab}
          options={game?.options ?? []}
          settings={settings}
          labels={labels}
          send={send}
          busy={busy}
        />
      ) : settings.tab === 'config' ? (
        <ConfigTab game={game} labels={labels} send={send} busy={busy} />
      ) : settings.tab === 'packs' ? (
        <PackTab
          kind="resourcepack"
          packs={game?.resourcePacks ?? []}
          labels={labels}
          send={send}
          busy={busy}
          sourceReady={!!state?.sourceName}
        />
      ) : (
        <ShadersTab
          game={game}
          labels={labels}
          send={send}
          busy={busy}
          sourceReady={!!state?.sourceName}
        />
      )}
      {dialog && (
        <PresetDialog
          busy={busy}
          onCancel={() => setDialog(false)}
          onImport={async (source) => {
            const ok = await studio.command({ action: 'settingsImport', source });
            if (ok) setDialog(false);
          }}
        />
      )}
    </>
  );
}

function OptionsTab({
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

function ItemRows({
  items,
  labels,
  busy,
  onChange,
}: {
  items: StudioConfigItem[];
  labels: Labels;
  busy: boolean;
  onChange(key: string, policy: SettingPolicyChoice): void;
}) {
  const { t } = useStudioLocale();
  return (
    <>
      {items.map((item) => (
        <div className="kr" key={item.key}>
          <span className="n">
            <strong>{item.key}</strong>
          </span>
          <span className="key">{item.value}</span>
          <PolicyControl
            value={item.policy}
            disabled={busy}
            onChange={(value) => onChange(item.key, value)}
            labels={labels}
            groupLabel={t('settings.policyOf', { name: item.key })}
          />
        </div>
      ))}
    </>
  );
}

function ConfigTab({
  game,
  labels,
  send,
  busy,
}: {
  game: StudioGameSettings | undefined;
  labels: Labels;
  send: Send;
  busy: boolean;
}) {
  const { t } = useStudioLocale();
  const files = game?.configFiles ?? [];
  return (
    <section className="card" data-testid="settings-config">
      <h2>{t('settings.config.title')}</h2>
      <p className="sub">{t('settings.config.sub')}</p>
      {files.length === 0 && <p className="empty-row">{t('settings.config.none')}</p>}
      {files.map((file) => (
        <div key={file.path}>
          <div className="grp">
            <span className="mono">{file.path}</span>
            <span className="grow" />
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy}
              aria-label={t('settings.config.remove', { path: file.path })}
              onClick={() => send({ action: 'settingsConfigRemove', path: file.path })}
            >
              {t('brand.remove')}
            </button>
          </div>
          <ItemRows
            items={file.items}
            labels={labels}
            busy={busy}
            onChange={(key, policy) =>
              send({
                action: 'settingsConfigItems',
                path: file.path,
                changes: [{ key, policy }],
              })
            }
          />
        </div>
      ))}
    </section>
  );
}

function PackHeader({
  title,
  sub,
  add,
  busy,
  disabled,
  onAdd,
}: {
  title: string;
  sub: string;
  add: string;
  busy: boolean;
  disabled: boolean;
  onAdd(): void;
}) {
  return (
    <div className="sechead">
      <div>
        <h2>{title}</h2>
        <p className="sub tight">{sub}</p>
      </div>
      <button
        type="button"
        className="btn sm"
        disabled={busy || disabled}
        data-testid="pack-add"
        onClick={onAdd}
      >
        <PlusIcon />
        {add}
      </button>
    </div>
  );
}

const packColors = ['#2f6b4f', '#4a4f8f', '#8f5a2f', '#7a4fa3', '#2f6b8f', '#8f4a4a'];
const packColor = (name: string) =>
  packColors[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % packColors.length];

function PackTab({
  kind,
  packs,
  labels,
  send,
  busy,
  sourceReady,
}: {
  kind: PackKind;
  packs: StudioPack[];
  labels: Labels;
  send: Send;
  busy: boolean;
  sourceReady: boolean;
}) {
  const { t } = useStudioLocale();
  return (
    <section className="card" data-testid="settings-packs">
      <PackHeader
        title={t('settings.packs.title')}
        sub={t('settings.packs.sub')}
        add={t('settings.packs.add')}
        busy={busy}
        disabled={!sourceReady}
        onAdd={() => send({ action: 'settingsPackAdd', kind })}
      />
      {!sourceReady && <p className="err">{t('settings.packs.needSource')}</p>}
      {packs.length === 0 && <p className="empty-row">{t('settings.packs.empty')}</p>}
      <div className="packlist">
        {packs.map((pack, index) => (
          <div className="pk" key={pack.name} data-testid="pack-row">
            <span className="ord">
              <button
                type="button"
                aria-label={t('settings.packs.up', { name: pack.name })}
                disabled={busy || index === 0}
                onClick={() =>
                  send({ action: 'settingsPackMove', kind, name: pack.name, index: index - 1 })
                }
              >
                <UpIcon />
              </button>
              <button
                type="button"
                aria-label={t('settings.packs.down', { name: pack.name })}
                disabled={busy || index === packs.length - 1}
                onClick={() =>
                  send({ action: 'settingsPackMove', kind, name: pack.name, index: index + 1 })
                }
              >
                <DownIcon />
              </button>
            </span>
            <span className="pic" style={{ background: packColor(pack.name) }} aria-hidden="true">
              {[...pack.name][0]?.toUpperCase()}
            </span>
            <span className="n">
              <strong>{pack.name}</strong>
              <small>{formatBytes(pack.length)}</small>
            </span>
            <PolicyControl
              value={pack.policy}
              disabled={busy}
              onChange={(policy) =>
                send({ action: 'settingsPackPolicy', kind, name: pack.name, policy })
              }
              labels={labels}
              groupLabel={t('settings.policyOf', { name: pack.name })}
            />
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy}
              aria-label={t('settings.packs.remove', { name: pack.name })}
              onClick={() => send({ action: 'settingsPackRemove', kind, name: pack.name })}
            >
              {t('brand.remove')}
            </button>
          </div>
        ))}
      </div>
      <p className="fine">{t('settings.packs.hint')}</p>
      <p className="fine">{t('settings.packs.removeNote')}</p>
    </section>
  );
}

function ShadersTab({
  game,
  labels,
  send,
  busy,
  sourceReady,
}: {
  game: StudioGameSettings | undefined;
  labels: Labels;
  send: Send;
  busy: boolean;
  sourceReady: boolean;
}) {
  const { t } = useStudioLocale();
  const [showOptions, setShowOptions] = useState(false);
  const packs = game?.shaderPacks ?? [];
  const shader: StudioShaderSettings | undefined = game?.shader;
  const enabled = shader?.enabled ?? { policy: 'none' as const, value: false };
  const selection = shader?.pack ?? { policy: 'none' as const, value: '' };
  const packOptions = shader?.packOptions.find((entry) => entry.pack === selection.value);
  const row = (id: string, title: string, help: string, control: ReactNode, policy: ReactNode) => (
    <div className="kr" key={id}>
      <span className="n">
        <strong>{title}</strong>
        <small>{help}</small>
      </span>
      {control}
      {policy}
    </div>
  );
  return (
    <>
      <div className="cols" data-testid="settings-shaders">
        <section className="card">
          <PackHeader
            title={t('settings.shaders.title')}
            sub={t('settings.shaders.sub')}
            add={t('settings.shaders.add')}
            busy={busy}
            disabled={!sourceReady}
            onAdd={() => send({ action: 'settingsPackAdd', kind: 'shaderpack' })}
          />
          {!sourceReady && <p className="err">{t('settings.packs.needSource')}</p>}
          {packs.length === 0 && <p className="empty-row">{t('settings.shaders.empty')}</p>}
          <div className="packlist" role="radiogroup" aria-label={t('settings.shaders.title')}>
            {packs.map((pack) => {
              const on = selection.value === pack.name;
              return (
                <div className={`pk${on ? ' on' : ''}`} key={pack.name} data-testid="shader-row">
                  {/* biome-ignore lint/a11y/useSemanticElements: radio-styled card */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${t('settings.shaders.pack')}: ${pack.name}`}
                    className="radbtn"
                    disabled={busy}
                    onClick={() =>
                      send({
                        action: 'settingsShader',
                        pack: { policy: selection.policy, value: pack.name },
                      })
                    }
                  >
                    <span className={`rad${on ? ' on' : ''}`} aria-hidden="true" />
                  </button>
                  <span
                    className="pic"
                    style={{ background: packColor(pack.name) }}
                    aria-hidden="true"
                  >
                    {[...pack.name][0]?.toUpperCase()}
                  </span>
                  <span className="n">
                    <strong>{pack.name}</strong>
                    <small>
                      {on ? `${t('settings.shaders.selected')} · ` : ''}
                      {formatBytes(pack.length)}
                    </small>
                  </span>
                  <PolicyControl
                    value={pack.policy}
                    disabled={busy}
                    onChange={(policy) =>
                      send({
                        action: 'settingsPackPolicy',
                        kind: 'shaderpack',
                        name: pack.name,
                        policy,
                      })
                    }
                    labels={labels}
                    groupLabel={t('settings.policyOf', { name: pack.name })}
                  />
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={busy}
                    aria-label={t('settings.packs.remove', { name: pack.name })}
                    onClick={() =>
                      send({ action: 'settingsPackRemove', kind: 'shaderpack', name: pack.name })
                    }
                  >
                    {t('brand.remove')}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card slimlist">
          {row(
            'configPath',
            t('settings.shaders.configPath'),
            shader?.configPath ?? 'config/iris.properties',
            <span className="seg">
              {(['config/iris.properties', 'config/oculus.properties'] as const).map((path) => (
                <button
                  key={path}
                  type="button"
                  className={
                    (shader?.configPath ?? 'config/iris.properties') === path ? 'on' : undefined
                  }
                  disabled={busy}
                  onClick={() => send({ action: 'settingsShader', configPath: path })}
                >
                  {path.includes('iris') ? 'Iris' : 'Oculus'}
                </button>
              ))}
            </span>,
            null,
          )}
          {row(
            'enabled',
            t('settings.shaders.enabled'),
            t('settings.shaders.enabledHelp'),
            <button
              type="button"
              className={`sw${enabled.value ? ' on' : ''}`}
              role="switch"
              aria-checked={enabled.value}
              aria-label={t('settings.shaders.enabled')}
              disabled={busy}
              onClick={() =>
                send({
                  action: 'settingsShader',
                  enabled: { policy: enabled.policy, value: !enabled.value },
                })
              }
            />,
            <PolicyControl
              value={enabled.policy}
              disabled={busy}
              onChange={(policy) =>
                send({ action: 'settingsShader', enabled: { policy, value: enabled.value } })
              }
              labels={labels}
              groupLabel={t('settings.policyOf', { name: t('settings.shaders.enabled') })}
            />,
          )}
          {row(
            'pack',
            t('settings.shaders.pack'),
            t('settings.shaders.packHelp', {
              name: selection.value || t('settings.shaders.packNone'),
            }),
            null,
            <PolicyControl
              value={selection.policy}
              disabled={busy}
              onChange={(policy) =>
                send({ action: 'settingsShader', pack: { policy, value: selection.value } })
              }
              labels={labels}
              groupLabel={t('settings.policyOf', { name: t('settings.shaders.pack') })}
            />,
          )}
          {row(
            'options',
            t('settings.shaders.options'),
            packOptions
              ? t('settings.shaders.optionsHelp', { count: packOptions.items.length })
              : t('settings.shaders.optionsNone'),
            <button
              type="button"
              className="btn sm"
              disabled={!packOptions}
              aria-expanded={showOptions}
              onClick={() => setShowOptions(!showOptions)}
            >
              {showOptions ? t('settings.shaders.hide') : t('settings.shaders.view')}
            </button>,
            null,
          )}
          {showOptions && packOptions && (
            <div data-testid="shader-options">
              <ItemRows
                items={packOptions.items}
                labels={labels}
                busy={busy}
                onChange={(key, policy) =>
                  send({
                    action: 'settingsShaderOptions',
                    pack: packOptions.pack,
                    changes: [{ key, policy }],
                  })
                }
              />
            </div>
          )}
        </section>
      </div>
      <Note tone="warn">
        <b>{t('settings.shaders.warn.title')}</b> {t('settings.shaders.warn.body')}
      </Note>
    </>
  );
}

function PresetDialog({
  busy,
  onCancel,
  onImport,
}: {
  busy: boolean;
  onCancel(): void;
  onImport(source: 'folder' | 'file'): void;
}) {
  const { t } = useStudioLocale();
  return (
    <Modal titleId="preset-title" testId="preset-dialog" className="wide" onCancel={onCancel}>
      <h2 id="preset-title">{t('settings.dialog.title')}</h2>
      <p className="lead">
        {t('settings.dialog.lead1')} <b>{t('settings.dialog.lead2')}</b>{' '}
        {t('settings.dialog.lead3')}
      </p>
      <button
        type="button"
        className="big p dlgbtn"
        disabled={busy}
        data-autofocus
        data-testid="import-folder"
        onClick={() => onImport('folder')}
      >
        <span className="ic">
          <FolderIcon />
        </span>
        <span>
          <strong>{t('settings.dialog.folder')}</strong>
          <small>{t('settings.dialog.folderHelp')}</small>
        </span>
      </button>
      <div className="or">{t('settings.dialog.or')}</div>
      <button
        type="button"
        className="big dlgbtn"
        disabled={busy}
        data-testid="import-file"
        onClick={() => onImport('file')}
      >
        <span className="ic">
          <GamepadIcon />
        </span>
        <span>
          <strong>{t('settings.dialog.file')}</strong>
          <small>{t('settings.dialog.fileHelp')}</small>
        </span>
      </button>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
