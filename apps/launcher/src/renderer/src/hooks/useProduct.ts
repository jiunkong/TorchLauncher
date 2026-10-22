import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';

export function useProduct() {
  const [state, setState] = useState<ProductState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
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
    if (inFlight.current && !isControl) {
      setError('busy');
      return false;
    }
    if (!isControl) {
      inFlight.current = true;
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
        inFlight.current = false;
        setPending(false);
      }
    }
  }, []);
  return { state, error, pending, command };
}
