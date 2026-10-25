import {
  compareStableVersions,
  createLauncherReleaseClient,
  launcherTarget,
  parseStableVersion,
  type ReleaseArtifact,
  type ReleaseErrorCode,
  ReleaseFailure,
  type ReleaseOptions,
} from '../../../../../packages/core/src/releases/index.js';

export type UpdateState =
  | { phase: 'idle' | 'checking' | 'current' | 'cancelled' }
  | { phase: 'available'; version: string; size: number }
  | { phase: 'downloading'; received: number }
  | { phase: 'downloaded'; version: string; size: number }
  | { phase: 'error'; code: ReleaseErrorCode };
export interface UpdateOptions extends ReleaseOptions {
  currentVersion: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** Unconnected main-process backend. Downloaded means cached bytes, never installed or executed. */
export function createLauncherUpdater(options: UpdateOptions) {
  const target = launcherTarget(options.platform ?? process.platform, options.arch ?? process.arch);
  if (!parseStableVersion(options.currentVersion)) throw new ReleaseFailure('LAUNCHER_VERIFY');
  const client = createLauncherReleaseClient(options);
  let state: UpdateState = { phase: 'idle' };
  let active: AbortController | undefined;
  function begin() {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    return controller;
  }
  function publish(controller: AbortController, next: UpdateState) {
    controller.signal.throwIfAborted();
    if (active === controller) state = next;
  }
  function failed(controller: AbortController, error: unknown): never {
    if (active === controller) {
      state = controller.signal.aborted
        ? { phase: 'cancelled' }
        : { phase: 'error', code: error instanceof ReleaseFailure ? error.code : 'IO' };
    }
    throw error;
  }
  return {
    /** Safe to expose later: no local paths, transport URLs or raw error strings. */
    snapshot(): UpdateState {
      return { ...state };
    },
    cancel() {
      if (!active) return;
      active.abort();
      active = undefined;
      state = { phase: 'cancelled' };
    },
    async check(): Promise<UpdateState> {
      const controller = begin();
      publish(controller, { phase: 'checking' });
      try {
        const latest = await client.latest(target, controller.signal);
        publish(
          controller,
          compareStableVersions(latest.version, options.currentVersion) > 0
            ? { phase: 'available', version: latest.version, size: latest.size }
            : { phase: 'current' },
        );
        return { ...state };
      } catch (error) {
        return failed(controller, error);
      } finally {
        if (active === controller) active = undefined;
      }
    },
    /** Always refreshes metadata and requires a strictly newer stable version before fetching bytes. */
    async download(): Promise<ReleaseArtifact> {
      const controller = begin();
      publish(controller, { phase: 'downloading', received: 0 });
      try {
        const artifact = await client.download(target, {
          signal: controller.signal,
          newerThan: options.currentVersion,
          progress(received) {
            publish(controller, { phase: 'downloading', received });
          },
        });
        publish(controller, {
          phase: 'downloaded',
          version: artifact.version,
          size: artifact.size,
        });
        return artifact;
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error instanceof ReleaseFailure &&
          error.code === 'NO_UPDATE'
        ) {
          publish(controller, { phase: 'current' });
          throw error;
        }
        return failed(controller, error);
      } finally {
        if (active === controller) active = undefined;
      }
    },
  };
}
