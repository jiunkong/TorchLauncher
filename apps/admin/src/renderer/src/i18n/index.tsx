import { createLocaleStore, createTranslator, type LocaleStore } from '@torchlauncher/core/i18n';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { studioTranslations } from './catalog.js';

const STORAGE_KEY = 'torchlauncher.studio.locale-preference';
const LocaleContext = createContext<LocaleStore | null>(null);

function browserStore(): LocaleStore {
  const storage = {
    getItem(key: string) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        globalThis.localStorage.setItem(key, value);
      } catch {
        // Locale selection remains active in memory for this renderer session.
      }
    },
  };
  return createLocaleStore({
    storage,
    storageKey: STORAGE_KEY,
    preferredLanguages: () =>
      globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''],
  });
}

export function StudioLocaleProvider({ children }: PropsWithChildren) {
  const [store] = useState(browserStore);
  const locale = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void window.torchlauncher
      .request({ action: 'setLanguage', language: locale.locale })
      .catch(() => {});
  }, [locale.locale]);
  return <LocaleContext.Provider value={store}>{children}</LocaleContext.Provider>;
}

export function useStudioLocale() {
  const store = useContext(LocaleContext);
  if (!store) throw new Error('useStudioLocale must be used within StudioLocaleProvider');
  const locale = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const t = createTranslator(studioTranslations, locale.locale);
  return {
    locale: locale.locale,
    preference: locale.preference,
    t,
    setLocale: store.setLocale,
    useAutomaticLocale: store.useAutomaticLocale,
  };
}
