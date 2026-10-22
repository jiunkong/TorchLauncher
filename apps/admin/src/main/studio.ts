import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { BRANDING_LIMITS, BRANDING_ROLES } from '../../../../packages/core/src/branding/index.js';
import { DeploymentValidationError } from '../../../../packages/core/src/deployment/contracts/index.js';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import { createEd25519Signer } from '../../../../packages/core/src/deployment/signing/index.js';
import { writeDeployment } from '../../../../packages/core/src/deployment/writer/index.js';
import { createDownloadSource } from '../../../../packages/core/src/download/source/factory.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import type {
  StudioProject,
  StudioReply,
  StudioRequest,
  StudioSigning,
  StudioState,
} from '../shared/studio.js';
import {
  type BrandingSnapshots,
  decodeProject,
  encodeProject,
  type ImageDecoder,
  PROJECT_READ_LIMIT,
  parseBranding,
  profileBranding,
  validateImage,
  writerBranding,
} from './branding.js';
import { exportLauncher, noLinks, safeRead, saveProject } from './filesystem.js';
import { newProject, parseProject, StudioFailure } from './project.js';
import type { SigningKeyStore } from './signing.js';

export interface StudioDialogs {
  open(
    kind:
      | 'project'
      | 'source'
      | 'files'
      | 'binary'
      | 'output'
      | 'icon'
      | 'background'
      | 'keybackup',
    root?: string,
  ): Promise<string[] | null>;
  save(kind: 'project' | 'pack' | 'keybackup'): Promise<string | null>;
  discard(): Promise<boolean>;
}
export class StudioService {
  private state: StudioState = {
    project: null,
    projectName: null,
    sourceName: null,
    dirty: false,
    busy: null,
    progress: 0,
    result: null,
    signing: null,
  };
  private projectPath: string | null = null;
  private sourceRoot: string | null = null;
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
    /** Production always injects a store; without one (tests only) builds stay unsigned. */
    private readonly keys: SigningKeyStore | null = null,
  ) {}
  snapshot(): StudioState {
    return structuredClone(this.state);
  }
  resume(): void {
    this.closing = false;
  }
  async close(): Promise<void> {
    this.closing = true;
    this.controller?.abort();
    await this.pending;
  }
  async canDiscard(): Promise<boolean> {
    return !this.state.dirty || this.dialogs.discard();
  }
  request(input: unknown): Promise<StudioReply> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return Promise.resolve({ ok: false, code: 'INVALID' });
    const value = input as Record<string, unknown>;
    const actions = [
      'state',
      'touch',
      'new',
      'open',
      'save',
      'saveAs',
      'source',
      'files',
      'build',
      'check',
      'export',
      'cancel',
    ];
    const extra =
      value.action === 'update'
        ? 'project'
        : value.action === 'brandingName'
          ? 'appName'
          : ['brandingSelect', 'brandingRemove'].includes(String(value.action))
            ? 'role'
            : null;
    const keyActions: Record<string, string[]> = {
      keyStatus: [],
      keyCreate: [],
      keyExport: ['passphrase'],
      keyImport: ['passphrase', 'replace'],
    };
    const keyFields = typeof value.action === 'string' ? keyActions[value.action] : undefined;
    if (keyFields) {
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
        !['update', 'brandingSelect', 'brandingRemove', 'brandingName'].includes(value.action)) ||
      Object.keys(value).length !== (extra ? 2 : 1) ||
      (extra && !Object.hasOwn(value, extra)) ||
      (extra === 'role' && value.role !== 'icon' && value.role !== 'background') ||
      (extra === 'appName' && value.appName !== null && typeof value.appName !== 'string')
    )
      return Promise.resolve({ ok: false, code: 'INVALID' });
    if (value.action === 'state') return Promise.resolve({ ok: true, state: this.snapshot() });
    if (value.action === 'cancel') {
      this.controller?.abort();
      return Promise.resolve({ ok: true, state: this.snapshot() });
    }
    if (this.closing || this.state.busy) return Promise.resolve({ ok: false, code: 'BUSY' });
    const command = value as unknown as StudioRequest;
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
        };
      })
      .finally(() => {
        this.controller = null;
        this.pending = null;
      });
    return this.pending;
  }
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
    switch (command.action) {
      case 'touch':
        this.project();
        this.state.dirty = true;
        return;
      case 'new':
      case 'open': {
        if (!(await this.canDiscard())) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        let path: string | null = null;
        let project: StudioProject;
        let snapshots: BrandingSnapshots = {};
        if (command.action === 'open') {
          path = (await this.selected('project'))[0] ?? null;
          if (!path) throw new StudioFailure('CANCELLED');
          const loaded = decodeProject(
            JSON.parse((await safeRead(path, PROJECT_READ_LIMIT)).toString('utf8')),
            this.decode,
          );
          project = parseProject(loaded.input);
          snapshots = loaded.snapshots;
        } else project = newProject();
        signal.throwIfAborted();
        this.state.project = project;
        this.snapshots = snapshots;
        this.projectPath = path;
        this.state.projectName = path ? basename(path) : null;
        this.sourceRoot = null;
        this.state.sourceName = null;
        this.state.dirty = !path;
        this.state.signing = null;
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
          JSON.stringify(project.branding) !== JSON.stringify(current.branding) ||
          project.serverId !== current.serverId ||
          project.sequence !== current.sequence ||
          project.files.some((f) => !paths.has(f.path))
        )
          throw new StudioFailure('INVALID');
        if (JSON.stringify(project) !== JSON.stringify(current)) {
          this.state.project = project;
          this.state.dirty = true;
        }
        return;
      }
      case 'save':
      case 'saveAs': {
        const project = this.project();
        const path =
          command.action === 'save' && this.projectPath
            ? this.projectPath
            : await this.dialogs.save('project');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await saveProject(path, encodeProject(project, this.snapshots));
        this.projectPath = path;
        this.state.projectName = basename(path);
        this.state.dirty = false;
        this.state.result = '프로젝트를 저장했습니다.';
        return;
      }
      case 'source': {
        this.project();
        const path = (await this.selected('source'))[0];
        if (!path) throw new StudioFailure('CANCELLED');
        await noLinks(path);
        if (!(await lstat(path)).isDirectory()) throw new StudioFailure('INVALID');
        signal.throwIfAborted();
        this.sourceRoot = resolve(path);
        this.state.sourceName = basename(path);
        return;
      }
      case 'files': {
        const project = this.project();
        if (!this.sourceRoot) throw new StudioFailure('INVALID');
        const paths = await this.selected('files', this.sourceRoot);
        const files = new Map(project.files.map((f) => [f.path, f]));
        for (const path of paths) {
          const rel = relative(this.sourceRoot, path).split(sep).join('/');
          if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
            throw new StudioFailure('INVALID');
          await noLinks(path);
          if (!(await lstat(path)).isFile()) throw new StudioFailure('INVALID');
          if (!files.has(rel)) files.set(rel, { path: rel, policy: 'always' });
        }
        signal.throwIfAborted();
        this.state.project = parseProject({ ...project, files: [...files.values()] });
        this.state.dirty = true;
        return;
      }
      case 'keyStatus':
        this.project();
        this.state.signing = null;
        await this.refreshSigning();
        return;
      case 'keyCreate': {
        const project = this.project();
        const keys = this.keys ?? this.noKeys();
        await keys.create(project.serverId);
        await this.refreshSigning({ keyCreated: true, sequence: null });
        this.state.result = '새 서명 키를 만들었습니다.';
        return;
      }
      case 'keyExport': {
        const project = this.project();
        const keys = this.keys ?? this.noKeys();
        const path = await this.dialogs.save('keybackup');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await noLinks(dirname(path));
        await saveProject(path, await keys.exportBackup(project.serverId, command.passphrase));
        this.state.result = '서명 키 백업 파일을 저장했습니다.';
        return;
      }
      case 'keyImport': {
        const project = this.project();
        const keys = this.keys ?? this.noKeys();
        const path = (await this.selected('keybackup'))[0];
        if (!path) throw new StudioFailure('CANCELLED');
        const content = await safeRead(path, 16 * 1024);
        signal.throwIfAborted();
        await keys.importBackup(project.serverId, content, command.passphrase, {
          replace: command.replace,
        });
        await this.refreshSigning();
        this.state.result = '서명 키를 복원했습니다.';
        return;
      }
      case 'build': {
        const project = this.project();
        if (!this.sourceRoot) throw new StudioFailure('INVALID');
        const path = await this.dialogs.save('pack');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await noLinks(dirname(path));
        const branding = writerBranding(project, this.snapshots);
        let signing: { sequence: number; sign: ReturnType<typeof createEd25519Signer> } | null =
          null;
        let keyCreated = false;
        if (this.keys) {
          keyCreated = await this.ensureKey(this.keys, project.serverId);
          const key = await this.keys.load(project.serverId);
          // Reserved (persisted) before writing: a failed build burns the number, never reuses it.
          const sequence = await this.keys.reserveSequence(project.serverId, project.sequence ?? 0);
          this.state.project = { ...project, sequence };
          this.state.dirty = true;
          signing = { sequence, sign: createEd25519Signer(key) };
        }
        await writeDeployment({
          ...(branding ? { branding } : {}),
          ...(signing ? signing : {}),
          sourceRoot: this.sourceRoot,
          outputPath: path,
          serverId: project.serverId,
          deploymentId: randomUUID(),
          game: project.game,
          files: project.files.map((f) => ({
            sourcePath: f.path,
            policy: f.policy,
            compression: 'none',
          })),
          signal,
          onProgress: (p) => {
            this.state.progress = p.processedBytes;
          },
        });
        await this.refreshSigning({ keyCreated, sequence: signing?.sequence ?? null });
        this.state.result = `torchpack 배포 파일을 생성했습니다${
          signing
            ? ` (서명됨, sequence ${signing.sequence}${keyCreated ? ', 새 서명 키 생성' : ''})`
            : ''
        }. 공개 호스팅에 직접 업로드한 뒤 URL을 검사하세요.`;
        return;
      }
      case 'check': {
        await this.verify(signal);
        this.state.result = '공개 배포 파일의 서버 ID · Minecraft · 로더가 프로젝트와 일치합니다.';
        return;
      }
      case 'export': {
        const project = this.project();
        const binary = (await this.selected('binary'))[0];
        const output = (await this.selected('output'))[0];
        if (!binary || !output) throw new StudioFailure('CANCELLED');
        await this.verify(signal);
        let keyCreated = false;
        let publicKey: string | null = null;
        if (this.keys) {
          keyCreated = await this.ensureKey(this.keys, project.serverId);
          publicKey = (await this.keys.status(project.serverId)).publicKey;
        }
        const config = parseServerConfig({
          format: 'torchlauncher-server',
          version: 1,
          serverId: project.serverId,
          name: project.name,
          address: project.address,
          sourceUrl: project.sourceUrl,
          game: project.game,
          ...(project.branding ? { branding: profileBranding(project) } : {}),
          ...(publicKey ? { signing: { algorithm: 'ed25519', publicKey } } : {}),
        });
        await exportLauncher(
          binary,
          output,
          config,
          signal,
          (bytes) => {
            this.state.progress = bytes;
          },
          this.snapshots,
        );
        await this.refreshSigning({ keyCreated, sequence: null });
        this.state.result = `공통 런처와 서버 설정을 출력 폴더에 복사했습니다${
          keyCreated ? ' (새 서명 키 생성: 이전 런처 사용자는 새 런처가 필요합니다)' : ''
        }.`;
        return;
      }
    }
  }
  private noKeys(): never {
    throw new StudioFailure('ENCRYPTION_UNAVAILABLE');
  }
  /** Creates the project's key if missing (explicit, reported by the caller). */
  private async ensureKey(keys: SigningKeyStore, serverId: string): Promise<boolean> {
    if ((await keys.status(serverId)).keyExists) return false;
    await keys.create(serverId);
    return true;
  }
  private async refreshSigning(lastOperation?: StudioSigning['lastOperation']): Promise<void> {
    const project = this.state.project;
    if (!project || !this.keys) {
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
  private async verify(signal: AbortSignal): Promise<void> {
    const project = this.project();
    const config = parseServerConfig({
      format: 'torchlauncher-server',
      version: 1,
      serverId: project.serverId,
      name: project.name,
      address: project.address,
      sourceUrl: project.sourceUrl,
    });
    const source = this.sourceFactory(config.sourceUrl);
    try {
      const reader = await openDeploymentReader(source, {
        expectedServerId: project.serverId,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      if (
        reader.index.game.minecraftVersion !== project.game.minecraftVersion ||
        reader.index.game.loader.kind !== project.game.loader.kind ||
        reader.index.game.loader.version !== project.game.loader.version
      )
        throw new StudioFailure('MISMATCH');
      for (const role of BRANDING_ROLES) {
        const expected = project.branding?.[role];
        if (expected === undefined) continue;
        const actual = reader.index.branding?.[role];
        if (
          expected === null
            ? actual !== null
            : !actual ||
              actual.sha256 !== expected.sha256 ||
              actual.originalLength !== expected.length ||
              actual.mediaType !== expected.mediaType
        )
          throw new StudioFailure('MISMATCH');
      }
      reader.assertCurrent();
    } catch (error) {
      if (error instanceof DeploymentValidationError && error.code === 'server-mismatch')
        throw new StudioFailure('MISMATCH');
      throw error;
    } finally {
      source.reset();
    }
  }
}
