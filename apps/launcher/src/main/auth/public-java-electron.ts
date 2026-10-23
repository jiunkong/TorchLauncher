import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  HostAuthenticationError,
} from '@torchlauncher/desktop-auth';
import { app, BrowserWindow, safeStorage, shell } from 'electron';

async function showCode(code: string, signal: AbortSignal) {
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) throw new HostAuthenticationError('browser_failed');
  if (signal.aborted) return;
  const window = new BrowserWindow({
    width: 440,
    height: 240,
    show: false,
    autoHideMenuBar: true,
    title: 'TorchLauncher Microsoft 로그인',
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  let intentional = false;
  let finish: () => void = () => {};
  const closed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    window.once('closed', () =>
      intentional ? resolve() : reject(new HostAuthenticationError('cancelled')),
    );
  });
  void closed.catch(() => {});
  const abort = () => {
    intentional = true;
    if (!window.isDestroyed()) window.destroy();
    finish();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Microsoft 로그인</title><style>body{font:16px system-ui;padding:24px}code{font-size:32px;letter-spacing:4px}p{line-height:1.6}</style><h2>Microsoft 로그인</h2><code>${code}</code><p>열린 Microsoft 브라우저에 이 코드를 입력하세요.<br>취소하려면 이 창을 닫으세요.</p></html>`)}`,
    );
    if (signal.aborted) return;
    if (window.isDestroyed()) throw new HostAuthenticationError('cancelled');
    window.show();
    // Fixed trusted destination; provider-supplied URLs never reach openExternal.
    await shell.openExternal('https://www.microsoft.com/link');
    await closed;
  } finally {
    signal.removeEventListener('abort', abort);
    abort();
  }
}

export async function createPublicJavaAuthenticator(
  options: { cacheDirectory?: string; workerPath?: string; timeoutMs?: number } = {},
) {
  await app.whenReady();
  return createDesktopPublicJavaAuthenticator({
    cacheDirectory: options.cacheDirectory ?? join(app.getPath('userData'), 'public-java'),
    safeStorage,
    workerPath: options.workerPath ?? join(__dirname, 'public-java-worker.cjs'),
    showCode,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
