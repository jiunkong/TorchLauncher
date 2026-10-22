import { useRef } from 'react';
import type { ProductState } from '../../../shared/product';
import { type ActivityStage, advanceStage } from '../activity';

/** Furthest installation stage seen during the current operation; reset when it ends. */
export function useStage(state: ProductState | null): ActivityStage | null {
  const reached = useRef<ActivityStage | null>(null);
  if (!state || state.operation === null) reached.current = null;
  else reached.current = advanceStage(reached.current, state.activity);
  return reached.current;
}
