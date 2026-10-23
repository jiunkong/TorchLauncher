import { useId, useState } from 'react';
import {
  CheckIcon,
  DownIcon,
  GamepadIcon,
  PlusIcon,
  RefreshIcon,
  UpIcon,
} from '../components/Icons';
import { Modal } from '../components/Modal';
import { Checkbox, Chip, Note, PageHeader, type Policy3, PolicyControl } from '../components/ui';
import { useStudioLocale } from '../i18n';
import {
  type KeyEntry,
  sampleKeys,
  sampleOptions,
  samplePacks,
  samplePresetSource,
  sampleShaderOptionCount,
  sampleShaders,
} from '../settings/fixtures';
import { matchesKey, type SettingsState, type SettingsTab } from '../settings/state';

const tabs: SettingsTab[] = ['keys', 'options', 'packs', 'shaders'];

export function SettingsPage({ settings }: { settings: SettingsState }) {
  const { t } = useStudioLocale();
  const [dialog, setDialog] = useState(false);
  const labels: Record<Policy3, string> = {
    none: t('settings.policy.none'),
    initial: t('settings.policy.initial'),
    required: t('settings.policy.required'),
  };
  const tabLabel: Record<SettingsTab, string> = {
    keys: t('settings.tab.keys'),
    options: t('settings.tab.options'),
    packs: t('settings.tab.packs'),
    shaders: t('settings.tab.shaders'),
  };
  const policy = (id: string, name: string) => (
    <PolicyControl
      value={settings.policyOf(id)}
      onChange={(value) => settings.setPolicy([id], value)}
      labels={labels}
      groupLabel={t('settings.policyOf', { name })}
    />
  );

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        lead={t('settings.lead')}
      />
      <div className="preset" data-testid="settings-preset" data-loaded={settings.loaded}>
        {settings.loaded ? (
          <>
            <span className="ic2">
              <CheckIcon />
            </span>
            <div className="presetbody">
              <div className="fine">
                {t('settings.preset.loaded', {
                  keys: samplePresetSource.keyCount,
                  mods: samplePresetSource.modKeyCount,
                })}
              </div>
              <div className="mono">{samplePresetSource.files.join(', ')}</div>
            </div>
            <Chip>{t('settings.sample')}</Chip>
            <button type="button" className="btn sm" onClick={() => setDialog(true)}>
              <RefreshIcon />
              {t('settings.preset.reload')}
            </button>
            <button type="button" className="btn sm" onClick={() => setDialog(true)}>
              {t('settings.preset.other')}
            </button>
          </>
        ) : (
          <>
            <div className="presetbody">
              <div className="fine">{t('settings.preset.label')}</div>
              <div className="dim">{t('settings.preset.none')}</div>
            </div>
            <button type="button" className="btn primary" onClick={() => setDialog(true)}>
              {t('settings.preset.load')}
            </button>
          </>
        )}
      </div>
      <TabBar
        tabs={tabs}
        labels={tabLabel}
        value={settings.tab}
        onChange={settings.setTab}
        label={t('settings.tabs')}
      />
      {!settings.loaded ? (
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
          <button type="button" className="btn primary lg" onClick={() => setDialog(true)}>
            {t('settings.preset.load')}
          </button>
        </section>
      ) : settings.tab === 'keys' ? (
        <KeysTab settings={settings} labels={labels} />
      ) : settings.tab === 'options' ? (
        <section className="card">
          <h2>{t('settings.options.title')}</h2>
          <p className="sub">{t('settings.options.sub')}</p>
          <div className="optlist">
            {sampleOptions.map((option) => (
              <div className="kr" key={option.id}>
                <span className="n">
                  <strong>{option.name}</strong>
                  <small>{option.id}</small>
                </span>
                <span className="key">{option.value}</span>
                {policy(option.id, option.name)}
              </div>
            ))}
          </div>
        </section>
      ) : settings.tab === 'packs' ? (
        <section className="card">
          <div className="sechead">
            <div>
              <h2>{t('settings.packs.title')}</h2>
              <p className="sub tight">{t('settings.packs.sub')}</p>
            </div>
            <button type="button" className="btn sm" disabled title={t('settings.unavailable')}>
              <PlusIcon />
              {t('settings.packs.add')}
            </button>
          </div>
          <div className="packlist">
            {settings.packOrder.map((id, index) => {
              const pack = samplePacks.find((item) => item.id === id);
              if (!pack) return null;
              return (
                <div className="pk" key={id}>
                  <span className="ord">
                    <button
                      type="button"
                      aria-label={t('settings.packs.up', { name: pack.file })}
                      disabled={index === 0}
                      onClick={() => settings.movePack(id, -1)}
                    >
                      <UpIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={t('settings.packs.down', { name: pack.file })}
                      disabled={index === settings.packOrder.length - 1}
                      onClick={() => settings.movePack(id, 1)}
                    >
                      <DownIcon />
                    </button>
                  </span>
                  <span className="pic" style={{ background: pack.color }} aria-hidden="true">
                    {pack.initial}
                  </span>
                  <span className="n">
                    <strong>{pack.file}</strong>
                    <small>
                      {pack.note} · {pack.size}
                    </small>
                  </span>
                  {policy(`resourcepack:${id}`, pack.file)}
                </div>
              );
            })}
          </div>
          <p className="fine">{t('settings.packs.hint')}</p>
        </section>
      ) : (
        <ShadersTab settings={settings} labels={labels} />
      )}
      {dialog && (
        <PresetDialog
          onCancel={() => setDialog(false)}
          onLoad={() => {
            settings.load();
            setDialog(false);
          }}
        />
      )}
    </>
  );
}

