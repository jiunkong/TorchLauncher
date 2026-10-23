import type { SafeStorageBoundary } from './encrypted-store';
import { PublicJavaAuthenticator, type PublicJavaOptions } from './public-java';
import { EncryptedPublicJavaCache } from './public-java-cache';

export interface DesktopPublicJavaOptions extends Omit<PublicJavaOptions, 'store'> {
  /** Dedicated app userData/public-java directory, outside deletable game instances. */
  cacheDirectory: string;
  /** Supply Electron safeStorage after app.whenReady(); plaintext backends remain forbidden. */
  safeStorage: SafeStorageBoundary;
}

/**
 * Electron-free composition. The host owns readiness, single-instance locking, app-named
 * device-code UI, external browser opening and the absolute path to its bundled worker.
 * There are no implicit application paths or shared account stores.
 */
export function createDesktopPublicJavaAuthenticator(options: DesktopPublicJavaOptions) {
  const { cacheDirectory, safeStorage, ...auth } = options;
  return new PublicJavaAuthenticator({
    ...auth,
    store: new EncryptedPublicJavaCache({ directory: cacheDirectory, safeStorage }),
  });
}
