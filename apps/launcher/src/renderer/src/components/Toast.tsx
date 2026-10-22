import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

export const toastDurationMs = { success: 2500, error: 4000 } as const;

/** Timer logic kept free of React so replacement and cleanup can be tested with fake timers. */
export function createToastController(set: (toast: ToastMessage | null) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let next = 0;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    show(kind: ToastMessage['kind'], text: string) {
      clear();
      const id = ++next;
      set({ id, kind, text });
      timer = setTimeout(() => {
        timer = undefined;
        set(null);
      }, toastDurationMs[kind]);
    },
    dispose: clear,
  };
}

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const controller = useRef<ReturnType<typeof createToastController> | null>(null);
  const get = useCallback(() => {
    controller.current ??= createToastController(setToast);
    return controller.current;
  }, []);
  useEffect(() => () => get().dispose(), [get]);
  const notify = useCallback(
    (kind: ToastMessage['kind'], text: string) => get().show(kind, text),
    [get],
  );
  return useMemo(() => ({ toast, notify }), [toast, notify]);
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  // Keep both live regions mounted so assistive technology announces content changes.
  return (
    <div className="toast-host">
      <div role="status" aria-live="polite" data-testid="toast-status">
        {toast?.kind === 'success' && (
          <div key={toast.id} className="toast" data-testid="toast">
            {toast.text}
          </div>
        )}
      </div>
      <div role="alert" data-testid="toast-alert">
        {toast?.kind === 'error' && (
          <div key={toast.id} className="toast error" data-testid="toast">
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}
