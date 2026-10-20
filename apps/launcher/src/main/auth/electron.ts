import { join } from 'node:path';
import { MicrosoftAuthenticator } from '@torchlauncher/core/auth';
import { app, safeStorage, shell } from 'electron';
import { LoopbackAuthenticationBrowser } from './browser';
import { EncryptedMicrosoftTokenStorage } from './storage';

export interface ElectronAuthenticatorOptions {
  clientId: string;
  redirectUri: string;
  /** Trusted application account directory, shared across servers; never renderer-controlled. */
  tokenDirectory?: string;
  timeoutMs?: number;
}

/** Caller must acquire app.requestSingleInstanceLock() before creating this host. */
export async function createElectronAuthenticator(options: ElectronAuthenticatorOptions) {
  await app.whenReady();
  const storage = new EncryptedMicrosoftTokenStorage({
    directory: options.tokenDirectory ?? join(app.getPath('userData'), 'accounts'),
    safeStorage,
  });
  storage.assertSecureBackend();
  const browser = new LoopbackAuthenticationBrowser({
    openExternal: (url) => shell.openExternal(url),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return new MicrosoftAuthenticator({ ...options, browser, storage });
}
