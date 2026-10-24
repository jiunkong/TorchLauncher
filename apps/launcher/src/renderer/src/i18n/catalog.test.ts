import { findCatalogMismatches } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import { launcherTranslations } from './catalog.js';

describe('launcher translations', () => {
  it('has matching Korean and English keys and placeholders', () => {
    expect(findCatalogMismatches(launcherTranslations)).toEqual([]);
  });

  it('does not leave Korean text in the English catalog', () => {
    for (const [key, value] of Object.entries(launcherTranslations.en)) {
      expect(value, key).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/);
    }
  });
});
