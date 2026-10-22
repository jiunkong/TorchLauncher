import type { ProductState } from '../../shared/product';

export const splashMinimumMs = 1600;
export const splashReducedMinimumMs = 700;
/** The splash never hides a stuck startup indefinitely; the home then shows the real operation. */
export const splashMaximumMs = 15_000;
export const splashFinishMs = 800;

export type SplashPhase = 'playing' | 'waiting' | 'finishing' | 'done';

/**
 * App loading is ready once the first product state (or its failure) has arrived and the
 * startup session restore (operation `refresh`) is no longer running.
 */
export function appReady(state: ProductState | null, productError: string | null): boolean {
  if (productError) return true;
  return state !== null && state.operation !== 'refresh';
}

/** `finishing` -> `done` is a timer in the component; everything before it is decided here. */
export function nextSplashPhase(
  phase: SplashPhase,
  input: { minimumElapsed: boolean; maximumElapsed: boolean; ready: boolean },
): SplashPhase {
  if (phase === 'finishing' || phase === 'done') return phase;
  if (!input.minimumElapsed && !(phase === 'waiting')) return 'playing';
  return input.ready || input.maximumElapsed ? 'finishing' : 'waiting';
}
