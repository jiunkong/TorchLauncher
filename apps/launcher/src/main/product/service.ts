import { release } from 'node:os';
import { openDeploymentReader } from '../../../../../packages/core/src/deployment/reader/index';
import { createFullDownloader } from '../../../../../packages/core/src/download/full/index';
import { createDownloadSource } from '../../../../../packages/core/src/download/source/index';
import {
  deleteServerData,
  discardDeletionConfirmation,
  ensureServerDataRoot,
  getServerDataUsage,
  previewServerDataDeletion,
  readServerDataMarker,
  resolveServerDataRoot,
} from '../../../../../packages/core/src/instance/data/index';
import { verifyServerRoot } from '../../../../../packages/core/src/instance/data/paths';
import {
  adoptUnregistered,
  listMods,
  registerUserMod,
  removeUserMod,
} from '../../../../../packages/core/src/instance/mods/index';
import {
  applySettingsPolicy,
  getResourcePacks,
  setUserResourcePacks,
} from '../../../../../packages/core/src/instance/settings/index';
import { readSyncOwnership } from '../../../../../packages/core/src/instance/sync/ownership';
import { installLoader } from '../../../../../packages/core/src/loaders/installer';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import { installMinecraft } from '../../../../../packages/core/src/minecraft/installer';
import type { LaunchAuth } from '../../../../../packages/core/src/minecraft/launch';
import type { RunningGame } from '../../../../../packages/core/src/minecraft/process';
import { recoverExitedGameLock } from '../../../../../packages/core/src/minecraft/recovery/environment';
import {
  inspectServerEnvironment,
  recoverServerEnvironment,
} from '../../../../../packages/core/src/minecraft/recovery/index';
import type { ServerConfig } from '../../../../../packages/core/src/server-config/index';
import { pingServer } from '../../../../../packages/core/src/server-status/index';
import { type ProductResult, type ProductState, parseProductCommand } from '../../shared/product';
import { installationActivity, synchronizationActivity } from './activity';
import { Operations } from './operations';
import { readPreferences, writePreferences } from './preferences';

