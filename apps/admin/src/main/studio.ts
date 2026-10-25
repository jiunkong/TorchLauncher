import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { BRANDING_LIMITS, BRANDING_ROLES } from '../../../../packages/core/src/branding/index.js';
import { DeploymentValidationError } from '../../../../packages/core/src/deployment/contracts/index.js';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import { createEd25519Signer } from '../../../../packages/core/src/deployment/signing/index.js';
import { writeDeployment } from '../../../../packages/core/src/deployment/writer/index.js';
import { RangeNotSupportedError } from '../../../../packages/core/src/download/http/range-client.js';
import { createDownloadSource } from '../../../../packages/core/src/download/source/factory.js';
import { SETTINGS_LIMITS } from '../../../../packages/core/src/instance/settings/index.js';
import {
  parseServerConfig,
  parseServerIdentity,
} from '../../../../packages/core/src/server-config/index.js';
import { minecraftVersions } from '../shared/minecraft-versions.js';
import type {
  PackKind,
  PackSkipReason,
  StudioExport,
  StudioExportCheck,
  StudioPack,
  StudioPolicyStatus,
  StudioProject,
  StudioReply,
  StudioRequest,
  StudioSigning,
  StudioState,
  StudioUrlCheck,
  UrlCheckState,
} from '../shared/studio.js';
import { projectNameProblem, shaderConfigPaths } from '../shared/studio.js';
import {
  type BrandingSnapshots,
  type ImageDecoder,
  parseBranding,
  profileBranding,
  validateImage,
  writerBranding,
} from './branding.js';
import { sameContent } from './canonical.js';
import {
  brandingKey,
  buildPlan,
  computeDeploy,
  computeFiles,
  type DiffResult,
} from './files-diff.js';
import { exportLauncherZip, noLinks, safeRead, saveProject } from './filesystem.js';
import type { PresetImport } from './game-settings.js';
import {
  addPack,
  applyConfigChanges,
  defaultShader,
  discoverPacks,
  emptySettings,
  generatePolicy,
  isReservedPath,
  MAX_CONFIG_FILES,
  MAX_PACKS,
  mergeOptions,
  PACK_DIRECTORY,
  PACK_LIMIT,
  PackFailure,
  PolicyFailure,
  parseGameSettings,
  policyConfigPaths,
  readPreset,
  validatePackName,
  validGenericConfigPath,
  validPackOptionsName,
  writeGeneratedPolicy,
} from './game-settings.js';
import type { LauncherResolver } from './launcher-release.js';
import { getLoaderVersions } from './loader-versions.js';
import { newProject, parseProject, StudioFailure, TestSettingsFailure } from './project.js';
import { encodeProjectFile } from './project-file.js';
import {
  copyIntoDataDir,
  copyProjectFolderInto,
  createProjectFolder,
  PROJECT_DATA_DIR,
  PROJECT_FILE_NAME,
  readProjectFolder,
} from './project-folder.js';
import { hashFile, type ScanResult, scanSource } from './scan.js';
import type { SigningKeyStore } from './signing.js';
import { emptyTestRun, type StudioTestRunner } from './test-run.js';

export interface StudioDialogs {
  open(
    kind:
      | 'project'
      | 'projectparent'
      | 'files'
      | 'icon'
      | 'background'
      | 'keybackup'
      | 'optionsfile'
      | 'gamefolder'
      | 'resourcepack'
      | 'shaderpack'
      | 'mod',
    root?: string,
  ): Promise<string[] | null>;
  save(kind: 'pack' | 'keybackup' | 'zip'): Promise<string | null>;
  /** Shows a file in the OS file manager. Optional so tests can omit it. */
  reveal?(path: string): void;
  /** Writes text to the system clipboard (the sandboxed renderer cannot). Optional so tests can omit it. */
  copy?(text: string): void;
}
const RESCAN = new Set([
  'files',
  'filesPolicy',
  'filesTarget',
  'filesRemove',
  'rescan',
  'exportCheck',
  'build',
  'export',
  'settingsPackAdd',
]);
const POLICY_CHOICES = ['none', 'initial', 'required'];
const SPECIAL_FIELDS: Record<string, string[]> = {
  filesPolicy: ['paths', 'policy'],
  filesTarget: ['path', 'targetPath'],
  filesRemove: ['path'],
  settingsImport: ['source'],
  settingsImportOptions: ['source'],
  settingsTestConfigs: [],
  settingsOptions: ['changes'],
  settingsShader: [],
  settingsConfigItems: ['path', 'changes'],
  settingsConfigRemove: ['path'],
  settingsShaderOptions: ['pack', 'changes'],
  settingsShaderOptionsRemove: ['pack'],
  settingsPackAdd: ['kind'],
  settingsPackPolicy: ['kind', 'name', 'policy'],
  settingsPackMove: ['kind', 'name', 'index'],
  settingsPackRemove: ['kind', 'name'],
};
const validChanges = (changes: unknown): boolean =>
  Array.isArray(changes) &&
  changes.length > 0 &&
  changes.length <= SETTINGS_LIMITS.keysPerMap &&
  changes.every((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    return (
      Object.keys(c).every((k) => ['key', 'policy', 'value'].includes(k)) &&
      typeof c.key === 'string' &&
      POLICY_CHOICES.includes(c.policy) &&
      (c.value === undefined || typeof c.value === 'string')
    );
  });
