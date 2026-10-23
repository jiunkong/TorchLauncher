import { join } from 'node:path';
import {
  createDesktopPublicJavaAuthenticator,
  type DesktopPublicJavaOptions,
} from '@torchlauncher/desktop-auth';

/**
 * TESTRUN-MAIN-01 wiring example, with no launcher imports. Call after Studio readiness
 * and single-instance locking. Studio's UI adapter owns its app name, translations,
 * sandboxed code window and fixed https://www.microsoft.com/link browser destination.
 */
export function createStudioAuthentication(
  host: Pick<DesktopPublicJavaOptions, 'safeStorage' | 'showCode'> & {
    userData: string;
    mainDirectory: string;
  },
) {
  return createDesktopPublicJavaAuthenticator({
    cacheDirectory: join(host.userData, 'public-java'),
    workerPath: join(host.mainDirectory, 'public-java-worker.cjs'),
    safeStorage: host.safeStorage,
    showCode: host.showCode,
  });
}
