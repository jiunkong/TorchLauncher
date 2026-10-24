import type { OpenDialogOptions } from 'electron';
import { type LauncherMainLocale, launcherMainText } from './i18n.js';

type NativeDialogs = {
  showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  showMessageBox(options: { type: 'error'; message: string; buttons: string[] }): Promise<unknown>;
};

export function createLauncherNativeDialogs(
  native: NativeDialogs,
  getLocale: () => LauncherMainLocale,
) {
  return {
    chooseMod: async () => {
      const t = launcherMainText(getLocale());
      const result = await native.showOpenDialog({
        title: t('dialog.addModTitle'),
        properties: ['openFile'],
        filters: [{ name: t('dialog.minecraftModFilter'), extensions: ['jar'] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    showShutdownFailure: () => {
      const t = launcherMainText(getLocale());
      return native.showMessageBox({
        type: 'error',
        message: t('dialog.shutdownMessage'),
        buttons: [t('dialog.confirm')],
      });
    },
  };
}
