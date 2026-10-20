// Dedicated harness entry; never imported by the product main process.
import { join } from 'node:path';
import { AuthenticationError, type StoredMicrosoftSession } from '@torchlauncher/core/auth';
import { app, safeStorage } from 'electron';
import { createElectronAuthenticator } from './electron';
import { HostAuthenticationError } from './errors';
import { EncryptedMicrosoftTokenStorage } from './storage';

interface SmokeConfig {
  mode: string;
  dataDirectory: string;
  clientId?: string;
  redirectUri?: string;
}

const syntheticKey = 'torchlauncher.microsoft.00000000-0000-4000-8000-000000000002';
const syntheticSession: StoredMicrosoftSession = {
  version: 1,
  refreshToken: 'auth-storage-smoke-synthetic-value-not-a-credential',
};
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

function report(result: Record<string, unknown>, exitCode: number) {
  process.stdout.write(`TORCH_AUTH_SMOKE_RESULT ${JSON.stringify(result)}\n`, () =>
    app.exit(exitCode),
  );
}

async function run() {
  const config = JSON.parse(process.env.TORCH_AUTH_SMOKE_CONFIG ?? '{}') as SmokeConfig;
  if (!config.dataDirectory || !config.mode)
    throw new HostAuthenticationError('invalid_configuration');
  app.setName('TorchLauncher Auth Smoke');
  app.setPath('userData', config.dataDirectory);
  if (!app.requestSingleInstanceLock()) throw new HostAuthenticationError('busy');
  await app.whenReady();
  const storage = new EncryptedMicrosoftTokenStorage({
    directory: join(config.dataDirectory, 'accounts'),
    safeStorage,
  });
  const result = { mode: config.mode, platform: process.platform };
  if (config.mode === 'reject-basic') {
    if (process.platform !== 'linux') throw new HostAuthenticationError('invalid_configuration');
    try {
      storage.assertSecureBackend();
    } catch (error) {
      if (
        error instanceof HostAuthenticationError &&
        error.code === 'secure_storage_unavailable' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text'
      ) {
        return { ...result, ok: true, plaintextRejected: true, liveAuthentication: false };
      }
      throw error;
    }
    throw new HostAuthenticationError('storage_failed');
  }
  if (config.mode === 'probe') {
    const backend =
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform;
    const encryptionAvailable = safeStorage.isEncryptionAvailable();
    try {
      storage.assertSecureBackend();
      return {
        ...result,
        ok: true,
        backend,
        encryptionAvailable,
        secureStorage: true,
        liveAuthentication: false,
      };
    } catch (error) {
      if (!(error instanceof HostAuthenticationError)) throw error;
      return {
        ...result,
        ok: false,
        backend,
        encryptionAvailable,
        code: error.code,
        liveAuthentication: false,
      };
    }
  }
  if (config.mode.startsWith('storage-')) {
    if (config.mode === 'storage-write') {
      if ((await storage.read(syntheticKey)) !== null)
        throw new HostAuthenticationError('storage_failed');
      await storage.write(syntheticKey, syntheticSession);
    } else if (config.mode === 'storage-read') {
      const stored = await storage.read(syntheticKey);
      if (stored?.refreshToken !== syntheticSession.refreshToken)
        throw new HostAuthenticationError('storage_failed');
    } else if (config.mode === 'storage-clear') {
      await storage.clear(syntheticKey);
    } else if (config.mode === 'storage-empty') {
      if ((await storage.read(syntheticKey)) !== null)
        throw new HostAuthenticationError('storage_failed');
    } else throw new HostAuthenticationError('invalid_configuration');
    return { ...result, ok: true, liveAuthentication: false };
  }
  if (!config.clientId || !config.redirectUri)
    throw new HostAuthenticationError('invalid_configuration');
  // Logout can remove ciphertext even if an OS keyring has become unavailable.
  if (config.mode === 'logout') {
    await storage.clear(`torchlauncher.microsoft.${config.clientId.toLowerCase()}`);
    return { ...result, ok: true };
  }
  if (config.mode === 'assert-empty') {
    if ((await storage.read(`torchlauncher.microsoft.${config.clientId.toLowerCase()}`)) !== null) {
      throw new HostAuthenticationError('storage_failed');
    }
    return { ...result, ok: true };
  }
  const auth = await createElectronAuthenticator({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
  });
  const account =
    config.mode === 'login'
      ? await auth.login(controller.signal)
      : config.mode === 'refresh'
        ? await auth.refresh(controller.signal)
        : undefined;
  if (!account || account.expiresAt <= Date.now())
    throw new HostAuthenticationError('invalid_configuration');
  // Deliberately excludes profile, tokens, URL/state and client configuration from diagnostics.
  return { ...result, ok: true, gameEntitlementVerified: true, profileVerified: true };
}

void run()
  .then((result) => report(result, result.ok === true ? 0 : 1))
  .catch((error: unknown) => {
    if (error instanceof AuthenticationError) {
      report(
        {
          ok: false,
          code: error.code,
          stage: error.stage,
          status: error.status,
          xboxError: error.xboxError,
        },
        1,
      );
    } else if (error instanceof HostAuthenticationError) {
      report({ ok: false, code: error.code }, 1);
    } else report({ ok: false, code: 'harness_failed' }, 1);
  });
