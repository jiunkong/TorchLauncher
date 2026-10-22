import { type CSSProperties, useEffect, useState } from 'react';
import torchUrl from '../assets/torch.png';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useT } from '../hooks/useTranslator';
import {
  nextSplashPhase,
  type SplashPhase,
  splashFinishMs,
  splashMaximumMs,
  splashMinimumMs,
  splashReducedMinimumMs,
} from '../splash';

const sparks = [
  { left: 112, top: 30, dx: 18, delay: 1.2 },
  { left: 86, top: 36, dx: -22, delay: 2.1 },
  { left: 124, top: 46, dx: 34, delay: 3.0 },
  { left: 74, top: 48, dx: -40, delay: 3.9 },
  { left: 100, top: 28, dx: 8, delay: 4.8 },
];

export function SplashView({ phase, minimumMs }: { phase: SplashPhase; minimumMs: number }) {
  const t = useT();
  return (
    <div
      className={`splash is-${phase}`}
      data-testid="splash"
      data-phase={phase}
      style={{ '--splash-min': `${minimumMs}ms` } as CSSProperties}
    >
      <div className="torch-wrap">
        <div className="halo" />
        <img className="torch-big" draggable={false} src={torchUrl} alt={t('splash.logoAlt')} />
        {sparks.map((spark) => (
          <span
            key={spark.delay}
            className="spark"
            style={
              {
                left: spark.left,
                top: spark.top,
                '--dx': `${spark.dx}px`,
                animationDelay: `${spark.delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="word" role="img" aria-label="TorchLauncher">
        <span aria-hidden="true">TORCH</span>
        <i aria-hidden="true">LAUNCHER</i>
      </div>
      <div className="bar" role="progressbar" aria-label={t('splash.loading')}>
        <i />
      </div>
    </div>
  );
}

/**
 * Plays at least `minimumMs`, keeps the torch lit while `ready` is false, then flashes and fades.
 * `minimumMs` can be injected so tests and smoke runs do not wait for the full animation.
 */
export function Splash({
  ready,
  onDone,
  minimumMs,
}: {
  ready: boolean;
  onDone: () => void;
  minimumMs?: number;
}) {
  const reduced = useReducedMotion();
  const minimum = minimumMs ?? (reduced ? splashReducedMinimumMs : splashMinimumMs);
  const [phase, setPhase] = useState<SplashPhase>('playing');
  const [minimumElapsed, setMinimumElapsed] = useState(minimum <= 0);
  const [maximumElapsed, setMaximumElapsed] = useState(false);

  useEffect(() => {
    if (minimum <= 0) return;
    const minTimer = setTimeout(() => setMinimumElapsed(true), minimum);
    return () => clearTimeout(minTimer);
  }, [minimum]);
  useEffect(() => {
    const maxTimer = setTimeout(() => setMaximumElapsed(true), Math.max(splashMaximumMs, minimum));
    return () => clearTimeout(maxTimer);
  }, [minimum]);
  useEffect(() => {
    setPhase((current) => nextSplashPhase(current, { minimumElapsed, maximumElapsed, ready }));
  }, [minimumElapsed, maximumElapsed, ready]);
  useEffect(() => {
    if (phase !== 'finishing') return;
    const timer = setTimeout(
      () => {
        setPhase('done');
        onDone();
      },
      reduced || minimum <= 0 ? 0 : splashFinishMs,
    );
    return () => clearTimeout(timer);
  }, [phase, reduced, minimum, onDone]);

  if (phase === 'done') return null;
  return <SplashView phase={phase} minimumMs={minimum} />;
}