const isChoicePair = (v: unknown, type: 'boolean' | 'string'): boolean => {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o === 'object' &&
    !Array.isArray(o) &&
    Object.keys(o).sort().join(',') === 'policy,value' &&
    POLICY_CHOICES.includes(o.policy as string) &&
    typeof o.value === type &&
    (type === 'boolean' || (o.value as string).length <= SETTINGS_LIMITS.valueLength)
  );
};
function validSpecial(value: Record<string, unknown>): boolean {
  if (value.action === 'settingsShader') {
    const optional = ['configPath', 'enabled', 'pack'];
    const keys = Object.keys(value).filter((k) => k !== 'action');
    return (
      keys.length > 0 &&
      keys.every((k) => optional.includes(k)) &&
      (value.configPath === undefined ||
        (shaderConfigPaths as readonly unknown[]).includes(value.configPath)) &&
      (value.enabled === undefined || isChoicePair(value.enabled, 'boolean')) &&
      (value.pack === undefined || isChoicePair(value.pack, 'string'))
    );
  }
  const fields = SPECIAL_FIELDS[value.action as string] ?? [];
  if (Object.keys(value).sort().join(',') !== ['action', ...fields].sort().join(',')) return false;
  const isKind = (v: unknown) => v === 'resourcepack' || v === 'shaderpack' || v === 'mod';
  switch (value.action) {
    case 'filesPolicy':
      return (
        Array.isArray(value.paths) &&
        value.paths.length > 0 &&
        value.paths.length <= 1000 &&
        value.paths.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 1024) &&
        ['always', 'initial-only'].includes(value.policy as string)
      );
    case 'filesTarget':
      return (
        typeof value.path === 'string' &&
        value.path.length > 0 &&
        value.path.length <= 1024 &&
        typeof value.targetPath === 'string' &&
        value.targetPath.length > 0 &&
        value.targetPath.length <= 1024
      );
    case 'filesRemove':
      return typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 1024;
    case 'settingsTestConfigs':
      return true;
    case 'settingsImportOptions':
      return value.source === 'test' || value.source === 'file';
    case 'settingsImport':
      return value.source === 'folder' || value.source === 'file';
    case 'settingsOptions':
      return (
        Array.isArray(value.changes) &&
        value.changes.length > 0 &&
        value.changes.length <= SETTINGS_LIMITS.keysPerMap &&
        value.changes.every((c) => {
          if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
          const keys = Object.keys(c);
          return (
            keys.every((k) => ['key', 'policy', 'value'].includes(k)) &&
            typeof c.key === 'string' &&
            POLICY_CHOICES.includes(c.policy) &&
            (c.value === undefined || typeof c.value === 'string')
          );
        })
      );
    case 'settingsConfigItems':
      return typeof value.path === 'string' && validChanges(value.changes);
    case 'settingsConfigRemove':
      return typeof value.path === 'string';
    case 'settingsShaderOptions':
      return typeof value.pack === 'string' && validChanges(value.changes);
    case 'settingsShaderOptionsRemove':
      return typeof value.pack === 'string';
    case 'settingsPackAdd':
      return isKind(value.kind);
    case 'settingsPackPolicy':
      return (
        isKind(value.kind) &&
        typeof value.name === 'string' &&
        POLICY_CHOICES.includes(value.policy as string)
      );
    case 'settingsPackMove':
      return (
        isKind(value.kind) && typeof value.name === 'string' && Number.isSafeInteger(value.index)
      );
    case 'settingsPackRemove':
      return isKind(value.kind) && typeof value.name === 'string';
  }
  return false;
}
export class StudioService {
  private state: StudioState = {
    account: { signedIn: false, name: null, available: false, error: null, login: null },
    testRun: emptyTestRun(),
    project: null,
    projectName: null,
    dirty: false,
    busy: null,
    progress: 0,
    result: null,
    signing: null,
    files: null,
    deploy: null,
    urlCheck: null,
    export: null,
    preset: null,
    policy: null,
  };
  private lastScan: ScanResult | null = null;
  private hashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  private urlKey: string | null = null;
  private lastPackPath: string | null = null;
  private lastExportPath: string | null = null;
  private projectDir: string | null = null;
  private get sourceRoot(): string | null {
    return this.projectDir ? join(this.projectDir, PROJECT_DATA_DIR) : null;
  }
  private snapshots: BrandingSnapshots = {};
  private closing = false;
  private controller: AbortController | null = null;
  private pending: Promise<StudioReply> | null = null;
  constructor(
    private readonly dialogs: StudioDialogs,
    private readonly sourceFactory = createDownloadSource,
    private readonly decode: ImageDecoder = () => {
      throw new StudioFailure('INVALID');
    },
    private readonly keys: SigningKeyStore,
    private readonly tests: StudioTestRunner | null = null,
    private readonly launcherResolver: LauncherResolver = async () => {
      throw new StudioFailure('LAUNCHER_UNCONFIGURED');
    },
  ) {}
  snapshot(): StudioState {
    return structuredClone({
      ...this.state,
      ...(this.tests ? { account: this.tests.account, testRun: this.tests.state } : {}),
    });
  }
  resume(): void {
    this.closing = false;
  }
  async close(): Promise<void> {
    this.closing = true;
    this.controller?.abort();
    await this.tests?.stop();
    await this.pending;
    await this.testControl;
  }
  private closeAsked = false;
  private closeHandlers: { confirm(): void; cancel(): void } | null = null;
  /** The window shell registers what happens on the renderer's answer to a close request. */
  private exitHandler: (() => void) | null = null;
  /** The window's close path; `exit` goes through the normal close request and unsaved flow. */
  onExit(handler: () => void): void {
    this.exitHandler = handler;
  }
  onCloseAnswer(handlers: { confirm(): void; cancel(): void }): void {
    this.closeHandlers = handlers;
  }
  /** True when the window may close at once; false when the renderer must be asked first. */
  beginClose(): boolean {
    if (!this.state.dirty) return true;
    this.closeAsked = true;
    // The renderer may save (or abandon) while it asks; commands must not be answered BUSY.
    this.closing = false;
    return false;
  }
  abandonClose(): void {
    if (!this.closeAsked) return;
    this.closeAsked = false;
    this.closeHandlers?.cancel();
  }
  request(input: unknown): Promise<StudioReply> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return Promise.resolve({ ok: false, code: 'INVALID' });
    const value = input as Record<string, unknown>;
    if (value.action === 'loaderVersions') {
      if (
        Object.keys(value).sort().join(',') !== 'action,kind,minecraftVersion' ||
        typeof value.minecraftVersion !== 'string' ||
        !(minecraftVersions as readonly string[]).includes(value.minecraftVersion) ||
        (value.kind !== 'fabric' && value.kind !== 'neoforge')
      )
        return Promise.resolve({ ok: false, code: 'INVALID' });
      return getLoaderVersions(value.minecraftVersion, value.kind)
        .then<StudioReply>((loaderVersions) => ({
          ok: true,
          state: this.snapshot(),
          loaderVersions,
        }))
        .catch<StudioReply>(() => ({ ok: false, code: 'IO' }));
    }
    if (typeof value.action === 'string' && value.action.startsWith('test')) {
      if (
        ![
          'testLogin',
          'testLoginCopyCode',
          'testLogout',
          'testStart',
          'testStop',
          'testReset',
        ].includes(value.action) ||
        Object.keys(value).sort().join(',') !==
          (value.action === 'testReset' ? 'action,confirmed' : 'action') ||
        (value.action === 'testReset' && value.confirmed !== true)
      )
        return Promise.resolve({ ok: false, code: 'INVALID' });
      if (!this.tests) return Promise.resolve({ ok: false, code: 'IO' });
      if (value.action === 'testLoginCopyCode') {
        // Allowed while the login command itself is pending; the code never leaves main otherwise.
        const code = this.tests.account.login?.code;
        if (!code || !this.dialogs.copy) return Promise.resolve({ ok: false, code: 'INVALID' });
        this.dialogs.copy(code);
        return Promise.resolve({ ok: true, state: this.snapshot() });
      }
      if (this.closing || this.closeAsked || this.testControl)
        return Promise.resolve({ ok: false, code: 'BUSY' });
      if (value.action === 'testStop' || value.action === 'testLogout') {
        if (this.state.busy && !this.testActive)
          return Promise.resolve({ ok: false, code: 'BUSY' });
        const pending = this.pending;
        if (this.testActive && this.tests.state.phase !== 'running') this.controller?.abort();
        this.testControl = (async (): Promise<StudioReply> => {
          try {
            await this.tests?.stop();
            await pending;
            if (value.action === 'testLogout') await this.tests?.logout();
            return { ok: true, state: this.snapshot() };
          } catch {
            return { ok: false, code: 'IO' };
          } finally {
            this.testControl = null;
          }
        })();
        return this.testControl;
      }
    }

