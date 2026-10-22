import { useEffect, useState } from 'react';
import type { BrandingSnapshot } from '../../../shared/branding';

const initial: BrandingSnapshot = {
  revision: 0,
  appName: 'TorchLauncher',
  icon: null,
  background: null,
};
export function useBranding(): BrandingSnapshot {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    let active = true;
    const apply = (next: BrandingSnapshot) => {
      if (active) setSnapshot((previous) => (next.revision >= previous.revision ? next : previous));
    };
    const unsubscribe = window.torchlauncher.onBranding?.(apply);
    void window.torchlauncher
      .getBranding?.()
      .then(apply)
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return snapshot;
}
