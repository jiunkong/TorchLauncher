import { createLocaleStore } from '@torchlauncher/core/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { activeChoice, LanguageControl } from './LanguageControl';

type Button = ReactElement<{
  onClick(): void;
  'aria-checked': boolean;
  'data-choice': string;
  children: string;
}>;
const buttons = (preference: Parameters<typeof LanguageControl>[0]['preference']) => {
  const onSelect = vi.fn();
  const root = LanguageControl({ preference, onSelect }) as ReactElement<{ children: Button[] }>;
  return { buttons: root.props.children, onSelect, root };
};

describe('language control', () => {
  it('offers automatic, Korean and English, each in its own language, with one active', () => {
    const { buttons: items, root } = buttons({ mode: 'auto' });
    expect(items.map((item) => item.props['data-choice'])).toEqual(['auto', 'ko', 'en']);
    expect(items.map((item) => item.props.children)).toEqual(['자동 · Auto', '한국어', 'English']);
    expect(items.map((item) => item.props['aria-checked'])).toEqual([true, false, false]);
    expect((root.props as unknown as { 'aria-label': string })['aria-label']).toBe(
      'Language / 언어',
    );
    expect(
      buttons({ mode: 'explicit', locale: 'en' }).buttons.map((i) => i.props['aria-checked']),
    ).toEqual([false, false, true]);
    expect(activeChoice({ mode: 'explicit', locale: 'ko' })).toBe('ko');
  });

  it('reports the clicked choice', () => {
    const { buttons: items, onSelect } = buttons({ mode: 'auto' });
    for (const item of items) item.props.onClick();
    expect(onSelect.mock.calls.map((call) => call[0])).toEqual(['auto', 'ko', 'en']);
  });

  it('switches the real locale store, persists explicit choices and follows the system again', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const make = () =>
      createLocaleStore({ storage, storageKey: 'k', preferredLanguages: () => ['en-US'] });
    const store = make();
    expect(store.getSnapshot().locale).toBe('en');
    store.setLocale('ko');
    expect(store.getSnapshot().locale).toBe('ko');
    expect(make().getSnapshot().locale).toBe('ko');
    store.useAutomaticLocale();
    expect(store.getSnapshot().locale).toBe('en');
    expect(make().getSnapshot().preference).toEqual({ mode: 'auto' });
  });
});

it('is wired to the store from the start screen and the View menu', async () => {
  const start = (await import('../pages/StartPage.tsx?raw')).default as string;
  const app = (await import('../App.tsx?raw')).default as string;
  expect(start).toContain('<LanguageControl');
  expect(start).toContain('followSystem()');
  expect(start).toContain('setLocale(choice)');
  expect(app).toContain('followSystem()');
  expect(app).toContain('setLocale(choice)');
});
