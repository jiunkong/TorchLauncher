import type { Locale } from './catalog.js';

export type LocalePreference = { mode: 'auto' } | { mode: 'explicit'; locale: Locale };

export function normalizeLocale(input: unknown): Locale | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const canonical = Intl.getCanonicalLocales(input.trim())[0];
    const language = canonical?.split('-')[0]?.toLowerCase();
    return language === 'ko' || language === 'en' ? language : undefined;
  } catch {
    return undefined;
  }
}

export function resolveLocale(
  preference: LocalePreference,
  preferredLanguages: readonly string[],
): Locale {
  if (preference.mode === 'explicit') return preference.locale;
  for (const language of preferredLanguages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return 'en';
}

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readLocalePreference(
  storage: Pick<LocaleStorage, 'getItem'>,
  key: string,
): LocalePreference {
  try {
    const stored = storage.getItem(key);
    if (!stored) return { mode: 'auto' };
    const value: unknown = JSON.parse(stored);
    if (isLocalePreference(value)) return value;
  } catch {
    // Unavailable or malformed storage falls back to automatic detection.
  }
  return { mode: 'auto' };
}

export function writeLocalePreference(
  storage: Pick<LocaleStorage, 'setItem'>,
  key: string,
  preference: LocalePreference,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

function isLocalePreference(value: unknown): value is LocalePreference {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.mode === 'auto' ||
    (record.mode === 'explicit' && (record.locale === 'ko' || record.locale === 'en'))
  );
}
