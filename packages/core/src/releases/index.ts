import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  hashFile,
  LAUNCHER_LIMIT,
  noLinks,
  safeRead,
  validateLauncherBinary,
  writeAtomicFile,
} from './filesystem.js';
import {
  compareStableVersions,
  type LauncherTarget,
  parseStableVersion,
  type ReleaseApplication,
  type ReleaseArtifact,
  ReleaseFailure,
  type ReleaseMetadata,
  type ReleaseOptions,
} from './types.js';

export * from './types.js';
export const LAUNCHER_REPOSITORY = 'jiunkong/TorchLauncher';
export const launcherAssetName = (
  version: string,
  target: LauncherTarget,
  application: ReleaseApplication = 'launcher',
): string =>
  `TorchLauncher${application === 'studio' ? ' Studio' : ''}-${version}-${target === 'windows' ? 'win-x64.exe' : 'linux-x64.AppImage'}`;
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const META_LIMIT = 2 * 1024 * 1024;
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
    throw new ReleaseFailure('LAUNCHER_VERIFY');
  }
  if (
    url.protocol !== 'https:' ||
    !HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new ReleaseFailure('LAUNCHER_VERIFY');
  return url;
}
async function responseBody(
  response: Response,
  signal: AbortSignal,
  limit: number,
  consume: (chunk: Uint8Array) => Promise<void>,
): Promise<number> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new ReleaseFailure('LAUNCHER_VERIFY');
  }
  if (!response.body) throw new ReleaseFailure('LAUNCHER_VERIFY');
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new ReleaseFailure('LAUNCHER_OFFLINE');
      });
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ReleaseFailure('LAUNCHER_VERIFY');
      await consume(value);
    }
    if (length !== null && size !== Number(length)) throw new ReleaseFailure('LAUNCHER_VERIFY');
    return size;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Digest validation boundary; replace/extend with a signed manifest verifier in RELEASE-02. */
function checkDigest(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 71 || !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ReleaseFailure('LAUNCHER_VERIFY');
  return value.slice(7);
}

