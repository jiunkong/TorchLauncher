import { findCatalogMismatches } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import { resolveMainLocale, studioMainTranslations } from './i18n.js';

describe('Studio main translations', () => {
  it('keeps Korean and English catalogs paired', () => {
    expect(findCatalogMismatches(studioMainTranslations)).toEqual([]);
  });

  it('uses Korean only for Korean system locales', () => {
    expect(resolveMainLocale('ko-KR')).toBe('ko');
    expect(resolveMainLocale('en-US')).toBe('en');
    expect(resolveMainLocale('ja-JP')).toBe('en');
  });
});
