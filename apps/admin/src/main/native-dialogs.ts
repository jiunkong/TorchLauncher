import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { type StudioMainLocale, studioMainText } from './i18n.js';
import type { StudioDialogs } from './studio.js';

type NativeDialogs = {
  showOpenDialog(
    window: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    window: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<{ canceled: boolean; filePath?: string }>;
};

export function createStudioNativeDialogs(
  native: NativeDialogs,
  window: BrowserWindow,
  getLocale: () => StudioMainLocale,
): Pick<StudioDialogs, 'open' | 'save'> {
  return {
    open: async (kind, root) => {
      const t = studioMainText(getLocale());
      const directory = kind === 'project' || kind === 'projectparent' || kind === 'gamefolder';
      const result = await native.showOpenDialog(window, {
        title: {
          project: t('dialog.projectOpen'),
          projectparent: t('dialog.projectParent'),
          files: t('dialog.filesOpen'),
          binary: t('dialog.binaryOpen'),
          icon: t('dialog.iconOpen'),
          background: t('dialog.backgroundOpen'),
          keybackup: t('dialog.keyBackupOpen'),
          optionsfile: t('dialog.optionsOpen'),
          gamefolder: t('dialog.gameFolderOpen'),
          resourcepack: t('dialog.resourcePackOpen'),
          shaderpack: t('dialog.shaderPackOpen'),
          mod: t('dialog.modOpen'),
        }[kind],
        ...(root ? { defaultPath: root } : {}),
        properties: directory
          ? kind === 'projectparent'
            ? ['openDirectory', 'createDirectory']
            : ['openDirectory']
          : kind === 'files'
            ? ['openFile', 'multiSelections']
            : ['openFile'],
        ...(!directory && kind !== 'files'
          ? {
              filters:
                kind === 'icon' || kind === 'background'
                  ? [
                      {
                        name: t('dialog.brandingFilter'),
                        extensions: kind === 'icon' ? ['png'] : ['png', 'jpg', 'jpeg'],
                      },
                    ]
                  : kind === 'binary'
                    ? [{ name: t('dialog.binaryFilter'), extensions: ['exe', 'AppImage'] }]
                    : kind === 'keybackup'
                      ? [{ name: t('dialog.keyBackupFilter'), extensions: ['torchkey'] }]
                      : kind === 'optionsfile'
                        ? [{ name: t('dialog.optionsFilter'), extensions: ['txt'] }]
                        : kind === 'mod'
                          ? [{ name: t('dialog.modFilter'), extensions: ['jar'] }]
                          : [{ name: t('dialog.zipFilter'), extensions: ['zip'] }],
            }
          : {}),
      });
      return result.canceled ? null : result.filePaths;
    },
    save: async (kind) => {
      const t = studioMainText(getLocale());
      const result = await native.showSaveDialog(window, {
        title: {
          pack: t('dialog.packSave'),
          keybackup: t('dialog.keyBackupSave'),
          zip: t('dialog.zipSave'),
        }[kind],
        defaultPath: {
          pack: 'server.torchpack',
          keybackup: 'signing-key.torchkey',
          zip: 'launcher.zip',
        }[kind],
        filters: [
          {
            name: {
              pack: t('dialog.deploymentFileFilter'),
              keybackup: t('dialog.keyBackupFilter'),
              zip: t('dialog.zipFilter'),
            }[kind],
            extensions: [{ pack: 'torchpack', keybackup: 'torchkey', zip: 'zip' }[kind]],
          },
        ],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  };
}
