import type { DeploymentReader } from '../deployment/reader/index.js';
import { synchronizeDeployment } from '../instance/sync/index.js';
import { assertSynchronizedForLaunch } from '../instance/sync/launch-guard.js';
import type { Installation } from '../minecraft/installer';
import type { LaunchAuth } from '../minecraft/launch';
import {
  type GameProcessOptions,
  GameStartError,
  launchMinecraft,
  type RunningGame,
} from '../minecraft/process';

function pair(reader: DeploymentReader) {
  const game = reader.index.game;
  return `${game.minecraftVersion}:${game.loader.kind}:${game.loader.version}`;
}
function fingerprint(reader: DeploymentReader) {
  return `${reader.header.indexSha256}:${reader.header.totalLength}:${reader.index.serverId}`;
}
export interface LaunchDeploymentOptions {
  root: string;
  onPhase?: (
    phase:
      | 'deployment'
      | 'installation'
      | 'authentication'
      | 'latest-deployment'
      | 'synchronization'
      | 'settings'
      | 'final-guard'
      | 'spawn',
  ) => void;
  launcherVersion?: string;
  expectedServerId: string;
  server: string;
  signal?: AbortSignal;
  /** Each call must perform a fresh network header/index read, with cancellation. No cached/offline bypass. */
  current(signal?: AbortSignal): Promise<DeploymentReader>;
  prepare(reader: DeploymentReader): Promise<Installation>;
  authenticate(): Promise<LaunchAuth>;
  /** Trusted host-only policy application, after latest sync and before acquiring the game lease. */
  afterSynchronization?(reader: DeploymentReader): Promise<void>;
  process?: Omit<GameProcessOptions, 'preSpawn' | 'signal'>;
}
/** Installation/authentication, a fresh mandatory sync, then final remote/local checks under game lease. */
export async function launchDeployment(options: LaunchDeploymentOptions): Promise<RunningGame> {
  options.signal?.throwIfAborted();
  options.onPhase?.('deployment');
  const first = await options.current(options.signal);
  if (first.index.serverId !== options.expectedServerId)
    throw new GameStartError('ESERVERIDENTITY');
  options.onPhase?.('installation');
  const installation = await options.prepare(first);
  options.onPhase?.('authentication');
  const auth = await options.authenticate();
  options.onPhase?.('latest-deployment');
  const accepted = await options.current(options.signal);
  if (pair(first) !== pair(accepted)) throw new GameStartError('EDEPLOYMENTCHANGED');
  if (
    !installation.loader ||
    installation.loader.minecraftVersion !== accepted.index.game.minecraftVersion ||
    installation.loader.kind !== accepted.index.game.loader.kind ||
    installation.loader.version !== accepted.index.game.loader.version
  )
    throw new GameStartError('EINSTALLIDENTITY');
  if (installation.root !== options.root) throw new GameStartError('EINSTALLIDENTITY');
  options.onPhase?.('synchronization');
  await synchronizeDeployment({
    root: options.root,
    reader: accepted,
    expectedServerId: options.expectedServerId,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  options.signal?.throwIfAborted();
  if (options.afterSynchronization) {
    options.onPhase?.('settings');
    await options.afterSynchronization(accepted);
    options.signal?.throwIfAborted();
  }
  return launchMinecraft(
    installation,
    {
      auth,
      launcherVersion: options.launcherVersion ?? 'game-smoke',
      quickPlayServer: options.server,
    },
    {
      ...options.process,
      ...(options.signal ? { signal: options.signal } : {}),
      preSpawn: async ({ root, signal }) => {
        try {
          const fresh = await options.current(signal);
          if (fingerprint(fresh) !== fingerprint(accepted) || pair(fresh) !== pair(accepted))
            throw new GameStartError('EDEPLOYMENTCHANGED');
          if (auth.expiresAt <= Date.now()) throw new GameStartError('EAUTHEXPIRED');
          if (
            !installation.loader ||
            installation.loader.minecraftVersion !== fresh.index.game.minecraftVersion ||
            installation.loader.kind !== fresh.index.game.loader.kind ||
            installation.loader.version !== fresh.index.game.loader.version
          )
            throw new GameStartError('EINSTALLIDENTITY');
          await assertSynchronizedForLaunch({
            root,
            reader: fresh,
            expectedServerId: options.expectedServerId,
            signal,
          });
        } catch (error) {
          if (error instanceof GameStartError) throw error;
          throw new GameStartError('ESYNCGUARD');
        }
      },
    },
  );
}
