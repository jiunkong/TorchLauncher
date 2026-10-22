import { findCatalogMismatches } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import { studioTranslations } from './catalog.js';

describe('Studio translations', () => {
  it('has matching Korean and English keys and placeholders', () => {
    expect(findCatalogMismatches(studioTranslations)).toEqual([]);
  });
});
