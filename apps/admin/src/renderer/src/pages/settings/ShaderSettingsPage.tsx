import { type ReactNode, useState } from 'react';
import type { StudioGameSettings, StudioShaderSettings } from '../../../../shared/studio.js';
import { FolderIcon } from '../../components/Icons';
import { Note, PageHeader, PolicyControl } from '../../components/ui';
import { formatBytes } from '../../format';
import { useStudioLocale } from '../../i18n';
import type { PageProps } from '../types';
import {
  ItemRows,
  type Labels,
  PackHeader,
  PolicyUsage,
  PresetDialog,
  packColor,
  type Send,
  usePolicyLabels,
} from './shared';

export function ShaderSettingsPage({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const [dialog, setDialog] = useState(false);
  const labels = usePolicyLabels();
  const send: Send = (request) => void studio.command(request);
  return (
    <>
      <PageHeader eyebrow={t('settings.shaders.eyebrow')} title={t('settings.shaders.title')} />
      <PolicyUsage policy={draft.gameSettings ? (state?.policy ?? null) : null} />
      <ShadersTab
        game={draft.gameSettings}
        labels={labels}
        send={send}
        busy={busy}
        sourceReady={!!state?.sourceName}
      />
      <button className="btn sm" type="button" disabled={busy} onClick={() => setDialog(true)}>
        <FolderIcon />
        {t('settings.dialog.folderAction')}
      </button>
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
