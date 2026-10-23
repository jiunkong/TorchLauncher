import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import torchUrl from '../assets/torch.png';
import { useStudioLocale } from '../i18n';
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
];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function SplashView({ phase, minimumMs }: { phase: SplashPhase; minimumMs: number }) {
  const { t } = useStudioLocale();
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
      <div className="studio-tag" aria-hidden="true">
        STUDIO
      </div>
      <div className="bar" role="progressbar" aria-label={t('splash.loading')}>
        <i />
      </div>
    </div>
  );
}

/** Plays at least the minimum, keeps the torch lit while `ready` is false, then fades out. */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const reduced = useReducedMotion();
  const minimum = reduced ? splashReducedMinimumMs : splashMinimumMs;
  const [phase, setPhase] = useState<SplashPhase>('playing');
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [maximumElapsed, setMaximumElapsed] = useState(false);
  const done = useCallback(onDone, [onDone]);

  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), minimum);
    return () => clearTimeout(timer);
  }, [minimum]);
  useEffect(() => {
    const timer = setTimeout(() => setMaximumElapsed(true), splashMaximumMs);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    setPhase((current) => nextSplashPhase(current, { minimumElapsed, maximumElapsed, ready }));
  }, [minimumElapsed, maximumElapsed, ready]);
  useEffect(() => {
    if (phase !== 'finishing') return;
    const timer = setTimeout(
      () => {
        setPhase('done');
        done();
      },
      reduced ? 0 : splashFinishMs,
    );
    return () => clearTimeout(timer);
  }, [phase, reduced, done]);

  if (phase === 'done') return null;
  return <SplashView phase={phase} minimumMs={minimum} />;
}
