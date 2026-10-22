import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applicationInfoChannel,
  applicationNames,
  isTrustedRendererUrl,
} from '@torchlauncher/core/desktop';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { brandingDialogText, studioChannel } from '../shared/studio.js';
import { handleStudioRequest } from './ipc.js';
import { decodeNativeImage } from './native-branding.js';
import { StudioService } from './studio.js';

const applicationName = applicationNames.studio;
app.setName(applicationName);

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl =
    (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    title: applicationName,
    icon: join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? 'branding/icon.png' : '../../assets/branding/icon.png',
    ),
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: '#141619',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const service = new StudioService(
    {
      open: async (kind, root) => {
        const directory = kind === 'source' || kind === 'output';
        const result = await dialog.showOpenDialog(window, {
          title: {
            project: '프로젝트 열기',
            source: '배포 소스 폴더',
            files: '소스 폴더 안의 파일 선택',
            binary: '기존 공통 런처 선택',
            output: '비어 있는 출력 폴더 선택',
            icon: brandingDialogText.icon,
            background: brandingDialogText.background,
          }[kind],
          ...(root ? { defaultPath: root } : {}),
          properties: directory
            ? ['openDirectory']
            : kind === 'files'
              ? ['openFile', 'multiSelections']
              : ['openFile'],
          ...(!directory && kind !== 'files'
            ? {
                filters:
                  kind === 'icon' || kind === 'background'
                    ? [
                        {
                          name: brandingDialogText.filter,
                          extensions: kind === 'icon' ? ['png'] : ['png', 'jpg', 'jpeg'],
                        },
                      ]
                    : kind === 'binary'
                      ? [{ name: '공통 런처', extensions: ['exe', 'AppImage'] }]
                      : [{ name: 'Studio 프로젝트', extensions: ['json'] }],
              }
            : {}),
        });
        return result.canceled ? null : result.filePaths;
      },
      save: async (kind) => {
        const result = await dialog.showSaveDialog(window, {
          title: kind === 'project' ? '프로젝트 저장' : 'torchpack 생성',
          defaultPath: kind === 'project' ? 'server-project.json' : 'server.torchpack',
          filters: [
            {
              name: kind === 'project' ? 'Studio 프로젝트' : '배포 파일',
              extensions: [kind === 'project' ? 'json' : 'torchpack'],
            },
          ],
        });
        return result.canceled ? null : (result.filePath ?? null);
      },
      discard: async () =>
        (
          await dialog.showMessageBox(window, {
            type: 'warning',
            message: '저장하지 않은 프로젝트 변경을 버리시겠습니까?',
            buttons: ['돌아가기', '변경 버리기'],
            defaultId: 0,
            cancelId: 0,
          })
        ).response === 1,
    },
    undefined,
    decodeNativeImage,
  );
  ipcMain.removeHandler(studioChannel);
  ipcMain.handle(studioChannel, (event, input: unknown) =>
    handleStudioRequest(event, window.webContents, rendererUrl, service, input),
  );

  ipcMain.removeHandler(applicationInfoChannel);
  ipcMain.handle(applicationInfoChannel, (event) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
    ) {
      throw new Error('Untrusted application information request');
    }

    return {
      name: applicationName,
      version: app.getVersion(),
      platform: process.platform,
    };
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  let closing = false;
  window.on('close', (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    void service
      .close()
      .then(() => service.canDiscard())
      .then((discard) => {
        if (discard) window.destroy();
        else {
          service.resume();
          closing = false;
        }
      })
      .catch(() => {
        service.resume();
        closing = false;
      });
  });
  window.once('closed', () => {
    ipcMain.removeHandler(applicationInfoChannel);
    ipcMain.removeHandler(studioChannel);
  });

  void window.loadURL(rendererUrl).catch((error: unknown) => {
    console.error('Could not load application window', error);
    app.quit();
  });
}

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
