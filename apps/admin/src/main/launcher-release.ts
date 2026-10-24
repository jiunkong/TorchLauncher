import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LauncherReleaseInfo, LauncherTarget } from '../shared/studio.js';
import {
  LAUNCHER_LIMIT,
  noLinks,
  safeRead,
  saveProject,
  validateLauncherBinary,
} from './filesystem.js';
import { StudioFailure } from './project.js';
import { hashFile } from './scan.js';

/** Official launcher releases. No renderer-controlled repository or asset URLs. */
export const LAUNCHER_REPOSITORY = 'jiunkong/TorchLauncher';
export const LAUNCHER_PACKAGE_DIR = '../launcher/dist';
export const launcherAssetName = (version: string, target: LauncherTarget): string =>
  `TorchLauncher-${version}-${target === 'windows' ? 'win-x64.exe' : 'linux-x64.AppImage'}`;
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const META_LIMIT = 2 * 1024 * 1024;
const VERSION = /^v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/;
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
interface Cached {
  repository: string;
  version: string;
  target: LauncherTarget;
  name: string;
  size: number;
  sha256: string;
}
function validUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StudioFailure('LAUNCHER_VERIFY');
  }
  if (
    url.protocol !== 'https:' ||
    !HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new StudioFailure('LAUNCHER_VERIFY');
  return url;
}
async function responseBody(
  response: Response,
  limit: number,
  consume: (chunk: Uint8Array) => Promise<void>,
): Promise<number> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new StudioFailure('LAUNCHER_VERIFY');
  }
  if (!response.body) throw new StudioFailure('LAUNCHER_VERIFY');
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new StudioFailure('LAUNCHER_OFFLINE');
      });
      if (done) break;
      size += value.length;
      if (size > limit) throw new StudioFailure('LAUNCHER_VERIFY');
      await consume(value);
    }
    if (length !== null && size !== Number(length)) throw new StudioFailure('LAUNCHER_VERIFY');
    return size;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Digest validation boundary; replace/extend with a signed manifest verifier in RELEASE-02. */
function checkDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new StudioFailure('LAUNCHER_VERIFY');
  return value.slice(7);
}
export function createLauncherResolver(options: LauncherReleaseOptions): LauncherResolver {
  const transport = options.fetch ?? fetch;
  const repository = options.repository ?? LAUNCHER_REPOSITORY;
  return async (request) => {
    const { target, signal, progress, status } = request;
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
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw new StudioFailure('LAUNCHER_UNCONFIGURED');
    // The deadline covers headers AND streamed bodies. Caller cancellation is never an offline fallback.
    const networkSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const get = async (value: string): Promise<Response> => {
      let url = validUrl(value);
      for (let redirects = 0; redirects <= 5; redirects++) {
        signal.throwIfAborted();
        if (networkSignal.aborted) throw new StudioFailure('LAUNCHER_OFFLINE');
        let response: Response;
        try {
          response = await transport(url, {
            signal: networkSignal,
            redirect: 'manual',
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'TorchLauncher-Studio',
            },
          });
        } catch {
          signal.throwIfAborted();
          throw new StudioFailure('LAUNCHER_OFFLINE');
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) throw new StudioFailure('LAUNCHER_VERIFY');
          url = validUrl(new URL(location, url).href);
          continue;
        }
        return response;
      }
      throw new StudioFailure('LAUNCHER_VERIFY');
    };
    const cacheRoot = join(options.cacheDir, target);
    const readCached = async (): Promise<{ data: Cached; binary: string } | null> => {
      try {
        const id = (await safeRead(join(cacheRoot, 'current'), 64)).toString();
        if (!/^[a-f0-9-]{36}$/.test(id)) return null;
        const dir = join(cacheRoot, id);
        const data = JSON.parse(
          (await safeRead(join(dir, 'metadata.json'), 4096)).toString(),
        ) as Cached;
        if (
          data.repository !== repository ||
          data.target !== target ||
          !VERSION.test(data.version) ||
          data.name !== launcherAssetName(data.version.replace(/^v/, ''), target) ||
          !Number.isSafeInteger(data.size) ||
          data.size < 4 ||
          data.size > LAUNCHER_LIMIT ||
          !/^[a-f0-9]{64}$/.test(data.sha256)
        )
          return null;
        const binary = join(dir, data.name);
        await validateLauncherBinary(binary);
        const actual = await hashFile(binary, LAUNCHER_LIMIT, signal);
        if (actual.size !== data.size || actual.sha256 !== data.sha256) return null;
        return { data, binary };
      } catch {
        signal.throwIfAborted();
        return null;
      }
    };
    const offlineFallback = async (error: unknown): Promise<string> => {
      signal.throwIfAborted();
      if (!(error instanceof StudioFailure) || error.code !== 'LAUNCHER_OFFLINE') throw error;
      const cached = await readCached();
      if (!cached) throw error;
      status({ target, version: cached.data.version, source: 'offline-cache' });
      if (!request.allowCached || request.cachedVersion !== cached.data.version)
        throw new StudioFailure('LAUNCHER_CACHE_CONFIRM');
      return cached.binary;
    };
    let release: Record<string, unknown>;
    try {
      const response = await get(`https://api.github.com/repos/${repository}/releases/latest`);
      if (!response.ok) {
        await response.body?.cancel();
        throw new StudioFailure(
          response.status === 404 ? 'LAUNCHER_NO_RELEASE' : 'LAUNCHER_RELEASE_FAILED',
        );
      }
      const chunks: Buffer[] = [];
      await responseBody(response, META_LIMIT, async (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      try {
        release = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new StudioFailure('LAUNCHER_VERIFY');
      }
      if (!release || typeof release !== 'object') throw new StudioFailure('LAUNCHER_VERIFY');
    } catch (error) {
      return offlineFallback(error);
    }
    if (
      release.draft !== false ||
      release.prerelease !== false ||
      typeof release.tag_name !== 'string' ||
      !VERSION.test(release.tag_name)
    )
      throw new StudioFailure('LAUNCHER_NO_RELEASE');
    const version = release.tag_name.replace(/^v/, '');
    const name = launcherAssetName(version, target);
    if (!Array.isArray(release.assets)) throw new StudioFailure('LAUNCHER_NO_ASSET');
    const matches = release.assets.filter(
      (a) => a && typeof a === 'object' && a.name === name && a.state === 'uploaded',
    );
    if (matches.length !== 1) throw new StudioFailure('LAUNCHER_NO_ASSET');
    const asset = matches[0];
    const sha256 = checkDigest(asset.digest);
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size < 4 ||
      asset.size > LAUNCHER_LIMIT ||
      typeof asset.browser_download_url !== 'string'
    )
      throw new StudioFailure('LAUNCHER_VERIFY');
    const assetUrl = validUrl(asset.browser_download_url);
    if (
      assetUrl.hostname !== 'github.com' ||
      assetUrl.pathname !== `/${repository}/releases/download/${release.tag_name}/${name}` ||
      assetUrl.search ||
      assetUrl.hash
    )
      throw new StudioFailure('LAUNCHER_VERIFY');
    const cached = await readCached();
    if (
      cached &&
      cached.data.version === version &&
      cached.data.sha256 === sha256 &&
      cached.data.size === asset.size
    ) {
      status({ target, version, source: 'cache' });
      return cached.binary;
    }
    // Create one component at a time only below a checked ancestor.
    const ensureDirectory = async (path: string): Promise<void> => {
      try {
        await noLinks(path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await ensureDirectory(dirname(path));
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await noLinks(path);
    };
    await ensureDirectory(cacheRoot);
    const id = randomUUID();
    const staging = join(cacheRoot, `.torchstudio-${id}.tmp`);
    const published = join(cacheRoot, id);
    await mkdir(staging, { mode: 0o700 });
    let committed = false;
    try {
      const response = await get(assetUrl.href);
      if (!response.ok) {
        await response.body?.cancel();
        throw new StudioFailure('LAUNCHER_RELEASE_FAILED');
      }
      const binary = join(staging, name);
      const handle = await open(binary, 'wx', 0o600);
      const hash = createHash('sha256');
      let received = 0;
      try {
        await responseBody(response, asset.size, async (chunk) => {
          signal.throwIfAborted();
          hash.update(chunk);
          // FileHandle.write may write fewer bytes than requested.
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
            if (!bytesWritten) throw new StudioFailure('IO');
            offset += bytesWritten;
          }
          received += chunk.length;
          progress(received);
        });
        if (received !== asset.size || hash.digest('hex') !== sha256)
          throw new StudioFailure('LAUNCHER_VERIFY');
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (target === 'linux') await chmod(binary, 0o755);
      try {
        await validateLauncherBinary(binary);
      } catch {
        throw new StudioFailure('LAUNCHER_VERIFY');
      }
      const metadata: Cached = { repository, version, target, name, sha256, size: asset.size };
      await saveProject(join(staging, 'metadata.json'), JSON.stringify(metadata));
      signal.throwIfAborted();
      await rename(staging, published);
      signal.throwIfAborted();
      // Immutable generation + atomic pointer: failures never destroy the previous cache.
      await saveProject(join(cacheRoot, 'current'), id);
      committed = true;
      status({ target, version, source: 'release' });
      return join(published, name);
    } catch (error) {
      return await offlineFallback(error);
    } finally {
      await rm(staging, { recursive: true, force: true });
      if (!committed) await rm(published, { recursive: true, force: true });
    }
  };
}
