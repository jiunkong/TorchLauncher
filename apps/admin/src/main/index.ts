import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applicationInfoChannel,
  applicationNames,
  isTrustedRendererUrl,
} from '@torchlauncher/core/desktop';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
} from 'electron';
import { brandingDialogText, studioChannel, studioCloseChannel } from '../shared/studio.js';
import { handleStudioRequest } from './ipc.js';
import { decodeNativeImage } from './native-branding.js';
import { SigningKeyStore } from './signing.js';
import { StudioService } from './studio.js';
import { createStudioTestRunner } from './test-auth.js';

const applicationName = applicationNames.studio;
app.setName(applicationName);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

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
        const directory = kind === 'source' || kind === 'gamefolder';
        const result = await dialog.showOpenDialog(window, {
          title: {
            project: '프로젝트 열기',
            source: '배포 소스 폴더',
            files: '소스 폴더 안의 파일 선택',
            binary: '기존 공통 런처 선택',
            icon: brandingDialogText.icon,
            background: brandingDialogText.background,
            keybackup: '서명 키 백업 파일 선택',
            optionsfile: 'options.txt 선택',
            gamefolder: '게임을 한 번 실행한 폴더 선택',
            resourcepack: '리소스팩(.zip) 선택',
            shaderpack: '셰이더팩(.zip) 선택',
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
                      : kind === 'keybackup'
                        ? [{ name: '서명 키 백업', extensions: ['tlkey'] }]
                        : kind === 'optionsfile'
                          ? [{ name: 'options.txt', extensions: ['txt'] }]
                          : kind === 'resourcepack' || kind === 'shaderpack'
                            ? [{ name: 'ZIP', extensions: ['zip'] }]
                            : [{ name: 'Studio 프로젝트', extensions: ['json'] }],
              }
            : {}),
        });
        return result.canceled ? null : result.filePaths;
      },
      save: async (kind) => {
        const result = await dialog.showSaveDialog(window, {
          title: {
            project: '프로젝트 저장',
            pack: 'torchpack 생성',
            keybackup: '서명 키 백업 저장',
            zip: '런처 내보내기 ZIP 저장',
          }[kind],
          defaultPath: {
            project: 'server-project.json',
            pack: 'server.torchpack',
            keybackup: 'signing-key.tlkey',
            zip: 'launcher.zip',
          }[kind],
          filters: [
            {
              name: {
                project: 'Studio 프로젝트',
                pack: '배포 파일',
                keybackup: '서명 키 백업',
                zip: 'ZIP',
              }[kind],
              extensions: [
                { project: 'json', pack: 'torchpack', keybackup: 'tlkey', zip: 'zip' }[kind],
              ],
            },
          ],
        });
        return result.canceled ? null : (result.filePath ?? null);
      },
      reveal: (path) => shell.showItemInFolder(path),
      copy: (text) => clipboard.writeText(text),
    },
    undefined,
    decodeNativeImage,
    new SigningKeyStore(join(app.getPath('userData'), 'signing-keys'), safeStorage),
    createStudioTestRunner(),
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
  let closeTimer: NodeJS.Timeout | null = null;
  const settle = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  };
  service.onCloseAnswer({
    confirm: () => {
      settle();
      window.destroy();
    },
    cancel: () => {
      settle();
      service.resume();
      closing = false;
    },
  });
  window.on('close', (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    void service
      .close()
      .then(() => {
        if (service.beginClose()) {
          window.destroy();
          return;
        }
        // The renderer shows its own confirmation. No answer in time keeps the window open:
        // unsaved work is never discarded on a timeout.
        window.webContents.send(studioCloseChannel);
        closeTimer = setTimeout(() => service.abandonClose(), 60_000);
      })
      .catch(() => {
        service.abandonClose();
        service.resume();
        closing = false;
      });
  });
  window.once('closed', () => {
    ipcMain.removeHandler(applicationInfoChannel);
    ipcMain.removeHandler(studioChannel);
  });

  void window.loadURL(rendererUrl).catch((error: unknown) => {
    // One clear line (the message carries Chromium's code, e.g. ERR_UNSAFE_PORT) and a failing exit code.
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not load the application window from ${rendererUrl}: ${reason}\n`);
    // Normal shutdown first, then a failing exit code so this never looks like a clean exit.
    app.once('quit', () => process.exit(1));
    app.quit();
  });
}

if (primary)
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
