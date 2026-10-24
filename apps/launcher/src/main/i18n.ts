import type { Locale } from '@torchlauncher/core/i18n';
import { createTranslator, defineTranslations, normalizeLocale } from '@torchlauncher/core/i18n';

export const launcherMainTranslations = defineTranslations(
  {
    'dialog.shutdownMessage':
      'The game did not stop cleanly. Close the launcher again in a moment.',
    'dialog.confirm': 'OK',
    'dialog.addModTitle': 'Add a user mod',
    'dialog.minecraftModFilter': 'Minecraft mod',
  },
  {
    'dialog.shutdownMessage': '게임 종료를 확인하지 못했습니다. 잠시 후 런처를 다시 닫아 주세요.',
    'dialog.confirm': '확인',
    'dialog.addModTitle': '사용자 모드 추가',
    'dialog.minecraftModFilter': 'Minecraft 모드',
  },
);

export type LauncherMainLocale = Locale;
export function resolveMainLocale(locale: string): LauncherMainLocale {
  return normalizeLocale(locale) === 'ko' ? 'ko' : 'en';
}
export function launcherMainText(locale: LauncherMainLocale) {
  return createTranslator(launcherMainTranslations, locale);
}
