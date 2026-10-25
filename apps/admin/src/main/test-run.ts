import { rmdir, unlink } from 'node:fs/promises';
import { release } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { diagnostics, testInstance } from '@torchlauncher/core';
import { AuthenticationError, type MinecraftAuthResult } from '@torchlauncher/core/auth';
import { HostAuthenticationError } from '@torchlauncher/desktop-auth';
import { createFullDownloader } from '../../../../packages/core/src/download/full/index.js';
import { applySettingsPolicy } from '../../../../packages/core/src/instance/settings/index.js';
import { maybeStat } from '../../../../packages/core/src/instance/sync/safety.js';
import { installLoader } from '../../../../packages/core/src/loaders/installer.js';
import { secureDirectory } from '../../../../packages/core/src/minecraft/filesystem.js';
import {
  type Installation,
  type InstallOptions,
  installMinecraft,
} from '../../../../packages/core/src/minecraft/installer.js';
import { acquireServerDataLock } from '../../../../packages/core/src/minecraft/lock.js';
import { GameLogs } from '../../../../packages/core/src/minecraft/logs.js';
import {
  launchMinecraft,
  type RunningGame,
} from '../../../../packages/core/src/minecraft/process.js';
import type { StudioAccount, StudioProject, StudioTestRun } from '../shared/studio.js';
import { buildPlan } from './files-diff.js';
import { noLinks, safeRead, saveProject } from './filesystem.js';
import {
  isShaderConfigPath,
  type PresetImport,
  readPreset,
  readPresetConfigs,
  SETTINGS_POLICY_PATH,
} from './game-settings.js';
import { StudioFailure, TestSettingsFailure } from './project.js';
import { hashFile, scanSource } from './scan.js';
import { applyTestInstance, recoverTestInstance, removeTestInstance } from './test-instance.js';

