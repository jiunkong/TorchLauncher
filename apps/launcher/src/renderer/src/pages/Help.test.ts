import { createTranslator } from '@torchlauncher/core/i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../../shared/updates';
import { LauncherLocaleProvider } from '../i18n';
import { launcherTranslations } from '../i18n/catalog';
import { HelpView, updateStatus } from './Help';

afterEach(() => vi.unstubAllGlobals());
const t = createTranslator(launcherTranslations, 'en');
it.each([
  [{ phase: 'idle' }, false, true],
  [{ phase: 'available', version: '1.2.0', size: 100 }, false, false],
  [{ phase: 'checking' }, true, true],
  [{ phase: 'downloading', received: 10 }, true, true],
  [{ phase: 'downloaded', version: '1.2.0', size: 100 }, false, true],
  [{ phase: 'error', code: 'LAUNCHER_NO_RELEASE' }, false, true],
  [{ phase: 'error', code: 'UNSUPPORTED_TARGET' }, true, true],
] as [UpdateState, boolean, boolean][])(
  'renders button state for %j',
  (state, checkDisabled, downloadDisabled) => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ mode: 'explicit', locale: 'en' }),
    });
    const html = renderToStaticMarkup(
      createElement(
        LauncherLocaleProvider,
        null,
        createElement(HelpView, {
          hidden: false,
          version: '1.0.0',
          state,
          pending: false,
          command: async () => {},
        }),
      ),
    );
    const check = html.match(/<button[^>]+data-testid="update-check"[^>]*>/)?.[0];
    const download = html.match(/<button[^>]+data-testid="update-download"[^>]*>/)?.[0];
    expect(check?.includes('disabled')).toBe(checkDisabled);
    expect(download?.includes('disabled')).toBe(downloadDisabled);
    expect(html).toContain('Current version 1.0.0');
    expect(html.match(/<button/g)).toHaveLength(2);
  },
);
it('distinguishes no release, offline, validation and service failure in both languages', () => {
  for (const locale of ['en', 'ko'] as const) {
    const translate = createTranslator(launcherTranslations, locale);
    const messages = [
      'LAUNCHER_NO_RELEASE',
      'LAUNCHER_OFFLINE',
      'LAUNCHER_VERIFY',
      'LAUNCHER_RELEASE_FAILED',
    ].map((code) => updateStatus(translate, { phase: 'error', code } as UpdateState));
    expect(new Set(messages).size).toBe(4);
    expect(messages.join(' ')).not.toMatch(/https:|\/private|sha256|IPC/);
  }
  expect(updateStatus(t, { phase: 'downloaded', version: '1.2.0', size: 100 })).toBe(
    'Version 1.2.0 download complete.',
  );
});
