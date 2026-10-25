import { useEffect, useState } from 'react';
import type { StudioBrandingImage, StudioError } from '../../../shared/studio.js';

type Role = 'icon' | 'background';
const cache = new Map<string, StudioBrandingImage>();
const CACHE_MAX = 8;

export interface BrandingImageView {
  /** The preview data URL of the current image, or of the previous one until the new one arrives. */
  dataUrl: string | null;
  /** Why the current image's preview could not be loaded. */
  failure: StudioError | null;
}

/**
 * Loads the downscaled preview of a chosen branding image from main. Requested only when the
 * asset's sha256 changes and cached by it, so state broadcasts never carry image data. The previous
 * image stays until its replacement arrives (no flash of the default art); a removed image clears.
 */
export function useBrandingImage(role: Role, sha256: string | null): BrandingImageView {
  const [shown, setShown] = useState<{ sha256: string; dataUrl: string } | null>(null);
  const [failed, setFailed] = useState<{ sha256: string; code: StudioError } | null>(null);
  useEffect(() => {
    if (!sha256) {
      setShown(null);
      setFailed(null);
      return;
    }
    const key = `${role}:${sha256}`;
    const hit = cache.get(key);
    if (hit) {
      setShown({ sha256, dataUrl: hit.dataUrl });
      setFailed(null);
      return;
    }
    let active = true;
    window.torchlauncher
      .request({ action: 'brandingImage', role, sha256 })
      .then((reply) => {
        if (!active) return;
        if (reply.ok && reply.image && reply.image.sha256 === sha256) {
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
          cache.set(key, reply.image);
          setShown({ sha256, dataUrl: reply.image.dataUrl });
          setFailed(null);
        } else setFailed({ sha256, code: reply.ok ? 'IO' : reply.code });
      })
      .catch(() => {
        if (active) setFailed({ sha256, code: 'IO' });
      });
    return () => {
      active = false;
    };
  }, [role, sha256]);
  return {
    dataUrl: sha256 ? (shown?.dataUrl ?? null) : null,
    failure: sha256 && failed?.sha256 === sha256 ? failed.code : null,
  };
}
