import { lstat, realpath } from 'node:fs/promises';
import { release, totalmem } from 'node:os';
import { join } from 'node:path';
import type { DeploymentReader } from '../../../../../packages/core/src/deployment/reader/index';
import { createFullDownloader } from '../../../../../packages/core/src/download/full/index';
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
  removeUnregistered,
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
import {
  resolveGameMemory,
  type ServerConfig,
} from '../../../../../packages/core/src/server-config/index';
import { pingServer } from '../../../../../packages/core/src/server-status/index';
import {
  type ProductLogEntry,
  type ProductResult,
  type ProductState,
  parseProductCommand,
} from '../../shared/product';
import { installationActivity, synchronizationActivity } from './activity';
import { openServerDeployment, recordAppliedDeployment } from './deployment-trust';
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
  skins?: { get(profileId: string, signal?: AbortSignal): Promise<string | null>; clear(): void };
  observeDeployment?(reader: DeploymentReader): void;
  openLogs?(path: string): Promise<string>;
  /** The pending Microsoft device code (see `DeviceCodePresenter`); mirrored into `state.loginCode`. */
  deviceCode?: {
    readonly code: string | null;
    subscribe(listener: () => void): () => void;
    copy(): boolean;
  };
  chooseMod(): Promise<string | null>;
  publish(state: ProductState): void;
  quit?(): void;
}
const safeCodes = new Set([
  'busy',
  'preferences-failed',
  'memory-limit',
  'memory-limit-server',
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
  'signature-invalid',
  'signature-malformed',
  'invalid-signing-key',
  'signature-unverified',
  'rollback-lower',
  'rollback-conflict',
  'rollback-state-unreadable',
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
  private preferencesQueue: Promise<void> = Promise.resolve();
  private closing = false;
  private skinGeneration = 0;
  private skinRequest: AbortController | undefined;
  private relinquished = false;
  private launcherLogs: ProductLogEntry[] = [];
  private gameLogs: ProductLogEntry[] = [];
  private readonly state: ProductState;
  constructor(private readonly host: ProductHost) {
    const config = host.config;
    const reportedMemoryMiB = Math.floor(totalmem() / (1024 * 1024));
    this.state = {
      preferences: { closeOnLaunch: false },
      physicalMemoryMiB: Number.isSafeInteger(reportedMemoryMiB)
        ? Math.max(0, reportedMemoryMiB)
        : 0,
      ...(config?.memory ? { serverMemory: { ...config.memory } } : {}),
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
      serverDataRoot: config ? resolveServerDataRoot(host.base, config.serverId) : null,
      usage: null,
      deletion: null,
      recovery: null,
      logs: [],
    };
    host.deviceCode?.subscribe(() => {
      const code = host.deviceCode?.code;
      if (code) this.state.loginCode = code;
      else delete this.state.loginCode;
      this.publish();
    });
  }
  private clearSkin() {
    this.skinGeneration++;
    this.skinRequest?.abort();
    this.skinRequest = undefined;
    this.host.skins?.clear();
    if (this.state.account) delete this.state.account.skin;
  }
  private setAccount(auth: LaunchAuth) {
    this.skinRequest?.abort();
    const generation = ++this.skinGeneration;
    this.state.account = { name: auth.profile.name, expiresAt: auth.expiresAt };
    if (!this.host.skins || this.closing) return;
    const account = this.state.account;
    const controller = new AbortController();
    this.skinRequest = controller;
    // Cosmetic lookup must never delay authentication or the game launch gate.
    void Promise.resolve()
      .then(() =>
        controller.signal.aborted || this.closing
          ? null
          : this.host.skins?.get(auth.profile.id, controller.signal),
      )
      .then((skin) => {
        if (
          !skin ||
          controller.signal.aborted ||
          this.closing ||
          generation !== this.skinGeneration ||
          this.state.account !== account
        )
          return;
        account.skin = skin;
        this.publish();
      })
      .catch(() => {});
  }
  private async openLogs(): Promise<ProductResult> {
    try {
      if (this.closing || this.relinquished) throw new Error('busy');
      if (!this.host.openLogs) throw new Error('operation-failed');
      const root = await this.verified();
      const path = join(root.realRoot, 'logs');
      const info = await lstat(path).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ENOENT') throw new Error('root-not-found');
        throw error;
      });
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
        throw new Error('unsafe-path');
      // Recheck the owned ancestry immediately before passing the fixed canonical folder to the host.
      if ((await this.verified()).realRoot !== root.realRoot) throw new Error('unsafe-path');
      if (this.closing || this.relinquished) throw new Error('busy');
      if (await this.host.openLogs(path)) throw new Error('operation-failed');
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      return { ok: false, error: safeProductError(error), state: this.snapshot() };
    }
  }
  snapshot(): ProductState {
    return structuredClone(this.state);
  }
  private publish() {
    this.host.publish(this.snapshot());
  }
  /** Launcher events carry fixed codes only: never tokens, accounts, URLs or paths. */
  private log(text: string) {
    this.launcherLogs = [...this.launcherLogs, { source: 'launcher' as const, text }].slice(-200);
    this.state.logs = [...this.launcherLogs, ...this.gameLogs];
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
  /** Startup automation: safe environment recovery first, then silent session restore. */
  async restoreSession(): Promise<void> {
    await this.execute({ type: 'inspect' }, true);
    await this.execute({ type: 'refresh' }, true);
  }
  command(raw: unknown): Promise<ProductResult> {
    return this.execute(raw);
  }
  private withPreferences<T>(work: () => Promise<T>): Promise<T> {
    const result = this.preferencesQueue.then(work);
    this.preferencesQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async loadPreferences(): Promise<void> {
    if (this.preferencesLoaded) return;
    try {
      this.state.preferences = await readPreferences(this.host.base);
    } catch {
      this.state.preferences = { closeOnLaunch: false, error: 'preferences-failed' };
    }
    this.preferencesLoaded = true;
  }
  private async saveGameMemory(
    command: Extract<ReturnType<typeof parseProductCommand>, { type: 'set-game-memory' }>,
  ): Promise<ProductResult> {
    try {
      if (this.closing || this.relinquished) throw new Error('busy');
      await this.withPreferences(async () => {
        if (this.closing || this.relinquished) throw new Error('busy');
        await this.loadPreferences();
        if (this.state.preferences.error) throw new Error('preferences-failed');
        const maximum = Math.min(65536, this.state.physicalMemoryMiB);
        const initial = command.initialMemoryMiB;
        if (
          maximum < 512 ||
          command.maxMemoryMiB < 512 ||
          command.maxMemoryMiB > maximum ||
          (initial !== undefined &&
            (initial < 256 || initial > command.maxMemoryMiB || initial > maximum))
        )
          throw new Error('memory-limit');
        const preferences = {
          ...this.state.preferences,
          maxMemoryMiB: command.maxMemoryMiB,
          ...(initial === undefined
            ? { initialMemoryMiB: undefined }
            : { initialMemoryMiB: initial }),
        };
        const persisted = {
          closeOnLaunch: preferences.closeOnLaunch,
          maxMemoryMiB: preferences.maxMemoryMiB,
          ...(preferences.initialMemoryMiB === undefined
            ? {}
            : { initialMemoryMiB: preferences.initialMemoryMiB }),
        };
        await writePreferences(this.host.base, persisted);
        this.state.preferences = persisted;
      });
      this.publish();
      return { ok: true as const, state: this.snapshot() };
    } catch (error) {
      return { ok: false as const, error: safeProductError(error), state: this.snapshot() };
    }
  }
  /** Drops the personal memory override; the server default (or built-in default) applies again. */
  private async clearGameMemory(): Promise<ProductResult> {
    try {
      if (this.closing || this.relinquished) throw new Error('busy');
      await this.withPreferences(async () => {
        if (this.closing || this.relinquished) throw new Error('busy');
        await this.loadPreferences();
        if (this.state.preferences.error) throw new Error('preferences-failed');
        const persisted = { closeOnLaunch: this.state.preferences.closeOnLaunch };
        await writePreferences(this.host.base, persisted);
        this.state.preferences = persisted;
      });
      this.publish();
      return { ok: true as const, state: this.snapshot() };
    } catch (error) {
      return { ok: false as const, error: safeProductError(error), state: this.snapshot() };
    }
  }
  private async execute(raw: unknown, restoring = false): Promise<ProductResult> {
    let command: ReturnType<typeof parseProductCommand>;
    try {
      command = parseProductCommand(raw);
    } catch {
      return { ok: false, error: 'invalid-request', state: this.snapshot() };
    }
    if (command.type === 'set-language') return { ok: true, state: this.snapshot() };
    if (command.type === 'open-logs') return this.openLogs();
    if (command.type === 'copy-login-code')
      return this.host.deviceCode?.copy()
        ? { ok: true, state: this.snapshot() }
        : { ok: false, error: 'invalid-request', state: this.snapshot() };
    if (command.type === 'set-game-memory') return this.saveGameMemory(command);
    if (command.type === 'clear-game-memory') return this.clearGameMemory();
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
          await this.withPreferences(() => this.loadPreferences());
          signal.throwIfAborted();
          if (command.type !== 'delete' && command.type !== 'preview-delete')
            this.invalidateDeletion();
          switch (command.type) {
            case 'set-close-on-launch':
              try {
                await this.withPreferences(async () => {
                  await this.loadPreferences();
                  const next = { ...this.state.preferences, closeOnLaunch: command.value };
                  const persisted = {
                    closeOnLaunch: command.value,
                    ...(next.maxMemoryMiB === undefined ? {} : { maxMemoryMiB: next.maxMemoryMiB }),
                    ...(next.initialMemoryMiB === undefined
                      ? {}
                      : { initialMemoryMiB: next.initialMemoryMiB }),
                  };
                  await writePreferences(this.host.base, persisted);
                  this.state.preferences = persisted;
                });
              } catch {
                throw new Error('preferences-failed');
              }
              break;
            case 'login':
            case 'refresh': {
              const auth = await this.host.auth[command.type](signal);
              this.setAccount(auth);
              this.log(command.type === 'login' ? 'session: signed-in' : 'session: ready');
              break;
            }
            case 'logout':
              this.clearSkin();
              this.state.account = null;
              await this.host.auth.logout();
              this.log('session: signed-out');
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
              await this.launch(
                signal,
                await this.withPreferences(async () => ({ ...this.state.preferences })),
              );
              break;
            case 'inspect':
              await this.checkEnvironment(signal);
              break;
            case 'recover': {
              await this.verified();
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
              this.log(
                `recovery: ${command.acceptUncertain ? 'confirmed' : 'requested'} ${report.status}`,
              );
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
            case 'remove-unregistered':
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
              else if (command.type === 'remove-unregistered') await removeUnregistered(options);
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
              this.launcherLogs = [];
              this.gameLogs = [];
              this.state.logs = [];
              this.log('data: deleted');
              this.state.outcome = 'deleted';
              break;
            }
          }
        } catch (error) {
          if (command.type === 'login' || command.type === 'refresh') {
            this.clearSkin();
            this.state.account = null;
          }
          const code = safeProductError(error, signal.aborted);
          if (code === 'no_session' || code === 'reauthentication_required') {
            this.clearSkin();
            this.state.account = null;
          }
          if (!(restoring && code === 'no_session')) this.log(`${command.type}: failed ${code}`);
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
  /**
   * Inspects the server environment and, only when the core proves it stale (verified dead owner
   * and child, or interrupted install/sync with a free or stale-verified lock), recovers it
   * without asking. `uncertain` locks and invalid journals are reported, never cleared here.
   */
  private async checkEnvironment(signal: AbortSignal) {
    try {
      await this.verified();
    } catch (error) {
      if ((error as { code?: string }).code === 'root-not-found') {
        this.state.recovery = null;
        return;
      }
      throw error;
    }
    const root = this.root();
    let environment = await inspectServerEnvironment(root);
    const lock = environment.serverLock.state;
    const invalid =
      environment.install.state === 'invalid' ||
      environment.synchronization === 'invalid' ||
      environment.userMods === 'invalid';
    let issues: string[] = [];
    if (environment.needsRecovery && (lock === 'free' || lock === 'stale-verified') && !invalid) {
      signal.throwIfAborted();
      const report = await recoverServerEnvironment(root, {
        serverId: this.config().serverId,
        acceptUncertain: false,
        signal,
      });
      signal.throwIfAborted();
      environment = report.environment;
      issues = report.issues.map((issue) => issue.code);
      this.log(
        `recovery: automatic ${report.status}${issues.length ? ` ${issues.join(',')}` : ''}`,
      );
    } else if (environment.needsRecovery) {
      if (lock === 'uncertain') issues.push('lock-uncertain');
      if (environment.install.state === 'invalid') issues.push('install-invalid');
      if (environment.synchronization === 'invalid') issues.push('synchronization-invalid');
      if (environment.userMods === 'invalid') issues.push('user-mods-invalid');
      this.log(`recovery: confirmation-required ${issues.join(',')}`);
    }
    this.state.recovery =
      environment.needsRecovery || environment.serverLock.state !== 'free'
        ? {
            needed: environment.needsRecovery,
            lock: environment.serverLock.state,
            confirmable: environment.serverLock.confirmable,
            issues,
          }
        : null;
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
    this.gameLogs = this.game
      .getLogs()
      .entries.map((entry) => ({
        source: 'game' as const,
        text: entry.text.replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\p{Cc}\p{Cf}]/gu, ''),
      }))
      .slice(-300);
    this.state.logs = [...this.launcherLogs, ...this.gameLogs];
    this.publish();
  }
  private async launch(signal: AbortSignal, preferences: ProductState['preferences']) {
    if (!this.state.supported) throw new Error('unsupported-platform');
    const config = this.config();
    // Player value, else the server default, else the built-in default; Xms never exceeds Xmx.
    const memory = resolveGameMemory(preferences, config.memory);
    const memoryLimit = Math.min(65536, this.state.physicalMemoryMiB);
    if (memoryLimit < 512 || memory.maxMemoryMiB > memoryLimit)
      throw new Error(
        preferences.maxMemoryMiB === undefined && config.memory
          ? 'memory-limit-server'
          : 'memory-limit',
      );
    this.log('launch: started');
    // Per-attempt check: verified-stale state is recovered silently; held-live falls through to
    // ensure() ('locked'); uncertain or invalid state blocks until the user confirms.
    await this.checkEnvironment(signal);
    if (this.state.recovery?.needed) throw new Error('recovery-required');
    await this.ensure();
    const root = this.root();
    const download = createFullDownloader();
    const current = async (requestedSignal?: AbortSignal) => {
      const reader = await openServerDeployment(this.host.base, config, requestedSignal);
      try {
        void Promise.resolve(this.host.observeDeployment?.(reader)).catch(() => {});
      } catch {
        /* Optional branding cannot fail game preparation. */
      }
      return reader;
    };
    const game = await launchDeployment({
      root,
      expectedServerId: config.serverId,
      server: config.address,
      launcherVersion: this.host.version,
      signal,
      maxMemoryMiB: memory.maxMemoryMiB,
      ...(memory.initialMemoryMiB === undefined
        ? {}
        : { initialMemoryMiB: memory.initialMemoryMiB }),
      process: preferences.closeOnLaunch ? { detachable: true } : {},
      current,
      onPhase: (phase) => {
        this.log(`launch: ${phase}`);
        this.phase(phase);
      },
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
          this.clearSkin();
          this.state.account = null;
          throw error;
        });
        this.setAccount(auth);
        return auth;
      },
      afterSynchronization: async (applied) => {
        // The files of this deployment are now applied: only here may the rollback floor rise.
        await recordAppliedDeployment(this.host.base, config, applied);
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
    this.log('game: started');
    this.state.running = true;
    this.state.runningSince = Date.now();
    this.phase('game-running');
    if (preferences.closeOnLaunch) {
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
      this.log(`game: ${this.state.outcome}`);
    } finally {
      clearInterval(interval);
      this.game = undefined;
      this.state.running = false;
      delete this.state.runningSince;
    }
  }
  async close() {
    this.closing = true;
    this.clearSkin();
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
    } finally {
      await this.preferencesQueue;
    }
  }
}
