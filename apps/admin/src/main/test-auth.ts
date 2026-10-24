import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  EncryptedMicrosoftTokenStorage,
  HostAuthenticationError,
} from '@torchlauncher/desktop-auth';
import { app, safeStorage, shell } from 'electron';
import { StudioTestRunner } from './test-run.js';

export const loginPageUrl = 'https://www.microsoft.com/link';

/**
 * The device code is shown by the Studio window itself (an in-app modal fed by `account.login`),
 * not by a second window. The code is only published to the runner state while the login waits and
 * is never logged.
 */
export function createStudioTestRunner() {
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
  let runner: StudioTestRunner | null = null;
  const auth = createDesktopPublicJavaAuthenticator({
    cacheDirectory: join(userData, 'public-java'),
    workerPath: join(__dirname, 'public-java-worker.cjs'),
    safeStorage,
    async showCode(code, signal) {
      if (!/^[A-Z0-9-]{4,16}$/.test(code)) throw new HostAuthenticationError('browser_failed');
      if (signal.aborted || !runner) return;
      const release = runner.publishLoginCode(code);
      try {
        await shell.openExternal(loginPageUrl);
        // Wait until the login finishes, is cancelled, fails or the app closes.
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        release();
      }
    },
  });
  runner = new StudioTestRunner({ userData, available, auth, launcherVersion: app.getVersion() });
  return runner;
}
