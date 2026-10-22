import { useState } from 'react';
import { useT } from '../hooks/useTranslator';
import { Modal } from './Modal';

/** "Previous run" confirmation: the cleanup button stays disabled until the box is checked. */
export function RecoveryDialog({
  busy,
  onLater,
  onConfirm,
}: {
  busy: boolean;
  onLater(): void;
  onConfirm(): void;
}) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      titleId="recovery-title"
      bodyId="recovery-body"
      testId="recovery-dialog"
      className="medium"
      onCancel={onLater}
    >
      <h2 id="recovery-title">{t('recovery.title')}</h2>
      <p id="recovery-body">{t('recovery.body')}</p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="recovery-check"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>{t('recovery.check')}</span>
      </label>
      <div className="dialog-actions">
        <button className="btn" type="button" data-autofocus onClick={onLater}>
          {t('recovery.later')}
        </button>
        <button
          className="btn primary"
          type="button"
          data-testid="recovery-confirm"
          disabled={!checked || busy}
          onClick={onConfirm}
        >
          {t('recovery.confirm')}
        </button>
      </div>
    </Modal>
  );
}