export const TEST_LOG_LIMIT = 300;
export interface TestRunHost {
  userData: string;
  auth: {
    login(signal?: AbortSignal): Promise<MinecraftAuthResult>;
    refresh(signal?: AbortSignal): Promise<MinecraftAuthResult>;
    logout(): Promise<void>;
  };
  available(): boolean;
  launcherVersion: string;
  install?(options: InstallOptions, game: StudioProject['game']): Promise<Installation>;
  launch?: typeof launchMinecraft;
}
/** Account-free installation path, also used for the manual Linux loader probe. */
export async function installStudioTestGame(
  options: InstallOptions,
  game: StudioProject['game'],
  onLoader: () => void = () => {},
) {
  const base = await installMinecraft(options);
  options.signal?.throwIfAborted();
  onLoader();
  return installLoader(base, {
    selection: game.loader,
    download: options.download,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
export const emptyTestRun = (): StudioTestRun => ({
  phase: 'idle',
  serverId: null,
  exit: null,
  progress: null,
  logs: [],
  truncated: false,
  report: null,
  mods: [],
  metadataErrors: [],
  extracted: null,
  configFiles: null,
  configPreview: null,
  configError: null,
  extractionError: null,
  error: null,
});
function safeCode(error: unknown): string {
  if (error instanceof AuthenticationError || error instanceof HostAuthenticationError)
    return error.code;
  if (error instanceof TestSettingsFailure) return error.detailCode;
  if (error instanceof StudioFailure) return error.code;
  if (error instanceof testInstance.TestInstanceError) return error.code;
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  return 'test-failed';
}
function below(parent: string, child: string) {
  const path = relative(parent, child);
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
export class StudioTestRunner {
  private accountBase: StudioAccount;
  private loginCode: string | null = null;
  /** The account with the device code only while a login is waiting for the user. */
  get account(): StudioAccount {
    return { ...this.accountBase, login: this.loginCode ? { code: this.loginCode } : null };
  }
  set account(value: StudioAccount) {
    this.accountBase = { ...value, login: null };
  }
  /** Mirrors the host's pending device code into the state (null when none waits). */
  setLoginCode(code: string | null) {
    this.loginCode = code;
  }
  /** Publishes the device code to the state; the returned function clears it (idempotent). */
  publishLoginCode(code: string): () => void {
    this.loginCode = code;
    return () => {
      if (this.loginCode === code) this.loginCode = null;
    };
  }
  state = emptyTestRun();
  private running: RunningGame | null = null;
  clearResult() {
    this.state = emptyTestRun();
  }
  private secrets: string[] = [];
  constructor(private readonly host: TestRunHost) {
    this.accountBase = {
      signedIn: false,
      name: null,
      available: this.available(),
      error: null,
      login: null,
    };
  }
  private available() {
    try {
      return this.host.available();
    } catch {
      return false;
    }
  }
  private accountResult(auth: MinecraftAuthResult) {
    this.account = {
      signedIn: true,
      name: auth.profile.name,
      available: this.available(),
      error: null,
      login: null,
    };
    this.secrets = [
      auth.accessToken,
      auth.profile.id,
      auth.profile.name,
      auth.xuid ?? '',
      auth.clientId,
    ].filter(Boolean);
  }
  async login(signal: AbortSignal) {
    this.accountBase.available = this.available();
    try {
      this.accountResult(await this.host.auth.login(signal));
      signal.throwIfAborted();
    } catch (error) {
      this.account = {
        signedIn: false,
        name: null,
        available: this.available(),
        error: safeCode(error),
        login: null,
      };
      throw error instanceof HostAuthenticationError && error.code === 'secure_storage_unavailable'
        ? new StudioFailure('ENCRYPTION_UNAVAILABLE')
        : new StudioFailure(signal.aborted ? 'CANCELLED' : 'IO');
    } finally {
      // The code is only valid while a login waits; whatever ended it, nothing stays published.
      this.loginCode = null;
    }
  }
  async logout() {
    await this.stop();
    try {
      await this.host.auth.logout();
    } finally {
      this.loginCode = null;
      this.account = {
        signedIn: false,
        name: null,
        available: this.available(),
        error: null,
        login: null,
      };
      this.secrets = [];
    }
  }
  stop() {
    return this.running?.stop() ?? Promise.resolve();
  }
  private root(project: StudioProject) {
    if (
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(project.serverId) ||
      !isAbsolute(this.host.userData)
    )
      throw new StudioFailure('INVALID');
    return join(this.host.userData, 'test-instances', project.serverId);
  }
  private phase(phase: StudioTestRun['phase']) {
    this.state.phase = phase;
    this.state.progress = null;
  }
  private text(raw: string): string {
    // Known values are removed before snapshots/evidence. No raw provider exception is retained.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: child output controls are untrusted.
    let value = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    const cleaner = new GameLogs([], { maxEntries: 1, maxBytes: 65536, maxLineBytes: 8192 });
    cleaner.write('stdout', Buffer.from(`${value}\n`));
    cleaner.finish('stdout');
    value = (cleaner.snapshot().entries[0]?.text ?? '')
      .replace(/(--(?:accessToken|refreshToken|username|uuid|xuid)(?:=|\s+))\S+/gi, '$1[REDACTED]')
      .replace(/(Setting user:\s*)\S+/gi, '$1[REDACTED]');
    for (const secret of this.secrets) value = value.split(secret).join('[REDACTED]');
    return value.replace(/(\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^/\\\s]+/g, '$1[REDACTED]');
  }
  private logs(snapshot: ReturnType<RunningGame['getLogs']>) {
    const logs = new GameLogs(this.secrets, {
      maxEntries: TEST_LOG_LIMIT,
      maxBytes: 256 * 1024,
      maxLineBytes: 8192,
    });
    for (const line of snapshot.entries)
      logs.write(line.stream, Buffer.from(`${this.text(line.text)}\n`));
    logs.finish('stdout');
    logs.finish('stderr');
    const safe = logs.snapshot();
    this.state.logs = safe.entries;
    this.state.truncated =
      snapshot.droppedEntries > 0 ||
      snapshot.discardedLines > 0 ||
      safe.droppedEntries > 0 ||
      safe.discardedLines > 0;
  }
  async start(project: StudioProject, sourceRoot: string, signal: AbortSignal) {
    const root = this.root(project);
    if (below(resolve(sourceRoot), root) || below(root, resolve(sourceRoot)))
      throw new StudioFailure('INVALID');
    this.state = { ...emptyTestRun(), serverId: project.serverId, phase: 'preparing' };
    let timer: ReturnType<typeof setInterval> | undefined;
    let outer: Awaited<ReturnType<typeof acquireServerDataLock>> | undefined;
    try {
      signal.throwIfAborted();
      let auth: MinecraftAuthResult;
      try {
        auth = await this.host.auth.refresh(signal);
        this.accountResult(auth);
      } catch (error) {
        this.account = {
          signedIn: false,
          name: null,
          available: this.available(),
          error: safeCode(error),
          login: null,
        };
        throw error;
      }
      const plan = buildPlan(project);
      if (plan.policyError) throw plan.policyError;
      await secureDirectory(join(this.host.userData, 'test-instance-locks', project.serverId));
      outer = await acquireServerDataLock(
        join(this.host.userData, 'test-instance-locks', project.serverId),
        'maintenance',
      );
      await secureDirectory(root);
      const recoveryLease = await acquireServerDataLock(root, 'maintenance');
      try {
        await recoverTestInstance(root);
      } finally {
        await recoveryLease.release();
      }
      // Installers and launchMinecraft take their own core instance leases; the outer lease spans all phases.
      this.phase('installing');
      const options: InstallOptions = {
        root,
        version: project.game.minecraftVersion,
        platform: {
          os: process.platform === 'win32' ? 'windows' : 'linux',
          arch: 'x64',
          version: release(),
        },
        signal,
        download: createFullDownloader(),
        onActivity: (event) => {
          this.state.progress = {
            component: event.component,
            completed: event.completed,
            total: event.total,
          };
        },
      };
      if (!['linux', 'win32'].includes(process.platform) || process.arch !== 'x64')
        throw new StudioFailure('INVALID');
      const installed = this.host.install
        ? await this.host.install(options, project.game)
        : await installStudioTestGame(options, project.game, () => {
            this.state.progress = { component: 'loader', completed: 0, total: null };
          });
      signal.throwIfAborted();
      this.phase('syncing');
      const lease = await acquireServerDataLock(root, 'maintenance');
      let expected: testInstance.TestOwnedFile[] = [];
      try {
        await recoverTestInstance(root);
        const candidateFiles = plan.items
          .filter((item) => item.kind !== 'generated')
          .map(({ path, policy }) => ({ path, policy }));
        const prepared = await testInstance.planTestInstance({
          candidateFiles,
          sourceRoot,
          instanceRoot: root,
        });
        const required = new Set(
          candidateFiles.filter((file) => file.policy === 'always').map((file) => file.path),
        );
        if (
          prepared.skipped.some(
            (file) => required.has(file.path) && ['modified', 'unowned'].includes(file.reason),
          )
        )
          throw new StudioFailure('MISMATCH');
        expected = prepared.nextLedger.files.filter((file) => file.policy === 'always');
        // Packs in the build plan have recorded digests: reject changed source bytes before applying.
        for (const item of plan.items.filter((item) => item.kind === 'pack')) {
          const found = prepared.nextLedger.files.find((file) => file.path === item.path);
          if (found && (found.sha256 !== item.sha256 || found.length !== item.length))
            throw new StudioFailure('MISMATCH');
        }
        await applyTestInstance(root, prepared, signal, (completed, total) => {
          this.state.progress = { component: 'files', completed, total };
        });
        signal.throwIfAborted();
        const policy = join(root, SETTINGS_POLICY_PATH);
        await secureDirectory(dirnameOfPolicy(root));
        if (plan.policyText !== null) await saveProject(policy, plan.policyText);
        else if (await maybeStat(policy)) {
          await noLinks(policy);
          await unlink(policy);
        }
      } finally {
        await lease.release();
      }
      this.state.progress = { component: 'settings', completed: 0, total: null };
      await applySettingsPolicy(root, { signal, minecraftVersion: project.game.minecraftVersion });
      signal.throwIfAborted();
      // Refresh again after possibly long installation, before the process receives credentials.
      try {
        auth = await this.host.auth.refresh(signal);
        this.accountResult(auth);
      } catch (error) {
        this.account = {
          signedIn: false,
          name: null,
          available: this.available(),
          error: safeCode(error),
          login: null,
        };
        throw error;
      }
      const startedAt = Date.now();
      const game = await (this.host.launch ?? launchMinecraft)(
        installed,
        {
          auth,
          launcherVersion: this.host.launcherVersion,
          // Same memory defaults a player without personal settings gets from the exported launcher.
          ...(project.memory
            ? {
                maxMemoryMiB: project.memory.maxMiB,
                ...(project.memory.initialMiB === undefined
                  ? {}
                  : { initialMemoryMiB: project.memory.initialMiB }),
              }
            : {}),
        },
        {
          signal,
          terminationGraceMs: 5000,
          logs: { maxEntries: 10000, maxBytes: 1024 * 1024, maxLineBytes: 8192 },
          preSpawn: async ({ signal }) => {
            if (await maybeStat(join(root, '.torchlauncher-test/transaction')))
              throw new StudioFailure('MISMATCH');
            for (const file of expected) {
              const value = await hashFile(join(root, file.path), 4 * 1024 ** 3, signal);
              if (value.sha256 !== file.sha256 || value.size !== file.length)
                throw new StudioFailure('MISMATCH');
            }
          },
        },
      );
      this.running = game;
      this.phase('running');
      timer = setInterval(() => this.logs(game.getLogs()), 250);
      const exit = await game.finished;
      clearInterval(timer);
      timer = undefined;
      this.logs(exit.logs);
      this.state.exit = { reason: exit.reason, code: exit.code, signal: exit.signal };
      if (['process-error', 'lock-error'].includes(exit.reason)) this.state.truncated = true;
      this.running = null;
      if (signal.aborted) throw new StudioFailure('CANCELLED');
      this.phase('analyzing');
      const analysisLease = await acquireServerDataLock(root, 'maintenance');
      try {
        const scan = await scanSource(root, signal);
        let metadataBytes = 0;
        for (const file of scan.files
          .filter((f) => /^mods\/[^/]+\.jar$/i.test(f.path))
          .slice(0, 512)) {
          signal.throwIfAborted();
          try {
            const data = await safeRead(join(root, file.path), 64 * 1024 * 1024);
            const info = await diagnostics.readModMetadata(data);
            // Metadata is also untrusted display input; redact before saving to state.
            const encoded = JSON.stringify({ ...info, file: basename(file.path) });
            metadataBytes += Buffer.byteLength(encoded);
            if (metadataBytes > 1024 * 1024) {
              this.state.metadataErrors.push({
                file: this.text(basename(file.path)),
                code: 'limit-exceeded',
              });
              continue;
            }
            this.state.mods.push(
              JSON.parse(encoded, (_key, value: unknown) =>
                typeof value === 'string' ? this.text(value) : value,
              ) as diagnostics.ModInfo,
            );
          } catch (error) {
            this.state.metadataErrors.push({
              file: this.text(basename(file.path)),
              code: error instanceof diagnostics.ModMetadataError ? error.code : 'unreadable',
            });
          }
        }
        const crash = scan.files
          .filter((f) => /^crash-reports\/[^/]+\.txt$/i.test(f.path))
          .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
        let crashReport: string | undefined;
        if (crash && crash.mtimeMs >= startedAt) {
          try {
            crashReport = (await safeRead(join(root, crash.path), 4 * 1024 * 1024)).toString();
          } catch {
            this.state.truncated = true;
          }
        }
        this.state.report = diagnostics.analyzeGameLog({
          loader: project.game.loader.kind,
          minecraftVersion: project.game.minecraftVersion,
          lines: exit.logs.entries.map((line) => this.text(line.text)),
          exit: {
            code: exit.reason === 'stopped' ? 0 : exit.code,
            signal: exit.reason === 'stopped' ? null : exit.signal,
          },
          ...(crashReport === undefined ? {} : { crashReport }),
          mods: this.state.mods,
          secretsToHide: this.secrets,
        });
        if (this.state.truncated) {
          this.state.report.truncated = true;
          if (this.state.report.status === 'no-problems-found')
            this.state.report.status = 'incomplete';
        }
        // Refresh config candidates independently of options.txt and never mutate the project.
        try {
          await this.scanConfigs(root, signal);
        } catch (error) {
          signal.throwIfAborted();
          this.state.configError = safeCode(error);
        }
        try {
          const preset = this.sanitizePreset(
            await readPreset(join(root, 'options.txt'), 'file', true),
          );
          signal.throwIfAborted();
          const keybindCount = preset.entries.filter(
            (entry) => entry.kind === 'keybind' || entry.kind === 'mod-keybind',
          ).length;
          const known = new Set(project.gameSettings?.configFiles?.map((file) => file.path) ?? []);
          this.state.extracted = {
            ...preset.preview,
            ...(this.state.configPreview ?? {}),
            source: 'test',
            optionCount: preset.entries.length,
            ignored: preset.preview.ignored,
            keybindCount,
            otherOptionCount: preset.entries.length - keybindCount,
            newConfigCount:
              this.state.configPreview?.detected.modConfigs.filter(
                (name) => !isShaderConfigPath(`config/${name}`) && !known.has(`config/${name}`),
              ).length ?? 0,
          };
        } catch (error) {
          signal.throwIfAborted();
          this.state.extractionError = safeCode(error);
        }
      } finally {
        await analysisLease.release();
      }
      this.phase('done');
    } catch (error) {
      this.phase('failed');
      this.state.error = signal.aborted ? 'cancelled' : safeCode(error);
      throw new StudioFailure(
        signal.aborted
          ? 'CANCELLED'
          : error instanceof HostAuthenticationError && error.code === 'secure_storage_unavailable'
            ? 'ENCRYPTION_UNAVAILABLE'
            : error instanceof StudioFailure
              ? error.code
              : 'IO',
      );
    } finally {
      clearInterval(timer);
      if (this.running) {
        await this.running.stop();
        this.running = null;
      }
      await outer?.release();
    }
    function dirnameOfPolicy(root: string) {
      return join(root, 'torchlauncher');
    }
  }
  private sanitizePreset<T>(preset: T): T {
    return JSON.parse(JSON.stringify(preset), (_key, value: unknown) =>
      typeof value === 'string' ? this.text(value) : value,
    ) as T;
  }
  private async scanConfigs(root: string, signal: AbortSignal) {
    this.state.configFiles = null;
    this.state.configPreview = null;
    this.state.configError = null;
    const preset = this.sanitizePreset(await readPresetConfigs(root));
    signal.throwIfAborted();
    this.state.configFiles = preset.configFiles;
    this.state.configPreview = { ...preset.preview, source: 'test' };
  }
  /** Root is derived only from the current project. Both instance leases exclude other processes. */
  private async readInstance<T>(
    project: StudioProject,
    signal: AbortSignal,
    read: (root: string) => Promise<T>,
  ): Promise<T> {
    const root = this.root(project);
    if (!(await maybeStat(root))) throw new TestSettingsFailure('NO_TEST_RESULT');
    await noLinks(root);
    const outerRoot = join(this.host.userData, 'test-instance-locks', project.serverId);
    await secureDirectory(outerRoot);
    const outer = await acquireServerDataLock(outerRoot, 'maintenance');
    try {
      const lease = await acquireServerDataLock(root, 'maintenance');
      try {
        signal.throwIfAborted();
        // Refuse an interrupted apply; these commands never repair/write game data.
        if (await maybeStat(join(root, '.torchlauncher-test/transaction')))
          throw new StudioFailure('MISMATCH');
        const result = await read(root);
        signal.throwIfAborted();
        return result;
      } finally {
        await lease.release();
      }
    } finally {
      await outer.release();
    }
  }
  async readLastOptions(project: StudioProject, signal: AbortSignal): Promise<PresetImport> {
    if (this.state.serverId !== project.serverId || this.state.phase !== 'done' || !this.state.exit)
      throw new TestSettingsFailure('NO_TEST_RESULT');
    return this.readInstance(project, signal, async (root) => {
      let preset: PresetImport;
      try {
        preset = await readPreset(join(root, 'options.txt'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new TestSettingsFailure('TEST_OPTIONS_MISSING');
        throw error;
      }
      const safe = this.sanitizePreset(preset);
      safe.preview.source = 'test';
      return safe;
    });
  }
  /** Refreshes config candidates only; never imports values or edits project policy. */
  async refreshConfigs(project: StudioProject, signal: AbortSignal): Promise<void> {
    this.state.configFiles = null;
    this.state.configPreview = null;
    this.state.configError = null;
    try {
      await this.readInstance(project, signal, (root) => this.scanConfigs(root, signal));
    } catch (error) {
      this.state.configError = safeCode(error);
      throw error;
    }
  }
  async reset(project: StudioProject) {
    const root = this.root(project);
    await secureDirectory(join(this.host.userData, 'test-instance-locks', project.serverId));
    const outer = await acquireServerDataLock(
      join(this.host.userData, 'test-instance-locks', project.serverId),
      'maintenance',
    );
    try {
      if (await maybeStat(root)) {
        const lease = await acquireServerDataLock(root, 'maintenance');
        try {
          await removeTestInstance(root);
        } finally {
          await lease.release();
        }
        await rmdir(root);
      }
      this.state = emptyTestRun();
    } finally {
      await outer.release();
    }
  }
}
