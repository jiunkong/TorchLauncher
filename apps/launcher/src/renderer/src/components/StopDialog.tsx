import { type KeyboardEvent, useEffect, useRef } from 'react';
import { useT } from '../hooks/useTranslator';

/** Modal confirmation before stopping a running game; focus starts on the safe choice. */
export function StopDialog({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Tab') {
      const first = cancel.current;
      const last = confirm.current;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <div className="scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-title"
        aria-describedby="stop-body"
        data-testid="stop-dialog"
        onKeyDown={onKeyDown}
      >
        <h2 id="stop-title">{t('stop.title')}</h2>
        <p id="stop-body">{t('stop.body')}</p>
        <div className="dialog-actions">
          <button ref={cancel} className="btn" type="button" onClick={onCancel}>
            {t('home.cancel')}
          </button>
          <button
            ref={confirm}
            className="btn solid-danger"
            type="button"
            data-testid="stop-confirm"
            onClick={onConfirm}
          >
            {t('home.stop')}
          </button>
        </div>
      </div>
    </div>
  );
}
