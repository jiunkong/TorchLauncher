import { createLocaleStore, createTranslator, type LocaleStore } from '@torchlauncher/core/i18n';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react';
import { launcherTranslations } from './catalog.js';

const STORAGE_KEY = 'torchlauncher.launcher.locale-preference';
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

export function LauncherLocaleProvider({ children }: PropsWithChildren) {
  const [store] = useState(browserStore);
  return <LocaleContext.Provider value={store}>{children}</LocaleContext.Provider>;
}

export function useLauncherLocale() {
  const store = useContext(LocaleContext);
  if (!store) throw new Error('useLauncherLocale must be used within LauncherLocaleProvider');
  const locale = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const t = createTranslator(launcherTranslations, locale.locale);
  return {
    locale: locale.locale,
    preference: locale.preference,
    t,
    setLocale: store.setLocale,
    useAutomaticLocale: store.useAutomaticLocale,
  };
}
