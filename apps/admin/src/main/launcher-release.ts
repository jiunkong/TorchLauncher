import { join } from 'node:path';
import {
  createLauncherReleaseClient,
  LAUNCHER_REPOSITORY,
  launcherAssetName,
  ReleaseFailure,
} from '../../../../packages/core/src/releases/index.js';
import type { LauncherReleaseInfo, LauncherTarget } from '../shared/studio.js';
import { validateLauncherBinary } from './filesystem.js';
import { StudioFailure } from './project.js';

export { LAUNCHER_REPOSITORY, launcherAssetName };
export const LAUNCHER_PACKAGE_DIR = '../launcher/dist';
export interface LauncherResolveRequest {
  target: LauncherTarget;
  allowCached: boolean;
  cachedVersion?: string;
  signal: AbortSignal;
  progress(bytes: number): void;
  status(info: LauncherReleaseInfo): void;
}
export type LauncherResolver = (request: LauncherResolveRequest) => Promise<string>;
export interface LauncherReleaseOptions {
  packaged: boolean;
  appPath: string;
  appVersion: string;
  cacheDir: string;
  repository?: string;
  /** Inject transport for tests; URL policy is enforced before every request, including redirects. */
  fetch?: typeof fetch;
}
export function createLauncherResolver(options: LauncherReleaseOptions): LauncherResolver {
  const client = createLauncherReleaseClient(options);
  return async (request) => {
    const { target, signal, status } = request;
    signal.throwIfAborted();
    if (!options.packaged) {
      const binary = join(
        options.appPath,
        LAUNCHER_PACKAGE_DIR,
        launcherAssetName(options.appVersion, target),
      );
      try {
        await validateLauncherBinary(binary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new StudioFailure('LAUNCHER_LOCAL_MISSING');
        throw error;
      }
      signal.throwIfAborted();
      status({ target, version: options.appVersion, source: 'local' });
      return binary;
    }
    try {
      const artifact = await client.download(target, request);
      signal.throwIfAborted();
      status({ target, version: artifact.version, source: artifact.source });
      return artifact.path;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof ReleaseFailure)) throw error;
      if (error.code === 'LAUNCHER_OFFLINE') {
        const cached = await client.cached(target, signal);
        signal.throwIfAborted();
        if (cached) {
          status({ target, version: cached.version, source: 'offline-cache' });
          if (!request.allowCached || request.cachedVersion !== cached.version)
            throw new StudioFailure('LAUNCHER_CACHE_CONFIRM');
          signal.throwIfAborted();
          return cached.path;
        }
      }
      throw new StudioFailure(
        error.code === 'UNSUPPORTED_TARGET' || error.code === 'NO_UPDATE' ? 'INVALID' : error.code,
      );
    }
  };
}
