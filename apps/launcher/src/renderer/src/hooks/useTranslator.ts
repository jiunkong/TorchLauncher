import { useLauncherLocale } from '../i18n';

export function useT() {
  return useLauncherLocale().t;
}