function TabBar({
  tabs: items,
  labels,
  value,
  onChange,
  label,
}: {
  tabs: SettingsTab[];
  labels: Record<SettingsTab, string>;
  value: SettingsTab;
  onChange(tab: SettingsTab): void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={value === item}
          className={`tab${value === item ? ' on' : ''}`}
          onClick={() => onChange(item)}
        >
          {labels[item]}
        </button>
      ))}
    </div>
  );
}

function KeysTab({
  settings,
  labels,
}: {
  settings: SettingsState;
  labels: Record<Policy3, string>;
}) {
  const { t } = useStudioLocale();
  const searchId = useId();
  const { search, filter, selected } = settings;
  const visible = sampleKeys.filter((entry) =>
    matchesKey(entry, search, filter, settings.policyOf(entry.id)),
  );
  const groups = [...new Set(visible.map((entry) => entry.group))];
  const chosen = visible.filter((entry) => selected.has(entry.id)).map((entry) => entry.id);
  const chosenPolicies = new Set(chosen.map((id) => settings.policyOf(id)));
  const common = chosenPolicies.size === 1 ? ([...chosenPolicies][0] ?? null) : null;
  const count = (predicate: (entry: KeyEntry) => boolean) => sampleKeys.filter(predicate).length;
  const chips = [
    ['all', t('settings.keys.all', { count: sampleKeys.length })],
    ['base', t('settings.keys.base', { count: count((entry) => !entry.mod) })],
    ['mod', t('settings.keys.mod', { count: count((entry) => entry.mod) })],
    [
      'set',
      t('settings.keys.set', { count: count((entry) => settings.policyOf(entry.id) !== 'none') }),
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
            onChange={(value) => settings.setPolicy(chosen, value)}
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
        {chips.map(([id, text]) => (
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
          onClick={() => settings.setSelected(new Set(visible.map((entry) => entry.id)))}
        >
          {t('settings.keys.selectVisible')}
        </button>
      </div>
      <div className="keylist" data-testid="settings-keys">
        {visible.length === 0 && <p className="empty-row">{t('settings.keys.noMatch')}</p>}
        {groups.map((group) => {
          const rows = visible.filter((entry) => entry.group === group);
          const modGroup = rows.some((entry) => entry.mod);
          return (
            <div key={group || 'other'}>
              <div className="grp">
                {group || t('settings.keys.otherMods')}
                {modGroup && <Chip>{t('settings.keys.modChip')}</Chip>}
              </div>
              {rows.map((entry) => {
                const name = entry.name ?? entry.id;
                return (
                  <div
                    className={`kr${selected.has(entry.id) ? ' sel' : ''}`}
                    key={entry.id}
                    data-testid="settings-key-row"
                  >
                    <Checkbox
                      checked={selected.has(entry.id)}
                      label={t('settings.keys.select', { name })}
                      onChange={(on) => settings.toggle(entry.id, on)}
                    />
                    <span className="n">
                      <strong>{name}</strong>
                      <small>{entry.name ? entry.id : t('settings.keys.unknownName')}</small>
                    </span>
                    <span className="key">{entry.value}</span>
                    <PolicyControl
                      value={settings.policyOf(entry.id)}
                      onChange={(value) => settings.setPolicy([entry.id], value)}
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

function ShadersTab({
  settings,
  labels,
}: {
  settings: SettingsState;
  labels: Record<Policy3, string>;
}) {
  const { t } = useStudioLocale();
  const selected = sampleShaders.find((item) => item.id === settings.shader);
  const row = (id: string, title: string, help: string, extra?: React.ReactNode) => (
    <div className="kr" key={id}>
      <span className="n">
        <strong>{title}</strong>
        <small>{help}</small>
      </span>
      {extra}
      <PolicyControl
        value={settings.policyOf(id)}
        onChange={(value) => settings.setPolicy([id], value)}
        labels={labels}
        groupLabel={t('settings.policyOf', { name: title })}
      />
    </div>
  );
  return (
    <>
      <div className="cols">
        <section className="card">
          <div className="sechead">
            <div>
              <h2>{t('settings.shaders.title')}</h2>
              <p className="sub tight">{t('settings.shaders.sub')}</p>
            </div>
            <button type="button" className="btn sm" disabled title={t('settings.unavailable')}>
              <PlusIcon />
              {t('settings.shaders.add')}
            </button>
          </div>
          <div className="packlist" role="radiogroup" aria-label={t('settings.shaders.title')}>
            {sampleShaders.map((shader) => (
              // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
              <button
                key={shader.id}
                type="button"
                role="radio"
                aria-checked={settings.shader === shader.id}
                className={`pk pick${settings.shader === shader.id ? ' on' : ''}`}
                onClick={() => settings.setShader(shader.id)}
              >
                <span
                  className={`rad${settings.shader === shader.id ? ' on' : ''}`}
                  aria-hidden="true"
                />
                <span className="pic" style={{ background: shader.color }} aria-hidden="true">
                  {shader.initial}
                </span>
                <span className="n">
                  <strong>{shader.file}</strong>
                  <small>
                    {settings.shader === shader.id ? `${t('settings.shaders.default')} · ` : ''}
                    {shader.size}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="card slimlist">
          {row(
            'shader:enabled',
            t('settings.shaders.enabled'),
            t('settings.shaders.enabledHelp'),
            <button
              type="button"
              className={`sw${settings.shaderEnabled ? ' on' : ''}`}
              role="switch"
              aria-checked={settings.shaderEnabled}
              aria-label={t('settings.shaders.enabled')}
              onClick={() => settings.setShaderEnabled(!settings.shaderEnabled)}
            />,
          )}
          {row(
            'shader:pack',
            t('settings.shaders.pack'),
            t('settings.shaders.packHelp', { name: selected?.file ?? '—' }),
          )}
          {row(
            'shader:options',
            t('settings.shaders.options'),
            t('settings.shaders.optionsHelp', { count: sampleShaderOptionCount }),
            <button type="button" className="btn sm" disabled title={t('settings.unavailable')}>
              {t('settings.shaders.view')}
            </button>,
          )}
        </section>
      </div>
      <Note tone="warn">
        <b>{t('settings.shaders.warn.title')}</b> {t('settings.shaders.warn.body')}
      </Note>
    </>
  );
}

function PresetDialog({ onCancel, onLoad }: { onCancel(): void; onLoad(): void }) {
  const { t } = useStudioLocale();
  return (
    <Modal titleId="preset-title" testId="preset-dialog" className="wide" onCancel={onCancel}>
      <h2 id="preset-title">{t('settings.dialog.title')}</h2>
      <p className="lead">
        {t('settings.dialog.lead1')} <b>{t('settings.dialog.lead2')}</b>{' '}
        {t('settings.dialog.lead3')}
      </p>
      <div className="fld">
        <span className="lbl">{t('settings.dialog.folder')}</span>
        <div className="folderrow">
          <div className="inp mono grow">{t('settings.dialog.folderNone')}</div>
          <button type="button" className="btn" disabled title={t('settings.unavailable')}>
            {t('settings.dialog.pick')}
          </button>
        </div>
      </div>
      <Note tone="ok">
        <b>{t('settings.dialog.found')}</b> {samplePresetSource.files.join(' · ')}
        <br />
        {t('settings.dialog.counts', {
          keys: samplePresetSource.keyCount,
          mods: samplePresetSource.modKeyCount,
        })}
      </Note>
      <p className="fine">{t('settings.dialog.sampleNote')}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" data-autofocus onClick={onLoad}>
          {t('settings.dialog.load')}
        </button>
      </div>
    </Modal>
  );
}
