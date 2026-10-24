import { createTranslator } from '@torchlauncher/core/i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AboutDialog } from './components/AboutDialog';
import { MenuBar, type MenuEntry } from './components/MenuBar';
import { StudioLocaleProvider } from './i18n';
import { studioTranslations } from './i18n/catalog';
import { buildMenus, shortcutAction } from './menus';
import { useKoreanLocale } from './pages/fixtures/fakeStudio';

const t = createTranslator(studioTranslations, 'ko');
const actions = () => ({
  newProject: vi.fn(),
  openProject: vi.fn(),
  save: vi.fn(),
  saveAs: vi.fn(),
  closeProject: vi.fn(),
  exit: vi.fn(),
  language: vi.fn(),
  about: vi.fn(),
});
const entries = (rows: ReturnType<typeof buildMenus>[number]['rows']) =>
  rows.filter((row): row is MenuEntry => 'id' in row);
const build = (hasProject: boolean, busy = false, preference = { mode: 'auto' } as never) =>
  buildMenus({ t, hasProject, busy, preference, actions: actions() });

beforeAll(useKoreanLocale);

describe('menus', () => {
  it('has File, View and Help with the specified file items and shortcuts', () => {
    const menus = build(true);
    expect(menus.map((menu) => menu.label)).toEqual(['파일', '보기', '도움말']);
    expect(entries(menus[0]?.rows ?? []).map((e) => [e.label, e.shortcut])).toEqual([
      ['새 프로젝트', 'Ctrl+N'],
      ['열기…', 'Ctrl+O'],
      ['저장', 'Ctrl+S'],
      ['다른 이름으로 저장', 'Ctrl+Shift+S'],
      ['프로젝트 닫기', 'Ctrl+W'],
      ['종료', undefined],
    ]);
  });

  it('disables project actions without a project and all file actions but exit while busy', () => {
    const disabled = (menus: ReturnType<typeof build>) =>
      entries(menus[0]?.rows ?? [])
        .filter((e) => e.disabled)
        .map((e) => e.id);
    expect(disabled(build(false))).toEqual(['save', 'saveAs', 'close']);
    expect(disabled(build(true))).toEqual([]);
    expect(disabled(build(true, true))).toEqual(['new', 'open', 'save', 'saveAs', 'close']);
  });

  it('offers the language radio group in both languages with the active choice checked', () => {
    const view = build(true, false, { mode: 'explicit', locale: 'en' } as never)[1];
    expect(view?.rows[0]).toEqual({ caption: 'Language / 언어' });
    const radios = entries(view?.rows ?? []);
    expect(radios.map((r) => [r.label, r.radio, r.checked])).toEqual([
      ['자동 · Auto', true, false],
      ['한국어', true, false],
      ['English', true, true],
    ]);
    expect(build(true)[1] && entries(build(true)[1]?.rows ?? [])[0]?.checked).toBe(true);
  });

  it('maps only the specified Ctrl shortcuts', () => {
    const key = (k: string, extra = {}) =>
      shortcutAction({
        key: k,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...extra,
      });
    expect([key('n'), key('o'), key('s'), key('S', { shiftKey: true }), key('w')]).toEqual([
      'newProject',
      'openProject',
      'save',
      'saveAs',
      'closeProject',
    ]);
    expect(key('a')).toBeNull();
    expect(key('s', { ctrlKey: false })).toBeNull();
    expect(key('n', { shiftKey: true })).toBeNull();
    expect(key('s', { altKey: true })).toBeNull();
  });
});

describe('menu bar and about dialog markup', () => {
  const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(createElement(StudioLocaleProvider, null, element));

  it('renders an accessible menubar with collapsed top-level menus', () => {
    const html = render(createElement(MenuBar, { label: '메뉴', menus: build(false) }));
    expect(html).toContain('role="menubar"');
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html).not.toContain('role="menu"');
  });

  it('shows name, version and platform in the about dialog', () => {
    const html = render(
      createElement(AboutDialog, { version: '0.1.0', platform: 'win32', onClose: () => {} }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('TorchLauncher Studio');
    expect(html).toContain('v0.1.0');
    expect(html).toContain('win32');
    expect(html).toContain('data-autofocus');
  });
});
