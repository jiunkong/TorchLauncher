import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  DeviceCodePresenter,
  EncryptedMicrosoftTokenStorage,
} from '@torchlauncher/desktop-auth';
import { app, clipboard, safeStorage, shell } from 'electron';
import { StudioTestRunner } from './test-run.js';

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
  const deviceCode = new DeviceCodePresenter({
    open: (url) => shell.openExternal(url),
    copy: (text) => clipboard.writeText(text),
  });
  const auth = createDesktopPublicJavaAuthenticator({
    cacheDirectory: join(userData, 'public-java'),
    workerPath: join(__dirname, 'public-java-worker.cjs'),
    safeStorage,
    showCode: (code, signal) => deviceCode.show(code, signal),
  });
  const runner = new StudioTestRunner({
    userData,
    available,
    auth,
    launcherVersion: app.getVersion(),
  });
  deviceCode.subscribe(() => runner.setLoginCode(deviceCode.code));
  return runner;
}
