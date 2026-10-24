import type { PackKind, StudioPack } from '../../../../shared/studio.js';
import { DownIcon, UpIcon } from '../../components/Icons';
import { PageHeader, PolicyControl } from '../../components/ui';
import { formatBytes } from '../../format';
import { useStudioLocale } from '../../i18n';
import type { PageProps } from '../types';
import {
  type Labels,
  PackHeader,
  PolicyUsage,
  packColor,
  type Send,
  usePolicyLabels,
} from './shared';

export function PackSettingsPage({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const labels = usePolicyLabels();
  const send: Send = (request) => void studio.command(request);
  return (
    <>
      <PageHeader eyebrow={t('settings.packs.eyebrow')} title={t('settings.packs.title')} />
      <PolicyUsage policy={draft.gameSettings ? (state?.policy ?? null) : null} />
      <PackTab
        kind="resourcepack"
        packs={draft.gameSettings?.resourcePacks ?? []}
        labels={labels}
        send={send}
        busy={busy}
        sourceReady={!!state?.sourceName}
      />
    </>
  );
}

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
