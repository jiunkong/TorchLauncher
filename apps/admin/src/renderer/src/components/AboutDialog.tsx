import { useStudioLocale } from '../i18n';
import { Modal } from './Modal';

/** Application name, version and platform (from the existing application info). */
export function AboutDialog({
  version,
  platform,
  onClose,
}: {
  version: string | null;
  platform: string | null;
  onClose(): void;
}) {
  const { t } = useStudioLocale();
  return (
    <Modal titleId="about-title" testId="about-dialog" onCancel={onClose}>
      <h2 id="about-title">{t('about.title')}</h2>
      <p className="about-name">TorchLauncher Studio</p>
      <div className="kv">
        <span>{t('about.version')}</span>
        <span data-testid="about-version">{version ? `v${version}` : '—'}</span>
      </div>
      <div className="kv">
        <span>{t('about.platform')}</span>
        <span data-testid="about-platform">{platform ?? '—'}</span>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn primary" data-autofocus onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
