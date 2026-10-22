import { useT } from '../hooks/useTranslator';
import { Modal } from './Modal';

export function RemoveUnregisteredDialog({
  path,
  disabled,
  onCancel,
  onConfirm,
}: {
  path: string;
  disabled: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const t = useT();
  return (
    <Modal
      titleId="remove-file-title"
      bodyId="remove-file-body"
      testId="remove-file-dialog"
      onCancel={onCancel}
    >
      <h2 id="remove-file-title">{t('mods.removeFileTitle')}</h2>
      <p id="remove-file-body">{t('mods.removeFileBody')}</p>
      <p className="mono selectable path">{path}</p>
      <div className="dialog-actions">
        <button className="btn" type="button" data-autofocus onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          className="btn solid-danger"
          type="button"
          disabled={disabled}
          data-testid="remove-file-confirm"
          onClick={onConfirm}
        >
          {t('mods.remove')}
        </button>
      </div>
    </Modal>
  );
}
