import type { PackKind, StudioPack } from '../../../../shared/studio.js';
import { PageHeader, PolicyControl } from '../../components/ui';
import { formatBytes } from '../../format';
import { useStudioLocale } from '../../i18n';
import type { PageProps } from '../types';
import { ModConfigSection } from './ModSettingsPage';
import { type Labels, PackHeader, PolicyUsage, packColor, type Send } from './shared';

export function ModsPage(props: PageProps) {
  const { studio, draft } = props;
  const { t } = useStudioLocale();
  const { state, busy } = studio;
  const modLabels: Labels = {
    none: t('mods.policy.exclude'),
    initial: t('mods.policy.initial'),
    required: t('mods.policy.always'),
  };
  const send: Send = (request) => void studio.command(request);
  const mods = draft.gameSettings?.mods ?? [];

  return (
    <>
      <PageHeader eyebrow={t('mods.eyebrow')} title={t('mods.title')} lead={t('mods.lead')} />
      <PolicyUsage policy={draft.gameSettings ? (state?.policy ?? null) : null} />
      <section className="card" data-testid="settings-mods">
        <PackHeader
          title={t('mods.manage.title')}
          sub={t('mods.manage.sub')}
          add={t('mods.add')}
          busy={busy}
          disabled={!state?.sourceName}
          onAdd={() => send({ action: 'settingsPackAdd', kind: 'mod' })}
        />
        {!state?.sourceName && <p className="err">{t('mods.needSource')}</p>}
        {mods.length === 0 && <p className="empty-row">{t('mods.empty')}</p>}
        <div className="packlist">
          {mods.map((mod) => (
            <ModRow
              key={mod.name}
              kind="mod"
              mod={mod}
              labels={modLabels}
              busy={busy}
              send={send}
            />
          ))}
        </div>
        <p className="fine">{t('mods.removeNote')}</p>
      </section>
      <ModConfigSection {...props} />
    </>
  );
}

function ModRow({
  kind,
  mod,
  labels,
  busy,
  send,
}: {
  kind: PackKind;
  mod: StudioPack;
  labels: Labels;
  busy: boolean;
  send: Send;
}) {
  const { t } = useStudioLocale();
  return (
    <div className="pk" data-testid="mod-row">
      <span className="pic" style={{ background: packColor(mod.name) }} aria-hidden="true">
        {[...mod.name][0]?.toUpperCase()}
      </span>
      <span className="n">
        <strong>{mod.name}</strong>
        <small>{formatBytes(mod.length)}</small>
      </span>
      <PolicyControl
        value={mod.policy}
        disabled={busy}
        onChange={(policy) => send({ action: 'settingsPackPolicy', kind, name: mod.name, policy })}
        labels={labels}
        groupLabel={t('settings.policyOf', { name: mod.name })}
      />
      <button
        type="button"
        className="btn sm ghost"
        disabled={busy}
        aria-label={t('settings.packs.remove', { name: mod.name })}
        onClick={() => send({ action: 'settingsPackRemove', kind, name: mod.name })}
      >
        {t('brand.remove')}
      </button>
    </div>
  );
}