export function createLauncherReleaseClient(options: ReleaseOptions) {
  const application = options.application ?? 'launcher';
  if (application !== 'launcher' && application !== 'studio')
    throw new ReleaseFailure('LAUNCHER_UNCONFIGURED');
  const transport = options.fetch ?? fetch;
  const repository = options.repository ?? LAUNCHER_REPOSITORY;
  function context(target: LauncherTarget, signal: AbortSignal) {
    signal.throwIfAborted();
    if (target !== 'windows' && target !== 'linux') throw new ReleaseFailure('UNSUPPORTED_TARGET');
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split('/').some((part) => part === '.' || part === '..')
    )
      throw new ReleaseFailure('LAUNCHER_UNCONFIGURED');
    // The deadline covers headers AND streamed bodies. Caller cancellation is never an offline fallback.
    const networkSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const get = async (value: string): Promise<Response> => {
      let url = validUrl(value);
      for (let redirects = 0; redirects <= 5; redirects++) {
        signal.throwIfAborted();
        if (networkSignal.aborted) throw new ReleaseFailure('LAUNCHER_OFFLINE');
        let response: Response;
        try {
          response = await transport(url, {
            signal: networkSignal,
            redirect: 'manual',
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'TorchLauncher',
            },
          });
        } catch {
          signal.throwIfAborted();
          throw new ReleaseFailure('LAUNCHER_OFFLINE');
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) throw new ReleaseFailure('LAUNCHER_VERIFY');
          try {
            url = validUrl(new URL(location, url).href);
          } catch {
            throw new ReleaseFailure('LAUNCHER_VERIFY');
          }
          continue;
        }
        return response;
      }
      throw new ReleaseFailure('LAUNCHER_VERIFY');
    };
    const consumeBody = async (
      response: Response,
      limit: number,
      consume: (chunk: Uint8Array) => Promise<void>,
    ) => {
      try {
        return await responseBody(response, networkSignal, limit, consume);
      } catch (error) {
        signal.throwIfAborted();
        if (networkSignal.aborted) throw new ReleaseFailure('LAUNCHER_OFFLINE');
        throw error;
      }
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
          !parseStableVersion(data.version) ||
          data.name !== launcherAssetName(data.version.replace(/^v/, ''), target, application) ||
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

    const latest = async (): Promise<ReleaseMetadata> => {
      let release: Record<string, unknown>;
      {
        const response = await get(`https://api.github.com/repos/${repository}/releases/latest`);
        if (!response.ok) {
          await response.body?.cancel();
          throw new ReleaseFailure(
            response.status === 404 ? 'LAUNCHER_NO_RELEASE' : 'LAUNCHER_RELEASE_FAILED',
          );
        }
        const chunks: Buffer[] = [];
        await consumeBody(response, META_LIMIT, async (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        try {
          release = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw new ReleaseFailure('LAUNCHER_VERIFY');
        }
        if (!release || typeof release !== 'object') throw new ReleaseFailure('LAUNCHER_VERIFY');
      }
      if (
        release.draft !== false ||
        release.prerelease !== false ||
        typeof release.tag_name !== 'string' ||
        !parseStableVersion(release.tag_name)
      )
        throw new ReleaseFailure('LAUNCHER_NO_RELEASE');
      const version = release.tag_name.replace(/^v/, '');
      const name = launcherAssetName(version, target, application);
      if (!Array.isArray(release.assets)) throw new ReleaseFailure('LAUNCHER_NO_ASSET');
      const matches = release.assets.filter(
        (a) => a && typeof a === 'object' && a.name === name && a.state === 'uploaded',
      );
      if (matches.length !== 1) throw new ReleaseFailure('LAUNCHER_NO_ASSET');
      const asset = matches[0];
      const sha256 = checkDigest(asset.digest);
      if (
        !Number.isSafeInteger(asset.size) ||
        asset.size < 4 ||
        asset.size > LAUNCHER_LIMIT ||
        typeof asset.browser_download_url !== 'string'
      )
        throw new ReleaseFailure('LAUNCHER_VERIFY');
      const assetUrl = validUrl(asset.browser_download_url);
      if (
        assetUrl.hostname !== 'github.com' ||
        assetUrl.pathname !==
          `/${repository}/releases/download/${release.tag_name}/${encodeURIComponent(name)}` ||
        assetUrl.search ||
        assetUrl.hash
      )
        throw new ReleaseFailure('LAUNCHER_VERIFY');

      signal.throwIfAborted();
      return { repository, target, version, name, sha256, size: asset.size, url: assetUrl.href };
    };
    return { latest, readCached, get, consumeBody };
  }
  return {
    async latest(target: LauncherTarget, signal: AbortSignal) {
      return context(target, signal).latest();
    },
    async cached(target: LauncherTarget, signal: AbortSignal): Promise<ReleaseArtifact | null> {
      const cached = await context(target, signal).readCached();
      signal.throwIfAborted();
      return cached ? { ...cached.data, path: cached.binary, source: 'cache' } : null;
    },
    async download(
      target: LauncherTarget,
      request: { signal: AbortSignal; progress?: (bytes: number) => void; newerThan?: string },
    ): Promise<ReleaseArtifact> {
      const { signal } = request;
      const progress = request.progress ?? (() => {});
      const { latest, readCached, get, consumeBody } = context(target, signal);
      // Never accept caller-supplied metadata as authority for executable bytes.
      const release = await latest();
      if (
        request.newerThan !== undefined &&
        compareStableVersions(release.version, request.newerThan) <= 0
      )
        throw new ReleaseFailure('NO_UPDATE');
      const { version, name, sha256 } = release;
      const asset = { size: release.size };
      const assetUrl = new URL(release.url);
      const cacheRoot = join(options.cacheDir, target);
      const cached = await readCached();
      if (
        cached &&
        cached.data.version === version &&
        cached.data.sha256 === sha256 &&
        cached.data.size === asset.size
      ) {
        signal.throwIfAborted();
        return { ...cached.data, path: cached.binary, source: 'cache' as const };
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
      const staging = join(cacheRoot, `.torch-release-${id}.tmp`);
      const published = join(cacheRoot, id);
      await mkdir(staging, { mode: 0o700 });
      let committed = false;
      try {
        const response = await get(assetUrl.href);
        if (!response.ok) {
          await response.body?.cancel();
          throw new ReleaseFailure('LAUNCHER_RELEASE_FAILED');
        }
        const binary = join(staging, name);
        const handle = await open(binary, 'wx', 0o600);
        const hash = createHash('sha256');
        let received = 0;
        try {
          await consumeBody(response, asset.size, async (chunk) => {
            signal.throwIfAborted();
            hash.update(chunk);
            // FileHandle.write may write fewer bytes than requested.
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
              if (!bytesWritten) throw new ReleaseFailure('IO');
              offset += bytesWritten;
            }
            received += chunk.length;
            progress(received);
          });
          if (received !== asset.size || hash.digest('hex') !== sha256)
            throw new ReleaseFailure('LAUNCHER_VERIFY');
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (target === 'linux') await chmod(binary, 0o755);
        try {
          await validateLauncherBinary(binary);
        } catch {
          throw new ReleaseFailure('LAUNCHER_VERIFY');
        }
        const metadata: Cached = { repository, version, target, name, sha256, size: asset.size };
        await writeAtomicFile(join(staging, 'metadata.json'), JSON.stringify(metadata));
        signal.throwIfAborted();
        await rename(staging, published);
        signal.throwIfAborted();
        // Immutable generation + atomic pointer: failures never destroy the previous cache.
        await writeAtomicFile(join(cacheRoot, 'current'), id, signal);
        committed = true;
        signal.throwIfAborted();
        return { ...metadata, path: join(published, name), source: 'release' as const };
      } finally {
        await rm(staging, { recursive: true, force: true });
        if (!committed) await rm(published, { recursive: true, force: true });
      }
    },
  };
}
