import { describe, expect, it } from 'vitest';
import { detailMessageKey, importFailureKey } from './errors';
import type { StudioRun } from './useStudio';

const run = (patch: Partial<StudioRun>): StudioRun => ({
  seq: 1,
  action: 'settingsImportOptions',
  ok: false,
  code: 'INVALID',
  detailCode: null,
  ...patch,
});

describe('detail messages', () => {
  it('maps known detail codes only', () => {
    expect(detailMessageKey('NO_TEST_RESULT')).toBe('settings.import.error.NO_TEST_RESULT');
    expect(detailMessageKey('TEST_OPTIONS_MISSING')).toBe(
      'settings.import.error.TEST_OPTIONS_MISSING',
    );
    expect(detailMessageKey('other')).toBeNull();
    expect(detailMessageKey(null)).toBeNull();
  });
  it('reports import failures but not cancellation or other actions', () => {
    expect(importFailureKey(run({ detailCode: 'NO_TEST_RESULT' }))).toBe(
      'settings.import.error.NO_TEST_RESULT',
    );
    expect(importFailureKey(run({}))).toBe('error.INVALID');
    expect(importFailureKey(run({ code: 'CANCELLED' }))).toBeNull();
    expect(importFailureKey(run({ ok: true, code: null }))).toBeNull();
    expect(importFailureKey(run({ action: 'save' }))).toBeNull();
    expect(importFailureKey(null)).toBeNull();
  });
});
