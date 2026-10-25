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
import { studioChannel, studioCloseChannel } from '../shared/studio.js';
import { resolveMainLocale } from './i18n.js';
import { handleStudioRequest } from './ipc.js';
import { createLauncherResolver } from './launcher-release.js';
import { decodeNativeImage } from './native-branding.js';
import { createStudioNativeDialogs } from './native-dialogs.js';
import { SigningKeyStore } from './signing.js';
import { StudioService } from './studio.js';
import { createStudioTestRunner } from './test-auth.js';

const applicationName = applicationNames.studio;
let mainLocale = resolveMainLocale(app.getLocale());
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
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0809', symbolColor: '#bbaeaa', height: 36 },
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
      ...createStudioNativeDialogs(dialog, window, () => mainLocale),
      reveal: (path) => shell.showItemInFolder(path),
      openFolder: async (path) => {
        if (await shell.openPath(path)) throw new Error('Could not open log folder');
      },
      copy: (text) => clipboard.writeText(text),
    },
    undefined,
    decodeNativeImage,
    new SigningKeyStore(join(app.getPath('userData'), 'signing-keys'), safeStorage),
    createStudioTestRunner(),
    createLauncherResolver({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      appVersion: app.getVersion(),
      cacheDir: join(app.getPath('userData'), 'launcher-cache'),
    }),
  );
  ipcMain.removeHandler(studioChannel);
  ipcMain.handle(studioChannel, (event, input: unknown) =>
    handleStudioRequest(event, window.webContents, rendererUrl, service, input, (locale) => {
      mainLocale = locale;
    }),
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
  service.onExit(() => window.close());
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
