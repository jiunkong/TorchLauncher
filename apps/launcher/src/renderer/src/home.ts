import type { ProductCommand, ProductState } from '../../shared/product';
import { homePrimaryCommand, homePrimaryDisabled, operationControl } from './flow';

export type HomeKind =
  | 'unconfigured'
  | 'unsupported'
  | 'running'
  | 'busy'
  | 'error'
  | 'login'
  | 'ready';

export interface HomeView {
  kind: HomeKind;
  primary: ProductCommand | null;
  /** Failure code to explain; absent when nothing needs the user's attention. */
  error: string | null;
  disabled: boolean;
  /** Control offered while an operation runs (cancel) or the game runs (stop). */
  control: 'stop' | 'cancel' | null;
}

/** A failed startup session restore on a fresh install is the login state, not an error. */
export function visibleError(state: ProductState, productError: string | null): string | null {
  const code = productError ?? state.error;
  if (!code) return null;
  return code === 'no_session' && !state.account ? null : code;
}

export function homeView(
  state: ProductState,
  productError: string | null,
  pending: boolean,
): HomeView {
  const primary = homePrimaryCommand(state);
  const busyFlag = state.operation !== null || pending;
  const disabled = homePrimaryDisabled(primary, busyFlag);
  const error = visibleError(state, productError);
  const base = { primary, disabled, control: operationControl(state), error };
  if (state.configuration !== 'ready') return { ...base, kind: 'unconfigured', control: null };
  if (!state.supported) return { ...base, kind: 'unsupported', control: null };
  if (state.running) return { ...base, kind: 'running', control: 'stop' };
  // The one-shot status probe is not shown as an installation.
  if (state.operation !== null && state.operation !== 'status')
    return { ...base, kind: 'busy', control: 'cancel' };
  if (error) return { ...base, kind: 'error', control: null };
  return { ...base, kind: state.account ? 'ready' : 'login', control: null };
}

export function elapsedParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}
