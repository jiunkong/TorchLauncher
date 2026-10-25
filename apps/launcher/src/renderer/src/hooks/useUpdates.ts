import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateCommand, UpdateState } from '../../../shared/updates';
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    let live = true;
    let received = false;
    const unsubscribe = window.torchlauncher.onUpdate((next) => {
      received = true;
      if (live) setState(next);
    });
    void window.torchlauncher.getUpdateState().then(
      (next) => {
        if (live && !received) setState(next);
      },
      () => {
        if (live && !received) setState({ phase: 'error', code: 'UNAVAILABLE' });
      },
    );
    return () => {
      live = false;
      active.current = false;
      unsubscribe();
    };
  }, []);
  const command = useCallback(async (request: UpdateCommand) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const next = await window.torchlauncher.update(request);
      if (active.current) setState(next);
    } catch {
      if (active.current) setState({ phase: 'error', code: 'UNAVAILABLE' });
    } finally {
      inFlight.current = false;
      if (active.current) setPending(false);
    }
  }, []);
  return { state, pending, command };
}
