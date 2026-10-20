import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applicationInfoChannel,
  applicationNames,
  isTrustedRendererUrl,
} from '@torchlauncher/core/desktop';
import { app, BrowserWindow, ipcMain, session } from 'electron';

const applicationName = applicationNames.studio;
app.setName(applicationName);

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl =
    (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    title: applicationName,
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
  window.once('closed', () => ipcMain.removeHandler(applicationInfoChannel));

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
