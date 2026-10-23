import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  EncryptedMicrosoftTokenStorage,
  HostAuthenticationError,
} from '@torchlauncher/desktop-auth';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { testAuthText } from '../shared/test-auth-text.js';
import { StudioTestRunner } from './test-run.js';

export function createStudioTestRunner(parent: BrowserWindow) {
  const userData = app.getPath('userData');
  const available = () => {
    try {
      new EncryptedMicrosoftTokenStorage({
        directory: join(userData, 'accounts'),
        safeStorage,
      }).assertSecureBackend();
      return true;
    } catch {
      return false;
    }
  };
  const auth = createDesktopPublicJavaAuthenticator({
    cacheDirectory: join(userData, 'public-java'),
    workerPath: join(__dirname, 'public-java-worker.cjs'),
    safeStorage,
    async showCode(code, signal) {
      if (!/^[A-Z0-9-]{4,16}$/.test(code)) throw new HostAuthenticationError('browser_failed');
      if (signal.aborted) return;
      const locale = app.getLocale().startsWith('ko') ? 'ko' : 'en';
      const text = testAuthText[locale];
      const window = new BrowserWindow({
        parent,
        width: 440,
        height: 260,
        show: false,
        autoHideMenuBar: true,
        title: `${app.getName()} — ${text.title}`,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      let intentional = false;
      const closed = new Promise<void>((resolve, reject) => {
        window.once('closed', () =>
          intentional ? resolve() : reject(new HostAuthenticationError('cancelled')),
        );
      });
      void closed.catch(() => {});
      const abort = () => {
        intentional = true;
        if (!window.isDestroyed()) window.destroy();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${text.title}</title><style>body{font:16px system-ui;padding:24px}code{font-size:32px;letter-spacing:4px}p{line-height:1.6}</style><h2>${text.title}</h2><code>${code}</code><p>${text.instruction}<br>${text.cancel}</p></html>`)}`,
        );
        if (signal.aborted) return;
        if (window.isDestroyed()) throw new HostAuthenticationError('cancelled');
        window.show();
        await shell.openExternal('https://www.microsoft.com/link');
        await closed;
      } finally {
        signal.removeEventListener('abort', abort);
        abort();
      }
    },
  });
  return new StudioTestRunner({ userData, available, auth, launcherVersion: app.getVersion() });
}
