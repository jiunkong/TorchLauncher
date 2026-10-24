import type { StudioRun } from './useStudio';

const detailKeys = {
  NO_TEST_RESULT: 'settings.import.error.NO_TEST_RESULT',
  TEST_OPTIONS_MISSING: 'settings.import.error.TEST_OPTIONS_MISSING',
} as const;
export type DetailMessageKey = (typeof detailKeys)[keyof typeof detailKeys];

/** Catalog key for a main-process detail code, or null when the generic error text applies. */
export function detailMessageKey(code: string | null): DetailMessageKey | null {
  return code !== null && code in detailKeys ? detailKeys[code as keyof typeof detailKeys] : null;
}

/** The message key for a failed options import (detail text, else the generic invalid input). */
export function importFailureKey(run: StudioRun | null): DetailMessageKey | 'error.INVALID' | null {
  if (run?.action !== 'settingsImportOptions' || run.ok || run.code === 'CANCELLED') return null;
  return detailMessageKey(run.detailCode) ?? 'error.INVALID';
}
