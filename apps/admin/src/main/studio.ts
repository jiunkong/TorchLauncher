import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DeploymentValidationError } from '../../../../packages/core/src/deployment/contracts/index.js';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import { writeDeployment } from '../../../../packages/core/src/deployment/writer/index.js';
import { createDownloadSource } from '../../../../packages/core/src/download/source/factory.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import type { StudioCommand, StudioProject, StudioReply, StudioState } from '../shared/studio.js';
import { exportLauncher, noLinks, safeRead, saveProject } from './filesystem.js';
import { newProject, parseProject, StudioFailure } from './project.js';

export interface StudioDialogs {
  open(
    kind: 'project' | 'source' | 'files' | 'binary' | 'output',
    root?: string,
  ): Promise<string[] | null>;
  save(kind: 'project' | 'pack'): Promise<string | null>;
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
  };
  private projectPath: string | null = null;
  private sourceRoot: string | null = null;
  private closing = false;
  private controller: AbortController | null = null;
  private pending: Promise<StudioReply> | null = null;
  constructor(
    private readonly dialogs: StudioDialogs,
    private readonly sourceFactory = createDownloadSource,
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
    if (
      typeof value.action !== 'string' ||
      (!actions.includes(value.action) && value.action !== 'update') ||
      Object.keys(value).length !== (value.action === 'update' ? 2 : 1) ||
      (value.action === 'update' && !Object.hasOwn(value, 'project'))
    )
      return Promise.resolve({ ok: false, code: 'INVALID' });
    if (value.action === 'state') return Promise.resolve({ ok: true, state: this.snapshot() });
    if (value.action === 'cancel') {
      this.controller?.abort();
      return Promise.resolve({ ok: true, state: this.snapshot() });
    }
    if (this.closing || this.state.busy) return Promise.resolve({ ok: false, code: 'BUSY' });
    const command = value as unknown as StudioCommand;
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
        } as const
      )[command.action as 'save'] ?? 'choosing';
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
  private async perform(command: StudioCommand, signal: AbortSignal): Promise<void> {
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
        if (command.action === 'open') {
          path = (await this.selected('project'))[0] ?? null;
          if (!path) throw new StudioFailure('CANCELLED');
          project = parseProject(
            JSON.parse((await safeRead(path, 4 * 1024 ** 2)).toString('utf8')),
          );
        } else project = newProject();
        signal.throwIfAborted();
        this.state.project = project;
        this.projectPath = path;
        this.state.projectName = path ? basename(path) : null;
        this.sourceRoot = null;
        this.state.sourceName = null;
        this.state.dirty = !path;
        return;
      }
      case 'update': {
        const project = parseProject(command.project);
        const current = this.project();
        const paths = new Set(current.files.map((f) => f.path));
        if (project.serverId !== current.serverId || project.files.some((f) => !paths.has(f.path)))
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
        await saveProject(path, `${JSON.stringify(project, null, 2)}\n`);
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
      case 'build': {
        const project = this.project();
        if (!this.sourceRoot) throw new StudioFailure('INVALID');
        const path = await this.dialogs.save('pack');
        if (!path) throw new StudioFailure('CANCELLED');
        signal.throwIfAborted();
        await noLinks(dirname(path));
        await writeDeployment({
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
        this.state.result =
          'torchpack 배포 파일을 생성했습니다. 공개 호스팅에 직접 업로드한 뒤 URL을 검사하세요.';
        return;
      }
      case 'check': {
        await this.verify(signal);
        this.state.result = '공개 배포 파일의 서버 ID · Minecraft · 로더가 프로젝트와 일치합니다.';
        return;
      }
      case 'export': {
        const project = this.project();
        const config = parseServerConfig({
          format: 'torchlauncher-server',
          version: 1,
          serverId: project.serverId,
          name: project.name,
          address: project.address,
          sourceUrl: project.sourceUrl,
        });
        await this.verify(signal);
        const binary = (await this.selected('binary'))[0];
        const output = (await this.selected('output'))[0];
        if (!binary || !output) throw new StudioFailure('CANCELLED');
        await exportLauncher(binary, output, config, signal, (bytes) => {
          this.state.progress = bytes;
        });
        this.state.result = '공통 런처와 서버 설정을 출력 폴더에 복사했습니다.';
        return;
      }
    }
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
