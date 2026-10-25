import type { StudioPack } from '../../../../shared/studio.js';
import { PageHeader } from '../../components/ui';
import { formatBytes } from '../../format';
import { useStudioLocale } from '../../i18n';
import type { PageProps } from '../types';
import { ModConfigSection } from './ModSettingsPage';
import { PackHeader, PolicyUsage, packColor, type Send } from './shared';

export function ModsPage(props: PageProps) {
  const { studio, draft } = props;
  const { t } = useStudioLocale();
  const { state, busy } = studio;
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
          disabled={busy || !state?.project}
          onAdd={() => send({ action: 'settingsPackAdd', kind: 'mod' })}
        />
        {mods.length === 0 && <p className="empty-row">{t('mods.empty')}</p>}
        <div className="packlist">
          {mods.map((mod) => (
            <ModRow key={mod.name} mod={mod} busy={busy} send={send} />
          ))}
        </div>
        <p className="fine">{t('mods.removeNote')}</p>
      </section>
      <ModConfigSection {...props} />
    </>
  );
}

function ModRow({ mod, busy, send }: { mod: StudioPack; busy: boolean; send: Send }) {
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
      <button
        type="button"
        className="btn sm ghost"
        disabled={busy}
        aria-label={t('settings.packs.remove', { name: mod.name })}
        onClick={() => send({ action: 'settingsPackRemove', kind: 'mod', name: mod.name })}
      >
        {t('brand.remove')}
      </button>
    </div>
  );
}
