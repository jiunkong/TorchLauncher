import { createTranslator } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';
import type { UpdateState } from '../../../shared/updates';
import { studioTranslations } from '../i18n/catalog';
import { updateStatus } from './updateStatus';

describe('update menu and toast status', () => {
  it('keeps progress, terminal, and failure messages in both locales', () => {
    const states: UpdateState[] = [
      { phase: 'idle' },
      { phase: 'checking' },
      { phase: 'current' },
      { phase: 'available', version: '1.2.3', size: 1024 },
      { phase: 'downloading', received: 2048 },
      { phase: 'downloaded', version: '1.2.3', size: 1024 },
      { phase: 'cancelled' },
      { phase: 'error', code: 'LAUNCHER_NO_RELEASE' },
      { phase: 'error', code: 'LAUNCHER_OFFLINE' },
      { phase: 'error', code: 'LAUNCHER_VERIFY' },
      { phase: 'error', code: 'INVALID' },
      { phase: 'error', code: 'TOO_LARGE' },
      { phase: 'error', code: 'UNSUPPORTED_TARGET' },
      { phase: 'error', code: 'IO' },
    ];
    for (const locale of ['ko', 'en'] as const) {
      const t = createTranslator(studioTranslations, locale);
      const messages = states.map((state) => updateStatus(t, state));
      expect(messages).toHaveLength(states.length);
      expect(messages[0]).toBe(t('help.idle'));
      expect(messages[3]).toContain('1.2.3');
      expect(messages[4]).toContain('2.0 KB');
      expect(messages[9]).toBe(t('help.verifyFailed'));
      expect(messages[10]).toBe(t('help.verifyFailed'));
      expect(messages[11]).toBe(t('help.verifyFailed'));
      expect(messages[12]).toBe(t('help.unsupported'));
      expect(messages[13]).toBe(t('help.failed'));
    }
  });
});
