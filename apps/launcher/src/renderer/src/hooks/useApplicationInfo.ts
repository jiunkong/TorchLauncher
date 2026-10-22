import type { ApplicationInfo } from '@torchlauncher/core/desktop';
import { useEffect, useState } from 'react';

export function useApplicationInfo() {
  const [info, setInfo] = useState<ApplicationInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    window.torchlauncher.getApplicationInfo().then(
      (result) => {
        if (active) setInfo(result);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return { info, error };
}
