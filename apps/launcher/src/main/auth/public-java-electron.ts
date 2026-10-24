import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  DeviceCodePresenter,
} from '@torchlauncher/desktop-auth';
import { app, clipboard, safeStorage, shell } from 'electron';

/**
 * The device code is shown by the launcher window itself (an in-app modal fed by product state),
 * never by a second window. The presenter holds it only while a login waits and never logs it.
 */
export const loginDeviceCode = new DeviceCodePresenter({
  // Fixed trusted destination; provider-supplied URLs never reach openExternal.
  open: (url) => shell.openExternal(url),
  copy: (text) => clipboard.writeText(text),
});

export async function createPublicJavaAuthenticator(
  options: { cacheDirectory?: string; workerPath?: string; timeoutMs?: number } = {},
) {
  await app.whenReady();
  return createDesktopPublicJavaAuthenticator({
    cacheDirectory: options.cacheDirectory ?? join(app.getPath('userData'), 'public-java'),
    safeStorage,
    workerPath: options.workerPath ?? join(__dirname, 'public-java-worker.cjs'),
    showCode: (code, signal) => loginDeviceCode.show(code, signal),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
