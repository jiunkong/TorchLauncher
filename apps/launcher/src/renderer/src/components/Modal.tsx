import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

const focusable =
  'button:not(:disabled), input:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal: focus starts on `[data-autofocus]` (or the first control), Tab stays inside,
 * Escape cancels, and focus returns to the previously focused element on close.
 */
export function Modal({
  titleId,
  bodyId,
  testId,
  className = '',
  onCancel,
  children,
}: {
  titleId: string;
  bodyId?: string;
  testId: string;
  className?: string;
  onCancel(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const initial =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(focusable);
    initial?.focus();
    return () => previous?.focus?.();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="scrim">
      <div
        ref={dialog}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid={testId}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
