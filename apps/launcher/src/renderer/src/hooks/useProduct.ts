import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';

export function useProduct() {
  const [state, setState] = useState<ProductState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const memoryInFlight = useRef(false);
  const pendingCount = useRef(0);
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = window.torchlauncher.onState((next) => {
      received = true;
      if (active) setState(next);
    });
    void window.torchlauncher.getState().then(
      (next) => {
        if (active && !received) setState(next);
      },
      () => {
        if (active) setError('런처 서비스에 연결하지 못했습니다.');
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const command = useCallback(async (request: ProductCommand): Promise<boolean> => {
    const isControl = request.type === 'cancel' || request.type === 'stop';
    const isMemorySave = request.type === 'set-game-memory';
    if (
      (!isMemorySave && inFlight.current && !isControl) ||
      (isMemorySave && memoryInFlight.current)
    ) {
      setError('busy');
      return false;
    }
    if (!isControl && !isMemorySave) {
      inFlight.current = true;
    }
    if (isMemorySave) memoryInFlight.current = true;
    if (!isControl) {
      pendingCount.current++;
      setPending(true);
    }
    setError(null);
    try {
      const result = await window.torchlauncher.command(request);
      setState(result.state);
      if (!result.ok) setError(result.error);
      return result.ok;
    } catch {
      setError('런처 요청을 처리하지 못했습니다.');
      return false;
    } finally {
      if (!isControl) {
        if (!isMemorySave) inFlight.current = false;
        if (isMemorySave) memoryInFlight.current = false;
        pendingCount.current--;
        setPending(pendingCount.current > 0);
      }
    }
  }, []);
  return { state, error, pending, command };
}
