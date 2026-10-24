import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PROJECT_NAME_MAX, projectNameProblem } from '../../../shared/studio.js';
import { StudioLocaleProvider } from '../i18n';
import { useKoreanLocale } from '../pages/fixtures/fakeStudio';
import { ProjectNameDialog } from './ProjectNameDialog';

beforeAll(useKoreanLocale);

const render = (props: { mode?: 'new' | 'saveAs'; initialName?: string; failure?: string }) =>
  renderToStaticMarkup(
    createElement(
      StudioLocaleProvider,
      null,
      createElement(ProjectNameDialog, {
        mode: props.mode ?? 'new',
        initialName: props.initialName ?? '내 서버',
        busy: false,
        failure: props.failure ?? '',
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );

describe('project name dialog', () => {
  it('is an accessible in-app modal prefilled with the name, focused first', () => {
    const html = render({});
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('새 프로젝트 이름');
    expect(html).toContain('value="내 서버"');
    expect(html).toContain('data-autofocus');
    expect(html).toContain('data-testid="project-name-submit"');
    expect(html).not.toContain('disabled=""');
  });

  it('uses Save As wording and shows an invalid prefill with the submit disabled', () => {
    const html = render({ mode: 'saveAs', initialName: 'CON' });
    expect(html).toContain('프로젝트를 다른 이름으로 저장');
    expect(html).toContain('Windows 예약어');
    expect(html).toContain('disabled=""');
  });

  it('shows the last failure (for example an existing folder) inside the prompt', () => {
    expect(render({ failure: '같은 이름의 파일이나 폴더가 이미 있습니다.' })).toContain(
      '같은 이름의 파일이나 폴더가 이미 있습니다.',
    );
  });

  it('is wired by the app for both New project and Save as', async () => {
    const app = (await import('../App.tsx?raw')).default as string;
    expect(app).toMatch(/naming && \(\s*<ProjectNameDialog/);
    expect(app).toContain("saveAs: () => askName('saveAs')");
  });
});

describe('project name rules shared with main', () => {
  it('accepts ordinary names and trims surrounding spaces', () => {
    for (const name of ['서버', ' My Server ', 'a.b', 'COM10', 'x'.repeat(PROJECT_NAME_MAX)])
      expect(projectNameProblem(name)).toBeNull();
  });

  it('rejects empty, separators, dots, invalid characters, reserved names and long names', () => {
    expect(projectNameProblem('  ')).toBe('empty');
    expect(projectNameProblem('x'.repeat(PROJECT_NAME_MAX + 1))).toBe('long');
    for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b'])
      expect(projectNameProblem(name)).toBe('characters');
    for (const name of ['.', '..', 'name.']) expect(projectNameProblem(name)).toBe('ending');
    for (const name of ['CON', 'prn', 'Aux', 'NUL', 'com1', 'LPT9', 'nul.txt'])
      expect(projectNameProblem(name)).toBe('reserved');
  });
});
