import { useEffect, useState } from 'react';

/** Milliseconds since `active` last became true, as observed by this renderer. */
export function useElapsed(active: boolean, now: () => number = Date.now): number {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      return;
    }
    const start = now();
    setStartedAt(start);
    setCurrent(start);
    const timer = setInterval(() => setCurrent(now()), 1000);
    return () => clearInterval(timer);
  }, [active, now]);
  return active && startedAt !== null ? Math.max(0, current - startedAt) : 0;
}
