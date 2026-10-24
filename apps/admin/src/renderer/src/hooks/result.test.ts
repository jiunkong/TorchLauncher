import { createTranslator } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import { studioTranslations } from '../i18n/catalog.js';
import { studioResultMessage } from './result.js';

describe('Studio operation result translation', () => {
  it('renders structured results in the selected language', () => {
    const result = { key: 'projectSaved' } as const;
    expect(studioResultMessage(result, createTranslator(studioTranslations, 'ko'))).toBe(
      '프로젝트를 저장했습니다.',
    );
    expect(studioResultMessage(result, createTranslator(studioTranslations, 'en'))).toBe(
      'Project saved.',
    );
  });

  it('includes build values without main-process sentences', () => {
    const result = { key: 'packCreated', sequence: 4, signed: true, keyCreated: true } as const;
    expect(studioResultMessage(result, createTranslator(studioTranslations, 'en'))).toContain(
      'Signed, sequence 4.',
    );
  });
});
