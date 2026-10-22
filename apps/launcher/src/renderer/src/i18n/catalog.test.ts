import { findCatalogMismatches } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import { launcherTranslations } from './catalog.js';

describe('launcher translations', () => {
  it('has matching Korean and English keys and placeholders', () => {
    expect(findCatalogMismatches(launcherTranslations)).toEqual([]);
  });
});
