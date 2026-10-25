import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StudioLocaleProvider } from '../i18n';
import {
  FileTargetDialog,
  fileDirectory,
  normalizeFileDirectory,
  targetPathForDirectory,
} from './FilesPage';
import { useKoreanLocale } from './fixtures/fakeStudio';

beforeAll(useKoreanLocale);

function render(props: { directory?: string; failure?: string; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    createElement(
      StudioLocaleProvider,
      null,
      createElement(FileTargetDialog, {
        path: 'custom.data',
        sourceDirectory: '',
        currentDirectory: props.directory ?? 'data',
        busy: props.busy ?? false,
        failure: props.failure ?? '',
        onCancel: vi.fn(),
        onSubmit: vi.fn(async () => undefined),
      }),
    ),
  );
}

describe('file target dialog', () => {
  it('opens as an accessible modal with source path, current target and save form', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('런처 폴더 편집');
    expect(html).toContain('custom.data');
    expect(html).toContain('value="data"');
    expect(html).toContain('게임 폴더 기준 상대 경로');
    expect(html).toContain('원본 파일명은 유지됩니다.');
    expect(html).toContain('data-autofocus');
    expect(html).toContain('type="submit"');
    expect(html).toContain('원래대로');
  });

  it('keeps validation failures inside the dialog and disables save while busy or unchanged', () => {
    expect(render({ failure: '입력값이나 선택한 경로를 확인하세요.' })).toContain(
      'role="alert">입력값이나 선택한 경로를 확인하세요.',
    );
    expect(render({ directory: '' })).toContain('data-testid="files-target-save" disabled=""');
    expect(render({ busy: true })).toContain('data-testid="files-target-save" disabled=""');
  });

  it('wires modal submit to trimmed filesTarget commands and has no inline draft or blur save', async () => {
    const source = (await import('./FilesPage.tsx?raw')).default as string;
    const modal = (await import('../components/Modal.tsx?raw')).default as string;
    expect(source).toContain("action: 'filesTarget'");
    expect(source).toContain('targetPath: targetPathForDirectory(targetEntry.path, nextDirectory)');
    expect(source).toContain('if (saved) setTargetPath(null)');
    expect(source).not.toContain('targetDrafts');
    expect(source).not.toContain('onBlur=');
    expect(modal).toContain("event.key === 'Escape'");
    expect(modal).toContain("event.key !== 'Tab'");
  });
});

describe('launcher folder path helpers', () => {
  it('keeps only the folder editable and restores the source filename on save', () => {
    expect(fileDirectory('custom.data')).toBe('');
    expect(fileDirectory('source/nested/custom.data')).toBe('source/nested');
    expect(normalizeFileDirectory(' data/ ')).toBe('data');
    expect(targetPathForDirectory('custom.data', 'data/')).toBe('data/custom.data');
    expect(targetPathForDirectory('source/custom.data', '')).toBe('custom.data');
  });
});
