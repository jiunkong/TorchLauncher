import { useStudioLocale } from '../i18n';
import { Modal } from './Modal';

/** In-app replacement for a native "discard changes?" box. */
export function UnsavedDialog({
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  busy: boolean;
  onSave(): void;
  onDiscard(): void;
  onCancel(): void;
}) {
  const { t } = useStudioLocale();
  return (
    <Modal titleId="unsaved-title" testId="unsaved-dialog" onCancel={onCancel}>
      <h2 id="unsaved-title">{t('unsaved.title')}</h2>
      <p>{t('unsaved.body')}</p>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={onDiscard}>
          {t('unsaved.discard')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          data-autofocus
          disabled={busy}
          onClick={onSave}
        >
          {t('unsaved.save')}
        </button>
      </div>
    </Modal>
  );
}