    const actions = [
      'state',
      'testLogin',
      'testStart',
      'testStop',
      'testLogout',
      'touch',
      'open',
      'save',
      'files',
      'build',
      'check',
      'export',
      'cancel',
      'rescan',
      'exportCheck',
      'revealPack',
      'revealExport',
      'revealProject',
      'closeConfirm',
      'closeCancel',
      'exit',
      'closeProject',
    ];
    const extra =
      value.action === 'testReset'
        ? 'confirmed'
        : value.action === 'update'
          ? 'project'
          : value.action === 'brandingName'
            ? 'appName'
            : ['brandingSelect', 'brandingRemove'].includes(String(value.action))
              ? 'role'
              : value.action === 'new' || value.action === 'saveAs'
                ? 'name'
                : null;
    const keyActions: Record<string, string[]> = {
      keyStatus: [],
      keyCreate: [],
      keyExport: ['passphrase'],
      keyImport: ['passphrase', 'replace'],
    };
    const keyFields = typeof value.action === 'string' ? keyActions[value.action] : undefined;
    if (value.action === 'export') {
      if (
        Object.keys(value).some(
          (key) => !['action', 'target', 'allowCached', 'cachedVersion'].includes(key),
        ) ||
        (value.target !== undefined && value.target !== 'windows' && value.target !== 'linux') ||
        (value.allowCached !== undefined && typeof value.allowCached !== 'boolean') ||
        (value.cachedVersion !== undefined &&
          (typeof value.cachedVersion !== 'string' || value.cachedVersion.length > 100))
      )
        return Promise.resolve({ ok: false, code: 'INVALID' });
    } else if (typeof value.action === 'string' && SPECIAL_FIELDS[value.action]) {
      if (!validSpecial(value)) return Promise.resolve({ ok: false, code: 'INVALID' });
    } else if (keyFields) {
      if (
        Object.keys(value).length !== keyFields.length + 1 ||
        keyFields.some((k) => !Object.hasOwn(value, k)) ||
        (keyFields.includes('passphrase') && typeof value.passphrase !== 'string') ||
        (keyFields.includes('replace') && typeof value.replace !== 'boolean')
      )
        return Promise.resolve({ ok: false, code: 'INVALID' });
    } else if (
      typeof value.action !== 'string' ||
      (!actions.includes(value.action) &&
        ![
          'update',
          'brandingSelect',
          'brandingRemove',
          'brandingName',
          'testReset',
          'new',
          'saveAs',
        ].includes(value.action)) ||
      Object.keys(value).length !==
        (extra ? 2 : 1) +
          (['new', 'open', 'closeProject'].includes(value.action) && 'discard' in value ? 1 : 0) ||
      ('discard' in value && typeof value.discard !== 'boolean') ||
      (extra && !Object.hasOwn(value, extra)) ||
      (extra === 'role' && value.role !== 'icon' && value.role !== 'background') ||
      (extra === 'name' && typeof value.name !== 'string') ||
      (extra === 'appName' && value.appName !== null && typeof value.appName !== 'string')
    )
      return Promise.resolve({ ok: false, code: 'INVALID' });
    if (value.action === 'state') return Promise.resolve({ ok: true, state: this.snapshot() });
    if (value.action === 'exit') {
      this.exitHandler?.();
      return Promise.resolve({ ok: true, state: this.snapshot() });
    }
    if (value.action === 'closeConfirm' || value.action === 'closeCancel') {
      // Valid only as the answer to a close request main itself sent to the trusted renderer.
      if (!this.closeAsked) return Promise.resolve({ ok: false, code: 'INVALID' });
      this.closeAsked = false;
      if (value.action === 'closeConfirm') this.closeHandlers?.confirm();
      else this.closeHandlers?.cancel();
      return Promise.resolve({ ok: true, state: this.snapshot() });
    }
    if (value.action === 'cancel') {
      this.controller?.abort();
      return Promise.resolve({ ok: true, state: this.snapshot() });
    }
    if (this.closing || this.state.busy || this.testControl)
      return Promise.resolve({ ok: false, code: 'BUSY' });
    const command = value as unknown as StudioRequest;
    this.testActive = ['testLogin', 'testStart', 'testReset'].includes(command.action);
    this.controller = new AbortController();
    this.state.busy =
      (
        {
          save: 'saving',
          saveAs: 'saving',
          open: 'opening',
          build: 'building',
          check: 'checking',
          export: 'exporting',
          exportCheck: 'checking',
          rescan: 'checking',
          keyStatus: 'checking',
        } as const
      )[command.action as 'save'] ?? (command.action.startsWith('key') ? 'saving' : 'choosing');
    this.state.progress = 0;
    this.state.result = null;
    this.pending = this.perform(command, this.controller.signal)
      .then((): StudioReply => {
        this.state.busy = null;
        return { ok: true, state: this.snapshot() };
      })
      .catch((error: unknown): StudioReply => {
        const cancelled = this.controller?.signal.aborted;
        this.state.busy = null;
        return {
          ok: false,
          code: cancelled ? 'CANCELLED' : error instanceof StudioFailure ? error.code : 'IO',
          ...(!cancelled && error instanceof TestSettingsFailure
            ? { detail: { code: error.detailCode } }
            : {}),
        };
      })
      .finally(() => {
        this.testActive = false;
        this.controller = null;
        this.pending = null;
      });
    return this.pending;
  }
  private testActive = false;
  private testControl: Promise<StudioReply> | null = null;
  private project(): StudioProject {
    if (!this.state.project) throw new StudioFailure('NO_PROJECT');
    return this.state.project;
  }
  private async selected(
    kind: Parameters<StudioDialogs['open']>[0],
    root?: string,
  ): Promise<string[]> {
    const paths = await this.dialogs.open(kind, root);
    this.controller?.signal.throwIfAborted();
    if (!paths?.length) throw new StudioFailure('CANCELLED');
    return paths;
  }
  private async perform(command: StudioRequest, signal: AbortSignal): Promise<void> {
    await this.execute(command, signal);
    if (!this.state.project) return;
    const rescan = RESCAN.has(command.action);
    try {
      await this.derive(signal, rescan);
    } catch (error) {
      if (command.action === 'rescan' || signal.aborted) throw error;
      // Derived data is advisory: a failed listing must not turn a finished command into an error.
      this.state.files = null;
      this.state.deploy = computeDeploy(this.state.project, null, null);
      this.state.export = this.exportState(this.state.project);
    }
  }
  /** Recomputes file listing, deploy status and export checks. Never changes the project. */
  private async derive(signal: AbortSignal, rescan: boolean): Promise<void> {
    const project = this.state.project;
    if (!project) return;
    let diff: DiffResult | null = null;
    const root = this.sourceRoot;
    if (root) {
      if (rescan || !this.lastScan) this.lastScan = await scanSource(root, signal);
      const scan = this.lastScan;
      const mtimes = new Map(scan.files.map((f) => [f.path, f.mtimeMs]));
      diff = await computeFiles(project, scan, async (path, size) => {
        const mtimeMs = mtimes.get(path) ?? -1;
        const cached = this.hashes.get(path);
        if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.sha256;
        try {
          const { sha256 } = await hashFile(join(root, path), 4 * 1024 ** 3, signal);
          this.hashes.set(path, { size, mtimeMs, sha256 });
          return sha256;
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof StudioFailure && error.code === 'CANCELLED') throw error;
          return null;
        }
      });
    } else this.lastScan = null;
    this.state.files = diff?.files ?? null;
    this.state.deploy = computeDeploy(project, diff, diff?.files ?? null);
    if (this.state.urlCheck) this.state.urlCheck.stale = this.urlKey !== this.fingerprint(project);
    this.state.export = this.exportState(project);
    this.state.policy = this.policyStatus(project);
  }
  private fingerprint(project: StudioProject): string {
    return JSON.stringify([
      project.serverId,
      project.sourceUrl,
      project.game,
      brandingKey(project),
      project.lastBuild?.deploymentId ?? null,
    ]);
  }
  private exportState(project: StudioProject): StudioExport {
    const check = this.state.urlCheck;
    const fresh = check && !check.stale ? check : null;
    const unchecked = (): StudioExportCheck['reasons'] => ['url-unchecked'];
    const item = (state: UrlCheckState | undefined, bad: 'server-id' | 'game') => {
      if (!fresh || state === undefined) return unchecked();
      if (state === 'ok') return [];
      return state === 'mismatch' ? [bad] : (['url-failed'] as const);
    };
    const urlReasons: StudioExportCheck['reasons'] = !fresh
      ? unchecked()
      : fresh.range === 'failed'
        ? ['range']
        : fresh.fileList.state !== 'ok'
          ? ['url-failed']
          : [];
    const deployment: StudioExportCheck['reasons'] = !project.lastBuild
      ? ['no-deployment']
      : this.state.deploy?.status === 'changed'
        ? ['deployment-changed']
        : fresh?.deployment === 'older'
          ? ['deployment-outdated']
          : [];
    const checks: StudioExportCheck[] = [
      { id: 'serverId', reasons: [...item(fresh?.serverId, 'server-id')] },
      { id: 'game', reasons: [...item(fresh?.game, 'game')] },
      { id: 'url', reasons: urlReasons },
      { id: 'deployment', reasons: deployment },
    ].map((c) => ({ ...c, ok: c.reasons.length === 0 })) as StudioExportCheck[];
    return {
      checks,
      blocked: checks.some((c) => !c.ok),
      done: this.exportDone,
    };
  }
  private exportDone: StudioExport['done'] = null;
  private updatePack(kind: PackKind, mutate: (list: StudioPack[]) => void, create = false): void {
    this.updateSettings((g) => {
      if (kind === 'resourcepack') mutate(g.resourcePacks);
      else if (kind === 'shaderpack') mutate(g.shaderPacks);
      else {
        g.mods ??= [];
        mutate(g.mods);
      }
    }, create);
  }
  private updateSettings(
    mutate: (settings: import('../shared/studio.js').StudioGameSettings) => void,
    create = false,
  ): void {
    const project = this.project();
    if (!project.gameSettings && !create) throw new StudioFailure('INVALID');
    const next = structuredClone(project.gameSettings ?? emptySettings());
    mutate(next);
    const settings = parseGameSettings(next);
    try {
      // Refuse a change the policy cannot express (limits, bad values) instead of saving it.
      generatePolicy(settings, project.game.minecraftVersion);
    } catch (error) {
      if (error instanceof PolicyFailure)
        this.policyRejected = { code: error.settingsCode, message: error.detail };
      this.state.policy = this.policyStatus(project);
      throw error;
    }
    this.policyRejected = null;
    this.state.project = { ...project, gameSettings: settings };
    this.state.dirty = true;
  }
  private policyRejected: { code: string; message: string } | null = null;
  private policyStatus(project: StudioProject): StudioPolicyStatus | null {
    if (!project.gameSettings) return null;
    const plan = buildPlan(project);
    return {
      generated: plan.policy !== null,
      configFiles: plan.policy?.configFiles ?? 0,
      bytes: plan.policy?.bytes ?? 0,
      limit: SETTINGS_LIMITS.policyBytes,
      error: plan.policyError
        ? { code: plan.policyError.settingsCode, message: plan.policyError.detail }
        : this.policyRejected,
    };
  }
  private importPreset(preset: PresetImport): void {
    const { entries, preview, configFiles, shader } = preset;
    this.updateSettings((g) => {
      g.options = mergeOptions(g.options, entries);
      if (configFiles.length) {
        const files = g.configFiles ?? [];
        for (const file of configFiles) {
          const old = files.find((f) => f.path === file.path);
          if (old) old.items = mergeOptions(old.items, file.items);
          else files.push(file);
        }
        g.configFiles = files;
      }
      if (shader) {
        const current = g.shader ?? defaultShader();
        if (g.shader === undefined || shader.enabled !== null) {
          if (current.enabled.policy === 'none' && shader.enabled !== null)
            current.enabled.value = shader.enabled;
        }
        if (current.pack.policy === 'none' && shader.pack !== null)
          current.pack.value = shader.pack;
        current.configPath = shader.configPath;
        for (const file of shader.packOptions) {
          const old = current.packOptions.find((f) => f.pack === file.pack);
          if (old) old.items = mergeOptions(old.items, file.items);
          else current.packOptions.push(file);
        }
        g.shader = current;
      }
    }, true);
    this.state.preset = preview;
  }
  /**
   * Writes the current project exactly like the `save` command (same atomic path, no dialog).
   * Shared by `save` and the automatic save after file adds.
   */
  private async writeProject(project: StudioProject): Promise<void> {
    if (!this.projectDir) throw new StudioFailure('NO_PROJECT');
    await saveProject(
      join(this.projectDir, PROJECT_FILE_NAME),
      encodeProjectFile(project, this.snapshots),
    );
    this.state.dirty = false;
  }
  /**
   * Automatic save after a command copied or listed files in the project folder, so the list
   * cannot be lost while the files stay. It saves the whole project, including other pending
   * edits. A failed save is not an error of the command: the in-memory change stays, `dirty`
   * stays true and the command's result is flagged so the UI reports the failure beside the
   * success. Returns whether the project is now saved. The write is atomic and is never started
   * once the command was aborted, so a cancel cannot leave a half-saved state.
   */
  private async autoSave(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    try {
      await this.writeProject(this.project());
      return true;
    } catch {
      this.state.dirty = true;
      return false;
    }
  }
  /**
   * Adds valid files found in files/mods, files/resourcepacks and files/shaderpacks that the
   * lists do not mention yet. Mods are always applied; other packs start as first-install. Never
   * removes entries and never marks the project dirty by itself (the result is deterministic).
   */
  private async reconcilePacks(signal: AbortSignal): Promise<void> {
    const root = this.sourceRoot;
    if (!root || !this.state.project) return;
    const wasDirty = this.state.dirty;
    for (const kind of ['mod', 'resourcepack', 'shaderpack'] as const) {
      const settings = this.state.project.gameSettings;
      const current =
        (kind === 'resourcepack'
          ? settings?.resourcePacks
          : kind === 'shaderpack'
            ? settings?.shaderPacks
            : settings?.mods) ?? [];
      const found = await discoverPacks(
        root,
        kind,
        new Set(current.map((p) => p.name.toLowerCase())),
        MAX_PACKS - current.length,
        signal,
      );
      if (found.length === 0) continue;
      try {
        this.updatePack(
          kind,
          (list) => {
            for (const pack of found)
              list.push({ ...pack, policy: kind === 'mod' ? 'required' : 'initial' });
          },
          true,
        );
      } catch (error) {
        // A list the policy cannot express is left as it was; opening must not fail for it.
        signal.throwIfAborted();
        this.policyRejected = null;
        if (!(error instanceof StudioFailure || error instanceof PolicyFailure)) throw error;
      }
    }
    this.state.dirty = wasDirty;
  }
  /** Everything derived from the current project; shared by new, open and closeProject. */
  private resetProjectState(): void {
    this.state.signing = null;
    this.state.files = null;
    this.state.deploy = null;
    this.state.urlCheck = null;
    this.state.export = null;
    this.state.preset = null;
    this.state.policy = null;
    this.policyRejected = null;
    this.lastScan = null;
    this.hashes.clear();
    this.urlKey = null;
    this.exportDone = null;
    this.lastPackPath = null;
    this.lastExportPath = null;
  }
  private async execute(command: StudioRequest, signal: AbortSignal): Promise<void> {
    switch (command.action) {
      case 'testLogin':
        if (!this.tests) throw new StudioFailure('IO');
        await this.tests.login(signal);
        return;
      case 'testStart': {
        const project = structuredClone(this.project());
        if (!this.tests || !this.sourceRoot) throw new StudioFailure('INVALID');
        await this.tests.start(project, this.sourceRoot, signal);
        return;
      }
      case 'testReset':
        if (!this.tests || command.confirmed !== true) throw new StudioFailure('INVALID');
        await this.tests.reset(this.project());
        return;
      case 'testStop':
      case 'testLogout':
        return;

      case 'rescan':
        this.project();
        // A file dropped into files/mods (or a pack folder) while Studio runs joins the lists.
        await this.reconcilePacks(signal);
        return;
      case 'exportCheck':
        this.project();
        return;
      case 'revealPack':
      case 'revealExport':
      case 'revealProject': {
        this.project();
        const path =
          command.action === 'revealProject'
            ? this.projectDir
            : command.action === 'revealPack'
              ? this.lastPackPath
              : this.lastExportPath;
        if (!path || !this.dialogs.reveal) throw new StudioFailure('INVALID');
        const st = await lstat(path);
        if (command.action === 'revealProject' ? !st.isDirectory() : !st.isFile())
          throw new StudioFailure('IO');
        this.dialogs.reveal(path);
        return;
      }
      case 'filesPolicy': {
        const project = this.project();
        const root = this.sourceRoot;
        if (!root) throw new StudioFailure('INVALID');
        const scan = await scanSource(root, signal);
        const onDisk = new Set(scan.files.map((f) => f.path));
        const files = new Map(project.files.map((f) => [f.path, f]));
        const policyPaths = new Set(
          project.gameSettings ? policyConfigPaths(project.gameSettings) : [],
        );
        for (const path of new Set(command.paths)) {
          if (isReservedPath(path) || policyPaths.has(path)) throw new StudioFailure('INVALID');
          if (!files.has(path) || !onDisk.has(path)) throw new StudioFailure('INVALID');
          files.set(path, { ...files.get(path)!, policy: command.policy });
        }
        signal.throwIfAborted();
        this.lastScan = scan;
        this.state.project = parseProject({ ...project, files: [...files.values()] });
        this.state.dirty = true;
        return;
      }
      case 'filesTarget': {
        const project = this.project();
        const root = this.sourceRoot;
        if (!root) throw new StudioFailure('INVALID');
        const scan = await scanSource(root, signal);
        const policyPaths = new Set(
          project.gameSettings ? policyConfigPaths(project.gameSettings) : [],
        );
        const files = project.files.map((file) => {
          if (file.path !== command.path) return file;
          if (
            isReservedPath(file.path) ||
            policyPaths.has(file.path) ||
            policyPaths.has(command.targetPath)
          )
            throw new StudioFailure('INVALID');
          if (!scan.files.some((entry) => entry.path === file.path))
            throw new StudioFailure('INVALID');
          return { ...file, targetPath: command.targetPath };
        });
        if (!project.files.some((file) => file.path === command.path))
          throw new StudioFailure('INVALID');
        signal.throwIfAborted();
        this.state.project = parseProject({ ...project, files });
        this.lastScan = scan;
        this.state.dirty = true;
        if (!(await this.autoSave(signal))) this.state.result = { key: 'autosaveFailed' };
        return;
      }
      case 'filesRemove': {
        const project = this.project();
        const root = this.sourceRoot;
        if (!root) throw new StudioFailure('INVALID');
        const file = project.files.find((entry) => entry.path === command.path);
        const policyPaths = new Set(
          project.gameSettings ? policyConfigPaths(project.gameSettings) : [],
        );
        if (!file || isReservedPath(file.path) || policyPaths.has(file.path))
          throw new StudioFailure('INVALID');
        const target = join(root, ...file.path.split('/'));
        signal.throwIfAborted();
        try {
          await noLinks(dirname(target));
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
        }
        try {
          await noLinks(target);
          const info = await lstat(target);
          if (!info.isFile() || info.nlink !== 1) throw new StudioFailure('INVALID');
          await rm(target);
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
        }
        this.state.project = parseProject({
          ...project,
          files: project.files.filter((entry) => entry.path !== file.path),
        });
        this.lastScan = null;
        this.state.dirty = true;
        if (!(await this.autoSave(signal))) this.state.result = { key: 'autosaveFailed' };
        return;
      }
      case 'settingsTestConfigs':
        if (!this.tests) throw new TestSettingsFailure('NO_TEST_RESULT');
        await this.tests.refreshConfigs(this.project(), signal);
        return;
      case 'settingsImportOptions': {
        const project = this.project();
        if (command.source === 'test') {
          if (!this.tests) throw new TestSettingsFailure('NO_TEST_RESULT');
          const preset = await this.tests.readLastOptions(project, signal);
          signal.throwIfAborted();
          this.importPreset(preset);
        } else {
          const picked = (await this.selected('optionsfile'))[0];
          if (!picked) throw new StudioFailure('CANCELLED');
          const preset = await readPreset(picked, 'file');
          signal.throwIfAborted();
          this.importPreset(preset);
        }
        return;
      }
      case 'settingsImport': {
        this.project();
        const picked = (
          await this.selected(command.source === 'folder' ? 'gamefolder' : 'optionsfile')
        )[0];
        if (!picked) throw new StudioFailure('CANCELLED');
        const { entries, preview, configFiles, shader } = await readPreset(picked, command.source);
        signal.throwIfAborted();
        this.importPreset({ entries, preview, configFiles, shader });
        return;
      }
      case 'settingsConfigItems': {
        if (!validGenericConfigPath(command.path)) throw new StudioFailure('INVALID');
        this.updateSettings((g) => {
          const files = g.configFiles ?? [];
          let file = files.find((f) => f.path === command.path);
          if (!file) {
            if (files.length >= MAX_CONFIG_FILES) throw new StudioFailure('TOO_LARGE');
            file = { path: command.path, items: [] };
            files.push(file);
          }
          applyConfigChanges(file.items, command.changes);
          g.configFiles = files;
        }, true);
        return;
      }
      case 'settingsConfigRemove': {
        this.updateSettings((g) => {
          const files = g.configFiles ?? [];
          const index = files.findIndex((f) => f.path === command.path);
          if (index < 0) throw new StudioFailure('INVALID');
          files.splice(index, 1);
          g.configFiles = files;
        });
        return;
      }
      case 'settingsShader': {
        this.updateSettings((g) => {
          const shader = g.shader ?? defaultShader();
          if (command.configPath) shader.configPath = command.configPath;
          if (command.enabled) shader.enabled = { ...command.enabled };
          if (command.pack) shader.pack = { ...command.pack };
          g.shader = shader;
        }, true);
        return;
      }
      case 'settingsShaderOptions': {
        if (!validPackOptionsName(command.pack)) throw new StudioFailure('INVALID');
        this.updateSettings((g) => {
          const shader = g.shader ?? defaultShader();
          let file = shader.packOptions.find((f) => f.pack === command.pack);
          if (!file) {
            if (shader.packOptions.length >= MAX_CONFIG_FILES) throw new StudioFailure('TOO_LARGE');
            file = { pack: command.pack, items: [] };
            shader.packOptions.push(file);
          }
          applyConfigChanges(file.items, command.changes);
          g.shader = shader;
        }, true);
        return;
      }
      case 'settingsShaderOptionsRemove': {
        this.updateSettings((g) => {
          const options = g.shader?.packOptions;
          const index = options?.findIndex((f) => f.pack === command.pack) ?? -1;
          if (!options || index < 0) throw new StudioFailure('INVALID');
          options.splice(index, 1);
        });
        return;
      }
      case 'settingsOptions': {
        const changes = new Map(command.changes.map((c) => [c.key, c]));
        this.updateSettings((g) => {
          for (const option of g.options) {
            const change = changes.get(option.key);
            if (!change) continue;
            option.policy = change.policy;
            if (change.value !== undefined) option.value = change.value;
          }
          const known = new Set(g.options.map((o) => o.key));
          if (command.changes.some((c) => !known.has(c.key))) throw new StudioFailure('INVALID');
          for (const policy of ['required', 'initial'] as const)
            if (g.options.filter((o) => o.policy === policy).length > SETTINGS_LIMITS.keysPerMap)
              throw new StudioFailure('TOO_LARGE');
        });
        return;
      }
      case 'settingsPackAdd': {
        this.project();
        if (!this.sourceRoot) throw new StudioFailure('INVALID');
        const picks = await this.selected(command.kind);
        const settings = this.project().gameSettings;
        const current =
          (command.kind === 'resourcepack'
            ? settings?.resourcePacks
            : command.kind === 'shaderpack'
              ? settings?.shaderPacks
              : settings?.mods) ?? [];
        const known = new Set(current.map((p) => p.name.toLowerCase()));
        const seen = new Set<string>();
        const added: StudioPack[] = [];
        const skipped: { name: string; reason: PackSkipReason }[] = [];
        let fresh = 0;
        for (const [index, picked] of picks.entries()) {
          signal.throwIfAborted();
          const name = basename(picked);
          const key = name.toLowerCase();
          if (index >= MAX_PACKS) skipped.push({ name, reason: 'limit' });
          else if (seen.has(key)) skipped.push({ name, reason: 'duplicate' });
          else {
            seen.add(key);
            if (!known.has(key) && current.length + fresh >= MAX_PACKS) {
              skipped.push({ name, reason: 'limit' });
              continue;
            }
            try {
              added.push(await addPack(this.sourceRoot, command.kind, picked, signal));
              if (!known.has(key)) fresh += 1;
            } catch (error) {
              signal.throwIfAborted();
              skipped.push({
                name,
                reason:
                  error instanceof PackFailure
                    ? error.reason
                    : error instanceof StudioFailure && error.code === 'TOO_LARGE'
                      ? 'too-large'
                      : 'failed',
              });
            }
          }
        }
        signal.throwIfAborted();
        if (added.length === 0) {
          // Nothing was added: report the common cause through the ordinary error codes.
          const reasons = new Set(skipped.map((x) => x.reason));
          throw new StudioFailure(
            reasons.size === 1 && reasons.has('too-large')
              ? 'TOO_LARGE'
              : reasons.size === 1 && reasons.has('failed')
                ? 'IO'
                : 'INVALID',
          );
        }
        this.updatePack(
          command.kind,
          (list) => {
            for (const pack of added) {
              const index = list.findIndex((p) => p.name.toLowerCase() === pack.name.toLowerCase());
              const existing = list[index];
              // Mods are always applied; the other kinds keep their policy or start as first-install.
              if (existing)
                list[index] = {
                  ...pack,
                  policy: command.kind === 'mod' ? 'required' : existing.policy,
                };
              else if (list.length >= MAX_PACKS) throw new StudioFailure('TOO_LARGE');
              else list.push({ ...pack, policy: command.kind === 'mod' ? 'required' : 'initial' });
            }
          },
          true,
        );
        const saved = await this.autoSave(signal);
        this.state.result = {
          key: 'packsAdded',
          added: added.length,
          skippedCount: skipped.length,
          skipped: skipped.slice(0, 5),
          ...(saved ? {} : { saveFailed: true as const }),
        };
        return;
      }
      case 'settingsPackPolicy':
      case 'settingsPackMove':
      case 'settingsPackRemove': {
        validatePackName(command.name, command.kind);
        // A mod is always applied, so its policy is not a choice.
        if (command.action === 'settingsPackPolicy' && command.kind === 'mod')
          throw new StudioFailure('INVALID');
        this.updatePack(command.kind, (list) => {
          const index = list.findIndex((p) => p.name === command.name);
          const pack = list[index];
          if (!pack) throw new StudioFailure('INVALID');
          if (command.action === 'settingsPackPolicy') pack.policy = command.policy;
          else {
            list.splice(index, 1);
            if (command.action === 'settingsPackMove') {
              if (command.index < 0 || command.index > list.length)
                throw new StudioFailure('INVALID');
              list.splice(command.index, 0, pack);
            }
          }
        });
        if (command.action === 'settingsPackRemove') {
          // The file must go too: files in the project folder are always read back (reconcile
          // on open/rescan), so a removed entry whose file stayed would reappear.
          const root = this.sourceRoot;
          if (root) {
            try {
              const target = join(root, PACK_DIRECTORY[command.kind], command.name);
              await noLinks(dirname(target));
              const info = await lstat(target);
              if (info.isFile()) await rm(target, { force: true });
            } catch {
              // Already gone or not removable: the list entry is removed either way.
            }
          }
          if (!(await this.autoSave(signal))) this.state.result = { key: 'autosaveFailed' };
        }
        return;
      }

      case 'touch':
        this.project();
        this.state.dirty = true;
        return;
      case 'new': {
        if (this.state.dirty && !command.discard) throw new StudioFailure('UNSAVED');
        const name = command.name.trim();
        if (projectNameProblem(name) !== null) throw new StudioFailure('FOLDER_NAME_INVALID');
        signal.throwIfAborted();
        const parent = (await this.selected('projectparent'))[0] ?? null;
        if (!parent) throw new StudioFailure('CANCELLED');
        const project = newProject(name);
        const dir = await createProjectFolder(parent, name, async (created) => {
          signal.throwIfAborted();
          await saveProject(join(created, PROJECT_FILE_NAME), encodeProjectFile(project, {}));
        });
        this.state.project = project;
        this.tests?.clearResult();
        this.snapshots = {};
        this.projectDir = dir;
        this.state.projectName = basename(dir);
        this.state.dirty = false;
        this.resetProjectState();
        await this.refreshSigning();
        return;
      }
      case 'open': {
        if (this.state.dirty && !command.discard) throw new StudioFailure('UNSAVED');
        signal.throwIfAborted();
        const dir = (await this.selected('project'))[0] ?? null;
        if (!dir) throw new StudioFailure('CANCELLED');
        const loaded = await readProjectFolder(dir, this.decode);
        signal.throwIfAborted();
        this.state.project = loaded.project;
        this.tests?.clearResult();
        this.snapshots = loaded.snapshots;
        this.projectDir = dir;
        this.state.projectName = basename(dir);
        this.state.dirty = false;
        this.resetProjectState();
        await this.reconcilePacks(signal);
        await this.refreshSigning();
        return;
      }
      case 'closeProject': {
        if (!this.state.project) return;
        if (this.state.dirty && !command.discard) throw new StudioFailure('UNSAVED');
        signal.throwIfAborted();
        this.state.project = null;
        this.tests?.clearResult();
        this.snapshots = {};
        this.projectDir = null;
        this.state.projectName = null;
        this.state.dirty = false;
        this.resetProjectState();
        await this.refreshSigning();
        return;
      }
      case 'brandingSelect': {
        const project = this.project();
        const path = (await this.selected(command.role))[0];
        if (!path) throw new StudioFailure('CANCELLED');
        const bytes = await safeRead(path, BRANDING_LIMITS[command.role].length);
        const metadata = validateImage(command.role, bytes, this.decode);
        signal.throwIfAborted();
        this.snapshots[command.role] = bytes;
        this.state.project = {
          ...project,
          branding: { ...project.branding, [command.role]: metadata },
        };
        this.state.dirty = true;
        return;
      }
      case 'brandingRemove': {
        const project = this.project();
        delete this.snapshots[command.role];
        this.state.project = {
          ...project,
          branding: { ...project.branding, [command.role]: null },
        };
        this.state.dirty = true;
        return;
      }
      case 'brandingName': {
        const project = this.project();
        const branding = { ...project.branding };
        if (command.appName === null || command.appName === '') delete branding.appName;
        else branding.appName = command.appName;
        parseBranding(branding);
        this.state.project = { ...project, branding };
        this.state.dirty = true;
        return;
      }
      case 'update': {
        const project = parseProject(command.project);
        const current = this.project();
        const paths = new Set(current.files.map((f) => f.path));
        if (
          !sameContent(project.branding, current.branding) ||
          project.serverId !== current.serverId ||
          project.sequence !== current.sequence ||
          !sameContent(project.lastBuild, current.lastBuild) ||
          !sameContent(project.gameSettings, current.gameSettings) ||
          project.version !== current.version ||
          project.files.some((f) => !paths.has(f.path))
        )
          throw new StudioFailure('INVALID');
        if (!sameContent(project, current)) {
          this.state.project = project;
          this.state.dirty = true;
        }
        return;
      }
      case 'save': {
        const project = this.project();
        if (!this.projectDir) throw new StudioFailure('NO_PROJECT');
        signal.throwIfAborted();
        await this.writeProject(project);
        this.state.result = { key: 'projectSaved' };
        return;
      }
      case 'saveAs': {
        const project = this.project();
        if (!this.projectDir) throw new StudioFailure('NO_PROJECT');
        const name = command.name.trim();
        if (projectNameProblem(name) !== null) throw new StudioFailure('FOLDER_NAME_INVALID');
        const parent = (await this.selected('projectparent'))[0] ?? null;
        if (!parent) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        const newDir = await copyProjectFolderInto(this.projectDir, parent, name, signal);
        try {
          await saveProject(
            join(newDir, PROJECT_FILE_NAME),
            encodeProjectFile(project, this.snapshots),
          );
        } catch (error) {
          await rm(newDir, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
        this.projectDir = newDir;
        this.state.projectName = basename(newDir);
        this.state.dirty = false;
        this.lastScan = null;
        this.hashes.clear();
        this.state.result = { key: 'projectSaved' };
        return;
      }
      case 'files': {
        const project = this.project();
        const root = this.sourceRoot;
        if (!root) throw new StudioFailure('INVALID');
        const paths = await this.selected('files');
        const files = new Map(project.files.map((f) => [f.path, f]));
        for (const path of paths) {
          await noLinks(path);
          if (!(await lstat(path)).isFile()) throw new StudioFailure('INVALID');
          const rel = relative(root, path).split(sep).join('/');
          const inside = !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../');
          if (inside) {
            if (!isReservedPath(rel) && !files.has(rel))
              files.set(rel, { path: rel, targetPath: rel, policy: 'always' });
          } else {
            const name = basename(path);
            await copyIntoDataDir(root, path, name, signal);
            if (!files.has(name))
              files.set(name, { path: name, targetPath: name, policy: 'always' });
          }
        }
        signal.throwIfAborted();
        this.state.project = parseProject({ ...project, files: [...files.values()] });
        this.state.dirty = true;
        if (!(await this.autoSave(signal))) this.state.result = { key: 'autosaveFailed' };
        return;
      }
      case 'keyStatus':
        this.project();
        this.state.signing = null;
        await this.refreshSigning();
        return;
      case 'keyCreate': {
        const project = this.project();
        const keys = this.keys;
        await keys.create(project.serverId);
        await this.refreshSigning({ keyCreated: true, sequence: null });
        this.state.result = { key: 'signingKeyCreated' };
        return;
      }
      case 'keyExport': {
        const project = this.project();
        const keys = this.keys;
        const path = await this.dialogs.save('keybackup');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await noLinks(dirname(path));
        await saveProject(path, await keys.exportBackup(project.serverId, command.passphrase));
        this.state.result = { key: 'signingKeyBackupSaved' };
        return;
      }
      case 'keyImport': {
        const project = this.project();
        const keys = this.keys;
        const path = (await this.selected('keybackup'))[0];
        if (!path) throw new StudioFailure('CANCELLED');
        const content = await safeRead(path, 16 * 1024);
        signal.throwIfAborted();
        await keys.importBackup(project.serverId, content, command.passphrase, {
          replace: command.replace,
        });
        await this.refreshSigning();
        this.state.result = { key: 'signingKeyRestored' };
        return;
      }
      case 'build': {
        const project = this.project();
        if (!this.sourceRoot) throw new StudioFailure('INVALID');
        const plan = buildPlan(project);
        if (plan.policyError) throw plan.policyError;
        const path = await this.dialogs.save('pack');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await noLinks(dirname(path));
        for (const item of plan.items) {
          if (item.kind !== 'pack') continue;
          // A pack that changed on disk since it was added would ship bytes the preset never described.
          const actual = await hashFile(join(this.sourceRoot, item.sourcePath), PACK_LIMIT, signal);
          if (actual.sha256 !== item.sha256) throw new StudioFailure('MISMATCH');
        }
        if (plan.policyText) await writeGeneratedPolicy(this.sourceRoot, plan.policyText);
        const branding = writerBranding(project, this.snapshots);
        const keyCreated = await this.ensureKey(this.keys, project.serverId);
        const key = await this.keys.load(project.serverId);
        // Reserve before writing: failed builds burn their sequence number.
        const sequence = await this.keys.reserveSequence(project.serverId, project.sequence ?? 0);
        this.state.project = { ...project, sequence };
        this.state.dirty = true;
        const signing = { sequence, sign: createEd25519Signer(key) };
        const deploymentId = randomUUID();
        const written = await writeDeployment({
          ...(branding ? { branding } : {}),
          ...signing,
          sourceRoot: this.sourceRoot,
          outputPath: path,
          serverId: project.serverId,
          deploymentId,
          game: project.game,
          files: plan.items.map((f) => ({
            sourcePath: f.sourcePath,
            path: f.path,
            policy: f.policy,
            compression: 'none',
          })),
          signal,
          onProgress: (p) => {
            this.state.progress = p.processedBytes;
          },
        });
        const built = this.state.project ?? project;
        this.state.project = {
          ...built,
          lastBuild: {
            deploymentId,
            builtAt: Date.now(),
            fileName: basename(path),
            totalLength: written.header.totalLength,
            sequence: signing.sequence,
            game: structuredClone(project.game),
            brandingKey: brandingKey(project),
            files: written.index.files.map((f) => ({
              path: f.path,
              sourcePath: plan.items.find((item) => item.path === f.path)?.sourcePath ?? f.path,
              sha256: f.sha256,
              length: f.originalLength,
              policy: f.policy,
            })),
          },
        };
        this.state.dirty = true;
        this.lastPackPath = path;
        await this.refreshSigning({ keyCreated, sequence: signing.sequence });
        this.state.result = {
          key: 'packCreated',
          sequence: signing.sequence,
          signed: true,
          keyCreated,
        };
        return;
      }
      case 'check': {
        const { check, brandingMismatch } = await this.runUrlCheck(signal);
        if (check.serverId === 'mismatch' || check.game === 'mismatch' || brandingMismatch)
          throw new StudioFailure('MISMATCH');
        if (check.fileList.state !== 'ok') throw new StudioFailure('IO');
        this.state.result = { key: 'remoteMatches' };
        return;
      }
      case 'export': {
        const project = this.project();
        this.state.launcherRelease = null;
        // Local state first: the source folder may have changed since the last listing.
        await this.runUrlCheck(signal);
        await this.derive(signal, true);
        const state = this.state.export;
        if (!state || state.blocked) throw new StudioFailure('BLOCKED');
        const destination = await this.dialogs.save('zip');
        signal.throwIfAborted();
        if (!destination) throw new StudioFailure('CANCELLED');
        const binary = await this.launcherResolver({
          target: command.target ?? 'windows',
          allowCached: command.allowCached === true,
          ...(command.cachedVersion ? { cachedVersion: command.cachedVersion } : {}),
          signal,
          progress: (bytes) => {
            this.state.progress = bytes;
          },
          status: (info) => {
            this.state.launcherRelease = info;
          },
        });
        signal.throwIfAborted();
        const keyCreated = await this.ensureKey(this.keys, project.serverId);
        const publicKey = (await this.keys.status(project.serverId)).publicKey;
        const config = parseServerConfig({
          format: 'torchlauncher-server',
          version: 1,
          serverId: project.serverId,
          name: project.name,
          address: project.address,
          sourceUrl: project.sourceUrl,
          game: project.game,
          ...(project.branding ? { branding: profileBranding(project) } : {}),
          signing: { algorithm: 'ed25519', publicKey },
        });
        const size = await exportLauncherZip(
          binary,
          destination,
          config,
          signal,
          (bytes) => {
            this.state.progress = bytes;
          },
          this.snapshots,
        );
        this.exportDone = { fileName: basename(destination), size };
        this.lastExportPath = destination;
        await this.refreshSigning({ keyCreated, sequence: null });
        this.state.result = { key: 'launcherZipCreated', keyCreated };
        return;
      }
    }
  }
  /** Creates the project's key if missing (explicit, reported by the caller). */
  private async ensureKey(keys: SigningKeyStore, serverId: string): Promise<boolean> {
    if ((await keys.status(serverId)).keyExists) return false;
    await keys.create(serverId);
    return true;
  }
  private async refreshSigning(lastOperation?: StudioSigning['lastOperation']): Promise<void> {
    const project = this.state.project;
    if (!project) {
      this.state.signing = null;
      return;
    }
    const status = await this.keys.status(project.serverId);
    this.state.signing = {
      encryptionAvailable: status.encryptionAvailable,
      keyExists: status.keyExists,
      publicKey: status.publicKey,
      lastSequence: Math.max(status.lastSequence, project.sequence ?? 0),
      lastOperation: lastOperation ?? this.state.signing?.lastOperation ?? null,
    };
  }
  /** Opens the public deployment and records a structured result in `state.urlCheck`. */
  private async runUrlCheck(
    signal: AbortSignal,
  ): Promise<{ check: StudioUrlCheck; brandingMismatch: boolean }> {
    const project = this.project();
    const identity = parseServerIdentity({
      format: 'torchlauncher-server',
      version: 1,
      serverId: project.serverId,
      name: project.name,
      address: project.address,
      sourceUrl: project.sourceUrl,
    });
    const check: StudioUrlCheck = {
      checkedAt: Date.now(),
      url: identity.sourceUrl,
      serverId: 'unknown',
      game: 'unknown',
      remoteGame: null,
      fileList: { state: 'unknown', count: null },
      range: 'unknown',
      deployment: 'unknown',
      stale: false,
    };
    let brandingMismatch = false;
    const source = this.sourceFactory(identity.sourceUrl);
    try {
      const publicKey = (await this.keys.status(project.serverId)).publicKey;
      if (!publicKey) throw new Error('signature-unverified');
      const reader = await openDeploymentReader(source, {
        expectedServerId: project.serverId,
        trustedPublicKey: publicKey,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      reader.assertCurrent();
      const remote = reader.index.game;
      check.serverId = 'ok';
      check.remoteGame = structuredClone(remote);
      check.game =
        remote.minecraftVersion === project.game.minecraftVersion &&
        remote.loader.kind === project.game.loader.kind &&
        remote.loader.version === project.game.loader.version
          ? 'ok'
          : 'mismatch';
      check.fileList = { state: 'ok', count: reader.index.files.length };
      // The reader reads the tail and index with range requests, so reaching here proves them.
      check.range = 'ok';
      for (const role of BRANDING_ROLES) {
        const expected = project.branding?.[role];
        if (expected === undefined) continue;
        const actual = reader.index.branding[role];
        if (
          expected === null
            ? actual !== null
            : !actual ||
              actual.sha256 !== expected.sha256 ||
              actual.originalLength !== expected.length ||
              actual.mediaType !== expected.mediaType
        )
          brandingMismatch = true;
      }
      if (project.lastBuild)
        check.deployment =
          reader.index.deploymentId === project.lastBuild.deploymentId && !brandingMismatch
            ? 'current'
            : 'older';
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DeploymentValidationError && error.code === 'server-mismatch')
        check.serverId = 'mismatch';
      else {
        check.fileList = { state: 'failed', count: null };
        let cause: unknown = error;
        for (let depth = 0; cause && depth < 6; depth++) {
          if (cause instanceof RangeNotSupportedError) check.range = 'failed';
          cause = (cause as { cause?: unknown }).cause;
        }
      }
    } finally {
      source.reset();
    }
    this.state.urlCheck = check;
    this.urlKey = this.fingerprint(project);
    this.state.export = this.exportState(project);
    return { check, brandingMismatch };
  }
}
