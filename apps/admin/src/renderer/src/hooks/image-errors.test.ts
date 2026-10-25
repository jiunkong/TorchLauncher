import { createTranslator } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import type { StudioImageFailure, StudioImageIoCause } from '../../../shared/studio';
import { studioTranslations } from '../i18n/catalog';
import { imageFailureMessage } from './errors';

const base = { role: 'icon' as const, name: 'logo.png' };
const causes: StudioImageIoCause[] = [
  'denied',
  'notFound',
  'notFile',
  'changed',
  'diskFull',
  'other',
];
// [failure, parts expected in English, parts expected in Korean]
const failures: [StudioImageFailure, string[], string[]][] = [
  [{ ...base, reason: 'unsupported' }, ['logo.png', 'PNG'], ['logo.png', 'PNG']],
  [
    { ...base, reason: 'corrupt', part: 'empty', format: null, width: null, height: null },
    ['0 bytes'],
    ['0바이트'],
  ],
  [
    { ...base, reason: 'corrupt', part: 'header', format: 'JPEG', width: null, height: null },
    ['JPEG', 'header'],
    ['JPEG', '머리글'],
  ],
  [
    { ...base, reason: 'corrupt', part: 'data', format: 'PNG', width: 800, height: 600 },
    ['800×600', 'PNG header'],
    ['800×600', 'PNG 머리글'],
  ],
  [
    { ...base, reason: 'fileTooLarge', bytes: 40 * 1024 ** 2, limit: 32 * 1024 ** 2 },
    ['40 MB', '32 MB'],
    ['40 MB', '32 MB'],
  ],
  [
    { ...base, reason: 'tooManyPixels', width: 9000, height: 8000, limit: 64_000_000 },
    ['9000×8000', '72.0', '64 megapixel'],
    ['9000×8000', '72.0', '64메가픽셀'],
  ],
  [
    {
      ...base,
      reason: 'cannotFit',
      attempts: 10,
      bytes: 3 * 1024 ** 2,
      width: 120,
      height: 120,
      limit: 1024 ** 2,
    },
    ['10 resize attempts', '120×120', '3.0 MB', '1.0 MB', 'App icon'],
    ['10번', '120×120', '3.0 MB', '1.0 MB', '앱 아이콘'],
  ],
  ...causes.flatMap((cause): [StudioImageFailure, string[], string[]][] => [
    [{ ...base, reason: 'unreadable', cause }, ['logo.png'], ['logo.png']],
    [{ role: 'background', reason: 'storeFailed', cause }, ['Home background'], ['홈 배경']],
  ]),
];

describe('branding image failure messages', () => {
  for (const locale of ['en', 'ko'] as const) {
    it(`renders a specific message with values in ${locale}`, () => {
      const t = createTranslator(studioTranslations, locale);
      const generic = [t('error.INVALID'), t('error.IMAGE_FAILED')];
      for (const [failure, en, ko] of failures) {
        const message = imageFailureMessage(failure, t);
        for (const part of locale === 'en' ? en : ko) expect(message).toContain(part);
        expect(generic).not.toContain(message);
        expect(message).not.toMatch(/\{\w+\}/u);
      }
    });
  }
});
