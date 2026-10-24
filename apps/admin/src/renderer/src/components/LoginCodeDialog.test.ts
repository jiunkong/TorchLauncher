import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StudioLocaleProvider } from '../i18n';
import { useKoreanLocale } from '../pages/fixtures/fakeStudio';
import { LoginCodeDialog } from './LoginCodeDialog';

beforeAll(useKoreanLocale);

describe('login code dialog', () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(
        StudioLocaleProvider,
        null,
        createElement(LoginCodeDialog, {
          code: 'ABCD-1234',
          onCopy: vi.fn(async () => true),
          onCancel: vi.fn(),
        }),
      ),
    );

  it('shows the code in an accessible in-app dialog with copy and cancel and no countdown', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Microsoft 로그인');
    expect(html).toContain('aria-label="로그인 코드"');
    expect(html).toContain('>ABCD-1234<');
    expect(html).toContain('로그인을 기다리는 중');
    expect(html).not.toMatch(/남음|\d\d:\d\d/);
    expect(html).toContain('코드 복사');
    expect(html).toContain('data-testid="login-cancel"');
    expect(html).toContain('data-autofocus');
  });

  it('is rendered by the app only while the account state carries a login code', async () => {
    const app = (await import('../App.tsx?raw')).default as string;
    expect(app).toMatch(/state\?\.account\.login && \(\s*<LoginCodeDialog/);
    // Cancel is the page's own cancel; copy goes through main (no navigator.clipboard).
    expect(app).toContain("studio.run('cancel')");
    expect(app).toContain("action: 'testLoginCopyCode'");
    expect(app + render()).not.toContain('navigator.clipboard');
  });
});
