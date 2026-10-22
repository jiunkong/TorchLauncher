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
  nativeImage,
  session,
  shell,
} from 'electron';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index';
import { createDownloadSource } from '../../../../packages/core/src/download/source/index';
import { brandingChangedChannel } from '../shared/branding';
import { productStateChannel } from '../shared/product';
import { createPublicJavaAuthenticator } from './auth/public-java-electron';
import { type BrandingService, createBrandingService } from './branding';
import { bindBrandingIpc } from './branding/ipc';
import { readServerConfig, serverConfigPath } from './product/bootstrap';
import { bindProductIpc } from './product/ipc';
import { ProductService } from './product/service';
import { createPlayerSkinService } from './skins';

const applicationName = applicationNames.launcher;
app.setName(applicationName);
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let product: ProductService | undefined;
let branding: BrandingService | undefined;
let mainWindow: BrowserWindow | undefined;
let shutdownFinished = false;
let shutdown: Promise<void> | undefined;

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl =
    (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    title: branding?.snapshot().appName ?? applicationName,
    icon: join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? 'branding/icon.png' : '../../assets/branding/icon.png',
    ),
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: '#0e0b0c',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  window.on('page-title-updated', (event) => event.preventDefault());
  const unbindBranding = branding
    ? bindBrandingIpc(ipcMain, window, rendererUrl, branding)
    : () => {};
  const icon = branding?.snapshot().icon;
  if (icon) window.setIcon(nativeImage.createFromDataURL(icon));
  const unbind = product
    ? bindProductIpc(ipcMain, window, rendererUrl, product, (text) => clipboard.writeText(text))
    : () => {};
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
  window.once('ready-to-show', () => {
    window.show();
    void product?.restoreSession();
  });
  window.on('close', (event) => {
    if (!shutdownFinished) {
      event.preventDefault();
      app.quit();
    }
  });
  window.once('closed', () => {
    unbind();
    unbindBranding();
    ipcMain.removeHandler(applicationInfoChannel);
    mainWindow = undefined;
  });

  void window.loadURL(rendererUrl).catch((error: unknown) => {
    console.error('Could not load application window', error);
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (shutdownFinished) return;
  event.preventDefault();
  shutdown ??= (async () => {
    const brandingClosed = branding?.close();
    await product?.close();
    await brandingClosed;
    shutdownFinished = true;
    app.quit();
  })();
  void shutdown.catch(() => {
    // Keep the host alive if child cleanup cannot be verified; allow a later close to retry.
    shutdown = undefined;
    void dialog.showMessageBox({
      type: 'error',
      message: '게임 종료를 확인하지 못했습니다. 잠시 후 런처를 다시 닫아 주세요.',
      buttons: ['확인'],
    });
  });
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

if (primaryInstance)
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    const configPath = serverConfigPath({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      executable: process.execPath,
      environment: process.env,
    });
    const config = await readServerConfig(configPath).catch(() => null);
    branding = createBrandingService({
      base: app.getPath('userData'),
      config,
      configPath,
      openReader: (signal) => {
        if (!config) return Promise.reject(new Error('unconfigured'));
        return openDeploymentReader(createDownloadSource(config.sourceUrl), {
          expectedServerId: config.serverId,
          signal,
        });
      },
      publish: (snapshot) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setTitle(snapshot.appName);
        mainWindow.setIcon(
          snapshot.icon
            ? nativeImage.createFromDataURL(snapshot.icon)
            : nativeImage.createFromPath(
                join(
                  app.isPackaged ? process.resourcesPath : app.getAppPath(),
                  app.isPackaged ? 'branding/icon.png' : '../../assets/branding/icon.png',
                ),
              ),
        );
        mainWindow.webContents.send(brandingChangedChannel, snapshot);
      },
    });
    const auth = await createPublicJavaAuthenticator({
      cacheDirectory: join(app.getPath('userData'), 'authentication', 'public-java'),
    });
    product = new ProductService({
      base: app.getPath('userData'),
      version: app.getVersion(),
      config,
      auth,
      skins: createPlayerSkinService(),
      observeDeployment: (reader) => branding?.observe(reader),
      quit: () => app.quit(),
      openLogs: (path) => shell.openPath(path),
      chooseMod: async () => {
        const result = await dialog.showOpenDialog({
          title: '사용자 모드 추가',
          properties: ['openFile'],
          filters: [{ name: 'Minecraft mod', extensions: ['jar'] }],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      publish: (state) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(productStateChannel, state);
      },
    });
    createWindow();
    branding.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

// Authentication helper windows have no authority over application lifetime.
app.on('window-all-closed', () => {});
