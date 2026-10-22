import { Modal } from './Modal';

/** Generic in-app confirmation; focus starts on cancel and the command runs only via `onConfirm`. */
export function ConfirmDialog({
  idPrefix,
  title,
  body,
  cancelLabel,
  confirmLabel,
  danger = false,
  disabled = false,
  onCancel,
  onConfirm,
}: {
  idPrefix: string;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Modal
      titleId={`${idPrefix}-title`}
      bodyId={`${idPrefix}-body`}
      testId={`${idPrefix}-dialog`}
      onCancel={onCancel}
    >
      <h2 id={`${idPrefix}-title`}>{title}</h2>
      <p id={`${idPrefix}-body`} className="selectable">
        {body}
      </p>
      <div className="dialog-actions">
        <button className="btn" type="button" data-autofocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          className={danger ? 'btn solid-danger' : 'btn primary'}
          type="button"
          disabled={disabled}
          data-testid={`${idPrefix}-confirm`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
