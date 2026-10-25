import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { StudioLocaleProvider } from '../i18n';
import { fakeStudio, project, useKoreanLocale } from './fixtures/fakeStudio';
import { TestPage } from './TestPage';

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(StudioLocaleProvider, null, element));
const page = (options: Parameters<typeof fakeStudio>[0]) => {
  const fake = fakeStudio(options);
  const html = render(
    createElement(TestPage, { studio: fake.studio, draft: project, go: () => undefined }),
  );
  return { html, ...fake };
};
const report = (status: 'problems' | 'no-problems-found' | 'incomplete') => ({
  status,
  truncated: false,
  items:
    status === 'problems'
      ? [
          {
            severity: 'error' as const,
            category: 'mixin' as const,
            summary: { code: 'mixin-failed', parameters: {} },
            evidence: [{ source: 'log' as const, line: 3, text: 'Mixin apply failed' }],
          },
        ]
      : [],
});

beforeAll(useKoreanLocale);

describe('test run start screen', () => {
  it('shows the environment and account cards with the run button below, signed out', () => {
    const { html } = page({ signedIn: false });
    expect(html).toContain('data-testid="test-env"');
    expect(html).toContain('data-testid="test-account-card"');
    expect(html).toContain('로그인하지 않음');
    expect(html).toContain('Microsoft로 로그인');
    expect(html).toContain('Minecraft 1.21.1 · Fabric 0.19.5');
    expect(html).toMatch(/data-testid="test-start-button"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="test-start-button"/);
    // The login prompt is only a disabled-button reason, not body text.
    expect(html).not.toContain('<p class="test-prerequisite"');
  });

  it('enables the run button when signed in with a project folder', () => {
    const { html } = page({ signedIn: true });
    expect(html).toContain('Player_Name');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="test-start-button"/);
    expect(html).toContain('data-testid="test-logout"');
  });

  it('keeps the button disabled without a project folder and keeps the reset action small', () => {
    const { html } = page({ signedIn: true, projectName: null });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="test-start-button"/);
    expect(html).toContain('title="먼저 프로젝트 폴더를 여세요."');
    expect(html).toContain('btn sm ghost');
    expect(html).toContain('data-testid="test-reset-open"');
    expect(html).not.toContain('test-reset-card');
  });
});

describe('test run phases', () => {
  it('shows progress and a cancel button while preparing', () => {
    const { html } = page({
      signedIn: true,
      run: { phase: 'preparing', progress: { component: 'game', completed: 3, total: 10 } },
    });
    expect(html).toContain('data-testid="test-progress"');
    expect(html).toContain('data-testid="test-stop-open"');
    expect(html).not.toContain('data-testid="test-start"');
  });

  it('shows only the log and the stop button while the game runs', () => {
    const { html } = page({
      signedIn: true,
      run: { phase: 'running', logs: [{ stream: 'stdout', text: 'Sound engine started' }] },
    });
    expect(html).toContain('Sound engine started');
    expect(html).toContain('data-testid="test-stop-open"');
    expect(html).toContain('data-testid="test-running-pill"');
    expect(html).not.toContain('test-spinner');
    expect(html).not.toContain('test-progress-bar');
    expect(html).not.toContain('data-testid="test-env"');
    expect(html).not.toContain('data-testid="test-reset-open"');
    expect(html.match(/class="card/g)?.length).toBe(1);
  });

  it('keeps only counts, exit code, logs, rerun, open logs and reset in results', () => {
    const { html } = page({
      signedIn: true,
      run: {
        phase: 'done',
        report: report('problems'),
        exit: { reason: 'exited', code: 1, signal: null },
      },
    });
    expect(html).toContain('data-testid="test-result"');
    expect(html).toContain('문제 1건 · 경고 0건');
    expect(html).toContain('종료 코드 1');
    expect(html).toContain('로그 폴더 열기');
    expect(html).toContain('다시 실행');
    expect(html).toContain('data-testid="test-log"');
    expect(html).not.toContain('Mixin apply failed');
    for (const removed of ['test-findings', 'test-mods', 'test-extracted', 'test-config-summary'])
      expect(html).not.toContain(removed);
    expect(html).toContain('data-testid="test-reset-open"');
  });

  it('shows zero counts for a clean report without extra explanations', () => {
    const { html } = page({
      signedIn: true,
      run: { phase: 'done', report: report('no-problems-found') },
    });
    expect(html).toContain('문제 0건 · 경고 0건');
    expect(html).not.toContain('보장하지');
    expect(html).not.toContain('문제를 찾지 못했습니다');
  });

  it('shows unknown counts when there is no analysis report', () => {
    const { html } = page({ signedIn: true, run: { phase: 'done', report: null } });
    expect(html).toContain('문제 —건 · 경고 —건');
    expect(html).toContain('종료 코드 —');
    expect(html).toContain('data-testid="test-open-logs"');
    expect(html).not.toContain('분석 결과가 없습니다');
  });

  it('shows a safe message when the test failed', () => {
    const { html } = page({ signedIn: true, run: { phase: 'failed', error: 'IO' } });
    expect(html).toContain('data-testid="test-failed"');
    expect(html).not.toContain('data-testid="test-start"');
  });
});

describe('confirmations', () => {
  it('opens stop and reset only through the in-app modal, never sending a command on click', async () => {
    const source = (await import('./TestPage.tsx?raw')).default as string;
    for (const id of ['test-stop-open', 'test-reset-open']) {
      const at = source.indexOf(`data-testid="${id}"`);
      expect(at).toBeGreaterThan(-1);
    }
    // Opening only sets the confirmation state ...
    expect(source).toContain("setConfirm('stop')");
    expect(source).toContain("setConfirm('reset')");
    // ... and the commands exist exactly once each, inside the modal's confirm handler.
    expect(source.match(/action: 'testReset'/g)).toHaveLength(1);
    expect(source.match(/action: 'testStop'/g)).toHaveLength(1);
    const modal = source.indexOf('<Modal');
    expect(source.indexOf("action: 'testReset'")).toBeGreaterThan(modal);
    expect(source.indexOf("action: 'testStop'")).toBeGreaterThan(modal);
    // Rendering never sends a command either.
    const { testCommand, command } = page({ signedIn: true, run: { phase: 'running' } });
    expect(testCommand).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });
});
