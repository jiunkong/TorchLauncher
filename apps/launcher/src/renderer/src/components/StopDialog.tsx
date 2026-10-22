import { useT } from '../hooks/useTranslator';
import { Modal } from './Modal';

/** Modal confirmation before stopping a running game; focus starts on the safe choice. */
export function StopDialog({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  const t = useT();
  return (
    <Modal titleId="stop-title" bodyId="stop-body" testId="stop-dialog" onCancel={onCancel}>
      <h2 id="stop-title">{t('stop.title')}</h2>
      <p id="stop-body">{t('stop.body')}</p>
      <div className="dialog-actions">
        <button className="btn" type="button" data-autofocus onClick={onCancel}>
          {t('home.cancel')}
        </button>
        <button
          className="btn solid-danger"
          type="button"
          data-testid="stop-confirm"
          onClick={onConfirm}
        >
          {t('home.stop')}
        </button>
      </div>
    </Modal>
  );
}
