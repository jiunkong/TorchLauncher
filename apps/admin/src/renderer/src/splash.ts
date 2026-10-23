export const splashMinimumMs = 1600;
export const splashReducedMinimumMs = 700;
/** The splash never hides a stuck startup indefinitely; the app then shows the real state. */
export const splashMaximumMs = 15_000;
export const splashFinishMs = 800;

export type SplashPhase = 'playing' | 'waiting' | 'finishing' | 'done';

/** The first Studio state reply (or its failure) means the app finished loading. */
export function appReady(stateLoaded: boolean, failed: boolean): boolean {
  return stateLoaded || failed;
}

/** `finishing` -> `done` is a timer in the component; everything before it is decided here. */
export function nextSplashPhase(
  phase: SplashPhase,
  input: { minimumElapsed: boolean; maximumElapsed: boolean; ready: boolean },
): SplashPhase {
  if (phase === 'finishing' || phase === 'done') return phase;
  if (!input.minimumElapsed && phase !== 'waiting') return 'playing';
  return input.ready || input.maximumElapsed ? 'finishing' : 'waiting';
}