export interface ProductHost {
  base: string;
  version: string;
  config: ServerConfig | null;
  auth: {
    login(signal?: AbortSignal): Promise<LaunchAuth>;
    refresh(signal?: AbortSignal): Promise<LaunchAuth>;
    logout(): Promise<void>;
  };
  chooseMod(): Promise<string | null>;
  confirmDeletion(root: string): Promise<boolean>;
  confirmRecovery(): Promise<boolean>;
  publish(state: ProductState): void;
  quit?(): void;
}
const safeCodes = new Set([
  'busy',
  'preferences-failed',
  'invalid-request',
  'unsupported-platform',
  'unsupported-game',
  'configuration-unavailable',
  'cancelled',
  'no_session',
  'reauthentication_required',
  'game_not_owned',
  'profile_required',
  'storage_failed',
  'secure_storage_unavailable',
  'browser_failed',
  'network_failed',
  'timeout',
  'root-not-found',
  'deletion-incomplete',
  'unmarked-root',
  'unsafe-path',
  'locked',
  'lock-uncertain',
  'recovery-required',
  'sync-recovery-required',
  'options-owned-by-sync',
  'sync-not-initialized',
  'required-pack-removed',
  'required-pack-reordered',
  'unsupported-options-version',
  'invalid-policy',
  'invalid-options',
  'invalid-state',
  'path-conflict',
  'mod-id-conflict',
  'local-changed',
  'not-registered',
  'not-unregistered',
  'invalid-jar',
  'insufficient-space',
  'limit-exceeded',
  'confirmation-invalid',
  'confirmation-expired',
  'file-changed',
  'EDEPLOYMENTCHANGED',
  'ESERVERIDENTITY',
  'EINSTALLIDENTITY',
  'ESYNCGUARD',
  'EAUTHEXPIRED',
]);
export function safeProductError(error: unknown, cancelled = false): string {
  if (cancelled) return 'cancelled';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && safeCodes.has(code)) return code;
  if (error instanceof Error && safeCodes.has(error.message)) return error.message;
  return 'operation-failed';
}
export class ProductService {
  private readonly operations = new Operations();
  private game: RunningGame | undefined;
  private preferencesLoaded = false;
  private relinquished = false;
  private readonly state: ProductState;
  constructor(private readonly host: ProductHost) {
    const config = host.config;
    this.state = {
      preferences: { closeOnLaunch: false },
      server: config
        ? { serverId: config.serverId, name: config.name, address: config.address }
        : null,
      ...(config?.game
        ? {
            game: {
              minecraftVersion: config.game.minecraftVersion,
              loader: config.game.loader.kind,
              loaderVersion: config.game.loader.version,
            },
          }
        : {}),
      configuration: config ? 'ready' : 'unavailable',
      supported:
        (process.platform === 'linux' || process.platform === 'win32') && process.arch === 'x64',
      account: null,
      status: { state: 'unknown' },
      operation: null,
      phase: 'idle',
      progress: null,
      activity: null,
      running: false,
      outcome: null,
      error: null,
      mods: [],
      modsRecovery: false,
      packs: [],
      missingPacks: [],
      usage: null,
      deletion: null,
      recovery: null,
      logs: [],
    };
  }
  snapshot(): ProductState {
    return structuredClone(this.state);
  }
  private publish() {
    this.host.publish(this.snapshot());
  }
  private phase(phase: string) {
    this.state.phase = phase;
    this.state.progress = null;
    this.state.activity = null;
    this.publish();
  }
  private config() {
    if (!this.host.config) throw new Error('configuration-unavailable');
    return this.host.config;
  }
  private root() {
    return resolveServerDataRoot(this.host.base, this.config().serverId);
  }
  private async ensure() {
    try {
      await this.verified();
      const marker = await readServerDataMarker(this.root(), this.config().serverId);
      if (marker.state === 'valid') {
        await recoverExitedGameLock(this.root());
        const environment = await inspectServerEnvironment(this.root());
        if (environment.serverLock.state !== 'free') throw new Error('locked');
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'root-not-found') throw error;
    }
    return ensureServerDataRoot(this.host.base, this.config().serverId);
  }
  private async verified() {
    return verifyServerRoot(this.host.base, this.config().serverId);
  }
  private ownership = () => readSyncOwnership(this.root(), this.config().serverId);
  private invalidateDeletion() {
    if (this.state.deletion?.confirmation)
      discardDeletionConfirmation(this.state.deletion.confirmation);
    this.state.deletion = null;
  }
  async restoreSession(): Promise<void> {
    await this.execute({ type: 'refresh' }, true);
  }
  command(raw: unknown): Promise<ProductResult> {
    return this.execute(raw);
  }
  private async execute(raw: unknown, restoring = false): Promise<ProductResult> {
    let command: ReturnType<typeof parseProductCommand>;
    try {
      command = parseProductCommand(raw);
    } catch {
      return { ok: false, error: 'invalid-request', state: this.snapshot() };
    }
    if (command.type === 'cancel' || command.type === 'stop') {
      this.operations.cancel();
      if (this.game && !this.game.detached) await this.game.stop();
      return { ok: true, state: this.snapshot() };
    }
    try {
      await this.operations.run(async (signal) => {
        this.state.operation = command.type;
        this.state.error = null;
        this.state.outcome = null;
        this.phase(command.type);
        try {
          if (!this.preferencesLoaded) {
            try {
              this.state.preferences = await readPreferences(this.host.base);
            } catch {
              this.state.preferences = { closeOnLaunch: false, error: 'preferences-failed' };
            }
            this.preferencesLoaded = true;
          }
          signal.throwIfAborted();
          if (command.type !== 'delete' && command.type !== 'preview-delete')
            this.invalidateDeletion();
          switch (command.type) {
            case 'set-close-on-launch':
              try {
                await writePreferences(this.host.base, { closeOnLaunch: command.value });
              } catch {
                throw new Error('preferences-failed');
              }
              this.state.preferences = { closeOnLaunch: command.value };
              break;
            case 'login':
            case 'refresh': {
              const auth = await this.host.auth[command.type](signal);
              this.state.account = { name: auth.profile.name, expiresAt: auth.expiresAt };
              break;
            }
            case 'logout':
              this.state.account = null;
              await this.host.auth.logout();
              break;
            case 'status':
              try {
                this.state.status = {
                  state: 'online',
                  ...(await pingServer(this.config().address, { signal })),
                };
              } catch (error) {
                this.state.status = { state: 'unavailable' };
                throw error;
              }
              break;
            case 'launch':
              await this.launch(signal);
              break;
            case 'inspect':
              await this.inspect();
              break;
            case 'recover': {
              await this.verified();
              if (command.acceptUncertain && !(await this.host.confirmRecovery())) break;
              signal.throwIfAborted();
              const report = await recoverServerEnvironment(this.root(), {
                serverId: this.config().serverId,
                acceptUncertain: command.acceptUncertain,
                signal,
              });
              this.state.recovery = {
                needed: report.environment.needsRecovery,
                lock: report.environment.serverLock.state,
                confirmable: report.environment.serverLock.confirmable,
                issues: report.issues.map((issue) => issue.code),
              };
              this.state.outcome = report.status;
              break;
            }
            case 'mods':
              await this.ensure();
              await this.mods(signal);
              break;
            case 'add-mod': {
              await this.ensure();
              const sourcePath = await this.host.chooseMod();
              signal.throwIfAborted();
              if (sourcePath) {
                await registerUserMod({
                  root: this.root(),
                  serverId: this.config().serverId,
                  sourcePath,
                  signal,
                  onProgress: (progress) => {
                    this.state.phase = `mod-${progress.phase}`;
                    if (progress.phase === 'copying')
                      this.state.progress = { completed: progress.bytes, total: progress.total };
                    this.publish();
                  },
                });
                await this.mods(signal);
              }
              break;
            }
            case 'remove-mod':
            case 'adopt-mod': {
              await this.ensure();
              const options = {
                root: this.root(),
                serverId: this.config().serverId,
                path: command.path,
                signal,
              };
              if (command.type === 'remove-mod') await removeUserMod(options);
              else await adoptUnregistered(options);
              await this.mods(signal);
              break;
            }
            case 'packs':
              await this.ensure();
              await this.packs(signal);
              break;
            case 'set-packs':
              await this.ensure();
              await setUserResourcePacks(this.root(), command.packs, {
                minecraftVersion: '1.21.1',
                signal,
                ownership: this.ownership,
              });
              await this.packs(signal);
              break;
            case 'usage': {
              const usage = await getServerDataUsage(this.host.base, this.config().serverId, {
                signal,
              });
              this.state.usage =
                usage.status === 'complete'
                  ? { bytes: usage.bytes, files: usage.files, directories: usage.directories }
                  : null;
              if (usage.status !== 'complete') throw new Error('limit-exceeded');
              break;
            }
            case 'preview-delete': {
              this.invalidateDeletion();
              const preview = await previewServerDataDeletion(
                this.host.base,
                this.config().serverId,
                { signal },
              );
              this.state.deletion = {
                root: preview.root,
                deletable: preview.deletable,
                blockers: preview.blockers,
                incomplete: preview.deletionInProgress,
                bytes: preview.usage?.status === 'complete' ? preview.usage.bytes : null,
                confirmation: preview.confirmation?.token ?? null,
              };
              break;
            }
            case 'delete': {
              if (command.confirmation !== this.state.deletion?.confirmation)
                throw new Error('confirmation-invalid');
              const root = this.state.deletion.root;
              if (!(await this.host.confirmDeletion(root))) {
                this.invalidateDeletion();
                break;
              }
              signal.throwIfAborted();
              this.state.deletion = null;
              await deleteServerData(this.host.base, this.config().serverId, command.confirmation, {
                signal,
                onProgress: (progress) => {
                  this.state.phase = progress.phase;
                  this.state.progress = progress.expectedEntries
                    ? { completed: progress.removedEntries, total: progress.expectedEntries }
                    : null;
                  this.publish();
                },
              });
              this.state.mods = [];
              this.state.packs = [];
              this.state.missingPacks = [];
              this.state.usage = null;
              this.state.recovery = null;
              this.state.logs = [];
              this.state.outcome = 'deleted';
              break;
            }
          }
        } catch (error) {
          if (command.type === 'login' || command.type === 'refresh') this.state.account = null;
          const code = safeProductError(error, signal.aborted);
          this.state.error = restoring && code === 'no_session' ? null : code;
          throw new Error(code);
        } finally {
          this.state.operation = null;
          this.state.progress = null;
          this.state.activity = null;
          if (!this.state.running) this.state.phase = 'idle';
          this.publish();
        }
      });
      if (this.relinquished) {
        await this.operations.close();
        this.host.quit?.();
      }
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      return { ok: false, error: safeProductError(error), state: this.snapshot() };
    }
  }
  private async inspect() {
    try {
      await this.verified();
    } catch (error) {
      if ((error as { code?: string }).code === 'root-not-found') {
        this.state.recovery = null;
        return;
      }
      throw error;
    }
    const environment = await inspectServerEnvironment(this.root());
    this.state.recovery = {
      needed: environment.needsRecovery,
      lock: environment.serverLock.state,
      confirmable: environment.serverLock.confirmable,
      issues: [],
    };
  }
  private async mods(signal: AbortSignal) {
    const mods = await listMods({ root: this.root(), serverId: this.config().serverId, signal });
    this.state.mods = mods.entries.map((mod) => ({
      path: mod.path,
      source: mod.source,
      state: mod.state,
      conflicts: mod.conflicts.length,
      modIds: [...mod.modIds],
    }));
    this.state.modsRecovery = mods.recoveryRequired;
  }
  private async packs(signal: AbortSignal) {
    const packs = await getResourcePacks(this.root(), { minecraftVersion: '1.21.1', signal });
    this.state.packs = packs.packs;
    this.state.missingPacks = packs.missingRequired;
  }
  private logs() {
    if (!this.game) return;
    // Core already removes credentials/account IDs; discard URL-bearing content and terminal controls again at IPC.
    this.state.logs = this.game
      .getLogs()
      .entries.map((entry) =>
        entry.text.replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\p{Cc}\p{Cf}]/gu, ''),
      )
      .slice(-300);
    this.publish();
  }
  private async launch(signal: AbortSignal) {
    if (!this.state.supported) throw new Error('unsupported-platform');
    const config = this.config();
    await this.ensure();
    await this.inspect();
    if (this.state.recovery?.needed) throw new Error('recovery-required');
    const root = this.root();
    const download = createFullDownloader();
    const current = async (requestedSignal?: AbortSignal) =>
      openDeploymentReader(createDownloadSource(config.sourceUrl), {
        expectedServerId: config.serverId,
        ...(requestedSignal ? { signal: requestedSignal } : {}),
      });
    const game = await launchDeployment({
      root,
      expectedServerId: config.serverId,
      server: config.address,
      launcherVersion: this.host.version,
      signal,
      process: this.state.preferences.closeOnLaunch ? { detachable: true } : {},
      current,
      onPhase: (phase) => this.phase(phase),
      onSynchronizationProgress: (progress) => {
        // SyncCounts describe planned operations, not completed downloads.
        if (!progress.path) {
          this.state.activity = {
            phase: progress.phase,
            component: 'server-file',
            active: 0,
            completed: null,
            total: null,
          };
          this.publish();
        }
      },
      onSynchronizationActivity: (activity) => {
        this.state.activity = synchronizationActivity(activity);
        this.publish();
      },
      prepare: async (reader) => {
        if (reader.index.game.minecraftVersion !== '1.21.1') throw new Error('unsupported-game');
        this.state.game = {
          minecraftVersion: reader.index.game.minecraftVersion,
          loader: reader.index.game.loader.kind,
          loaderVersion: reader.index.game.loader.version,
        };
        this.publish();
        const base = await installMinecraft({
          root,
          version: '1.21.1',
          platform: {
            os: process.platform === 'win32' ? 'windows' : 'linux',
            arch: 'x64',
            version: release(),
          },
          download,
          signal,
          onActivity: (activity) => {
            this.state.activity = installationActivity(activity);
            this.publish();
          },
          onProgress: ({ completed, total }) => {
            this.state.progress = { completed, total };
            this.publish();
          },
        });
        this.phase('loader-installation');
        this.state.activity = {
          phase: 'installing',
          component: 'loader',
          active: 1,
          completed: null,
          total: null,
        };
        this.publish();
        return installLoader(base, { selection: reader.index.game.loader, download, signal });
      },
      authenticate: async () => {
        const auth = await this.host.auth.refresh(signal).catch((error: unknown) => {
          this.state.account = null;
          throw error;
        });
        this.state.account = { name: auth.profile.name, expiresAt: auth.expiresAt };
        return auth;
      },
      afterSynchronization: async () => {
        await applySettingsPolicy(root, {
          minecraftVersion: '1.21.1',
          signal,
          ownership: this.ownership,
        });
        await this.mods(signal);
        await this.packs(signal);
      },
    });
    this.game = game;
    this.state.running = true;
    this.state.runningSince = Date.now();
    this.phase('game-running');
    if (this.state.preferences.closeOnLaunch) {
      try {
        signal.throwIfAborted();
        if (!game.detach || !this.host.quit) throw new Error('handoff-unavailable');
        await game.detach();
        this.game = undefined;
        this.relinquished = true;
        this.state.running = false;
        delete this.state.runningSince;
        this.state.outcome = 'game-detached';
        return;
      } catch (error) {
        await game.stop();
        this.game = undefined;
        this.state.running = false;
        delete this.state.runningSince;
        throw error;
      }
    }
    const interval = setInterval(() => this.logs(), 1000);
    try {
      const exit = await game.finished;
      this.logs();
      this.state.outcome =
        exit.reason === 'exited' ? `exited-${exit.code ?? 'unknown'}` : exit.reason;
    } finally {
      clearInterval(interval);
      this.game = undefined;
      this.state.running = false;
      delete this.state.runningSince;
    }
  }
  async close() {
    const closing = this.operations.close();
    try {
      if (this.game && !this.game.detached) await this.game.stop();
      await closing;
      this.invalidateDeletion();
    } catch (error) {
      this.state.error = 'shutdown-failed';
      this.state.phase = 'shutdown-blocked';
      this.publish();
      throw error;
    }
  }
}
