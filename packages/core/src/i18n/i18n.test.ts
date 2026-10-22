import { describe, expect, it } from 'vitest';
import { createTranslator, defineTranslations, findCatalogMismatches } from './catalog.js';
import {
  normalizeLocale,
  readLocalePreference,
  resolveLocale,
  writeLocalePreference,
} from './locale.js';
import { createLocaleStore } from './store.js';

describe('locale resolution', () => {
  it('normalizes supported BCP 47 tags and rejects unsupported values', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ko-!!')).toBeUndefined();
    expect(normalizeLocale('fr-FR')).toBeUndefined();
    expect(normalizeLocale(null)).toBeUndefined();
  });

  it('uses the first supported automatic preference, then English fallback', () => {
    expect(resolveLocale({ mode: 'auto' }, ['fr-FR', 'ko-KR', 'en-US'])).toBe('ko');
    expect(resolveLocale({ mode: 'auto' }, ['fr-FR'])).toBe('en');
    expect(resolveLocale({ mode: 'explicit', locale: 'en' }, ['ko-KR'])).toBe('en');
  });
});

describe('translation catalogs', () => {
  const catalogs = defineTranslations(
    { greeting: 'Hello, {name}!', plain: 'Ready' },
    { greeting: '안녕하세요, {name}님!', plain: '준비' },
  );

  const typedTranslate = createTranslator(catalogs, 'en');
  typedTranslate('greeting', { name: 'Player' });
  typedTranslate('plain');
  // @ts-expect-error Unknown translation keys are rejected.
  typedTranslate('unknown');
  // @ts-expect-error Required interpolation values cannot be omitted.
  typedTranslate('greeting');
  // @ts-expect-error Interpolation values must include the declared placeholder.
  typedTranslate('greeting', { player: 'Player' });

  it('interpolates values as text and leaves absent values readable', () => {
    expect(createTranslator(catalogs, 'ko')('greeting', { name: '<player>' })).toBe(
      '안녕하세요, <player>님!',
    );
    expect(createTranslator(catalogs, 'en')('plain')).toBe('Ready');
  });

  it('reports key and placeholder mismatches', () => {
    expect(
      findCatalogMismatches({
        en: { title: '{name} {name}', other: 'Other' },
        ko: { title: '{player}', extra: '추가' },
      }),
    ).toEqual(['en missing key: extra', 'ko missing key: other', 'placeholder mismatch: title']);
  });
});

describe('locale preference storage', () => {
  it('falls back to auto for corrupt or unavailable storage', () => {
    expect(readLocalePreference({ getItem: () => '{' }, 'key')).toEqual({ mode: 'auto' });
    expect(
      readLocalePreference(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        'key',
      ),
    ).toEqual({ mode: 'auto' });
  });

  it('keeps selection in memory if storage writes fail and notifies subscribers', () => {
    let notifications = 0;
    const store = createLocaleStore({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('blocked');
        },
      },
      storageKey: 'launcher-key',
      preferredLanguages: () => ['en-US'],
    });
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.setLocale('ko');
    expect(store.getSnapshot()).toEqual({
      locale: 'ko',
      preference: { mode: 'explicit', locale: 'ko' },
    });
    expect(notifications).toBe(1);
    store.useAutomaticLocale();
    expect(store.getSnapshot()).toEqual({ locale: 'en', preference: { mode: 'auto' } });
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it('publishes preference-mode changes when the resolved locale stays the same', () => {
    const store = createLocaleStore({
      storage: { getItem: () => null, setItem: () => {} },
      storageKey: 'key',
      preferredLanguages: () => ['ko-KR'],
    });
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const automaticSnapshot = store.getSnapshot();
    store.setLocale('ko');
    expect(store.getSnapshot()).toEqual({
      locale: 'ko',
      preference: { mode: 'explicit', locale: 'ko' },
    });
    expect(store.getSnapshot()).not.toBe(automaticSnapshot);
    expect(notifications).toBe(1);
  });

  it('persists the automatic preference', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(writeLocalePreference(storage, 'studio-key', { mode: 'auto' })).toBe(true);
    expect(readLocalePreference(storage, 'studio-key')).toEqual({ mode: 'auto' });
    expect(values.has('launcher-key')).toBe(false);

    const launcher = createLocaleStore({
      storage,
      storageKey: 'launcher-key',
      preferredLanguages: () => ['en-US'],
    });
    const studio = createLocaleStore({
      storage,
      storageKey: 'studio-key',
      preferredLanguages: () => ['ko-KR'],
    });
    launcher.setLocale('ko');
    studio.setLocale('en');
    launcher.useAutomaticLocale();
    expect(readLocalePreference(storage, 'launcher-key')).toEqual({ mode: 'auto' });
    expect(readLocalePreference(storage, 'studio-key')).toEqual({ mode: 'explicit', locale: 'en' });
  });
});
