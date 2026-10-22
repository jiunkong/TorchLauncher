import { useEffect, useState } from 'react';
import type { ProductState } from '../../../shared/product';
import { type StepId, stepOf } from '../activity';

/** Steps whose work this renderer observed during the current operation; reset when it ends. */
export function useSeenSteps(state: ProductState | null): StepId[] {
  const [seen, setSeen] = useState<StepId[]>([]);
  const operation = state?.operation ?? null;
  const step = state?.activity ? stepOf(state.activity.component) : null;
  useEffect(() => {
    if (operation === null) setSeen([]);
  }, [operation]);
  useEffect(() => {
    if (step === null) return;
    setSeen((previous) => (previous.includes(step) ? previous : [...previous, step]));
  }, [step]);
  return seen;
}
