import { createLocaleStore } from '@torchlauncher/core/i18n';
import { describe, expect, it } from 'vitest';

describe('launcher locale preference', () => {
  it('persists explicit choices and follows the system again', () => {
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
