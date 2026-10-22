import type { Locale } from './catalog.js';
import {
  type LocalePreference,
  type LocaleStorage,
  readLocalePreference,
  resolveLocale,
  writeLocalePreference,
} from './locale.js';

export interface LocaleStore {
  getSnapshot(): LocaleSnapshot;
  subscribe(listener: () => void): () => void;
  setLocale(locale: Locale): void;
  useAutomaticLocale(): void;
}

export interface LocaleSnapshot {
  locale: Locale;
  preference: LocalePreference;
}

export function createLocaleStore(options: {
  storage: LocaleStorage;
  storageKey: string;
  preferredLanguages: () => readonly string[];
}): LocaleStore {
  let preference = readLocalePreference(options.storage, options.storageKey);
  let snapshot: LocaleSnapshot = {
    locale: resolveLocale(preference, options.preferredLanguages()),
    preference,
  };
  const listeners = new Set<() => void>();

  const update = (next: LocalePreference) => {
    const preferenceChanged =
      preference.mode !== next.mode ||
      (preference.mode === 'explicit' &&
        next.mode === 'explicit' &&
        preference.locale !== next.locale);
    if (!preferenceChanged) return;
    preference = next;
    writeLocalePreference(options.storage, options.storageKey, next);
    snapshot = { locale: resolveLocale(preference, options.preferredLanguages()), preference };
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale(locale) {
      update({ mode: 'explicit', locale });
    },
    useAutomaticLocale() {
      update({ mode: 'auto' });
    },
  };
}
