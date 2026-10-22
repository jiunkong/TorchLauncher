import { useEffect, useRef, useState } from 'react';
import torchUrl from '../assets/torch.png';
import { useReducedMotion } from '../hooks/useReducedMotion';

/** Keep the previous verified display mounted until the browser has decoded its replacement. */
export function BrandingVisual({
  value,
  kind,
}: {
  value: string | null;
  kind: 'icon' | 'background';
}) {
  const reduced = useReducedMotion();
  const current = useRef<string | null>(null);
  const [layers, setLayers] = useState<{ current: string | null; previous?: string | null }>({
    current: null,
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const commit = () => {
      if (!active || current.current === value) return;
      const previous = current.current;
      current.current = value;
      setLayers(reduced ? { current: value } : { current: value, previous });
      if (!reduced)
        timer = setTimeout(() => {
          if (active) setLayers({ current: value });
        }, 220);
    };
    if (value === null) commit();
    else {
      const image = new Image();
      image.src = value;
      void image.decode().then(commit, () => {});
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [value, reduced]);
  useEffect(() => {
    if (reduced) setLayers({ current: current.current });
  }, [reduced]);
  const layer = (source: string | null, previous: boolean) => (
    <div
      key={previous ? 'previous' : 'current'}
      className={`${kind === 'background' ? `scene ${source ? 'branding-photo' : 'fallback'}` : 'branding-icon-layer'} branding-layer${previous ? ' branding-previous' : ' branding-current'}`}
      data-layer={previous ? 'previous' : 'current'}
    >
      <img src={source ?? torchUrl} alt="" draggable={false} />
    </div>
  );
  return (
    <div
      className={kind === 'background' ? 'scene branding-background' : 'branding-icon'}
      data-testid={`branding-${kind}`}
      data-custom={layers.current !== null}
      data-fading={layers.previous !== undefined && !reduced}
      aria-hidden="true"
    >
      {layers.previous !== undefined && !reduced && layer(layers.previous, true)}
      {layer(layers.current, false)}
    </div>
  );
}
