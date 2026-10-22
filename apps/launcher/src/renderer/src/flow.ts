import type { ProductCommand, ProductState } from '../../shared/product';

export function homePrimaryCommand(
  state: Pick<ProductState, 'configuration' | 'supported' | 'account'>,
): ProductCommand | null {
  if (state.configuration !== 'ready' || !state.supported) return null;
  return state.account ? { type: 'launch' } : { type: 'login' };
}

export function homePrimaryDisabled(command: ProductCommand | null, busy: boolean): boolean {
  return command === null || busy;
}

export function operationControl(
  state: Pick<ProductState, 'running' | 'operation'>,
): 'stop' | 'cancel' | null {
  if (state.running) return 'stop';
  return state.operation === null ? null : 'cancel';
}
