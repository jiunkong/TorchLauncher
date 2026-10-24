import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LauncherLocaleProvider } from '../i18n';
import { LoginCodeDialog } from './LoginCodeDialog';

beforeAll(() => {
  const stored = JSON.stringify({ mode: 'explicit', locale: 'ko' });
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => stored,
    setItem: () => undefined,
  };
});

const render = () =>
  renderToStaticMarkup(
    createElement(
      LauncherLocaleProvider,
      null,
      createElement(LoginCodeDialog, {
        code: 'ABCD-1234',
        onCopy: vi.fn(async () => true),
        onCancel: vi.fn(),
      }),
    ),
  );

describe('launcher login code dialog', () => {
  it('shows the code in an accessible in-app dialog with copy and cancel', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-testid="login-dialog"');
    expect(html).toContain('>로그인<');
    expect(html).toContain('aria-label="로그인 코드"');
    expect(html).toContain('>ABCD-1234<');
    expect(html).toContain('로그인을 기다리는 중');
    expect(html).toContain('코드 복사');
    expect(html).toContain('data-testid="login-cancel"');
    expect(html).toContain('data-autofocus');
    expect(html).not.toMatch(/남음|\d\d:\d\d/);
  });

  it('is rendered by the app only while state carries a code; cancel and copy use commands', async () => {
    const app = (await import('../App.tsx?raw')).default as string;
    expect(app).toMatch(/state\?\.loginCode && \(\s*<LoginCodeDialog/);
    expect(app).toContain("command({ type: 'copy-login-code' })");
    expect(app).toContain("command({ type: 'cancel' })");
    expect(app).toMatch(/!!state\?\.loginCode/);
    expect(app + render()).not.toContain('navigator.clipboard');
  });
});
