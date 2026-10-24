import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  BrandingDeploymentReader,
  DeploymentReader,
} from '../../../../../packages/core/src/deployment/reader/index';
import {
  BRANDING_LIMITS,
  BRANDING_ROLES,
  type BrandingAssetMetadata,
  type BrandingRole,
  inspectBrandingImage,
  isBrandingAssetMetadata,
  type ServerConfig,
} from '../../../../../packages/core/src/server-config/index';
import type { BrandingSnapshot } from '../../shared/branding';
import {
  atomicBrandingRecord,
  cleanupBrandingScratch,
  ensureBrandingDirectory,
  readBrandingFile,
} from './files';

const timeoutMs = 15_000;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
interface Verified {
  readonly metadata: BrandingAssetMetadata;
  readonly bytes: Buffer;
  readonly dataUrl: string;
}
export interface BrandingOptions {
  base: string;
  config: ServerConfig | null;
  configPath: string;
  /** Must actually decode and verify decoded dimensions/pixels, in addition to the header check here. */
  decode(role: BrandingRole, mediaType: BrandingAssetMetadata['mediaType'], bytes: Buffer): boolean;
  openReader(signal: AbortSignal): Promise<DeploymentReader>;
  publish(snapshot: BrandingSnapshot): void;
}

/** Profile identity is deliberately opaque on disk; contains no raw URL or source path. */
export function brandingFingerprint(config: ServerConfig, configPath: string): string {
  return digest(
    JSON.stringify({
      path: resolve(configPath),
      serverId: config.serverId,
      name: config.name,
      address: config.address,
      sourceUrl: config.sourceUrl,
      game: config.game ?? null,
      appName: config.branding?.appName ?? null,
      icon: config.branding?.icon ?? null,
      background: config.branding?.background ?? null,
    }),
  );
}
export class BrandingService {
  private state: BrandingSnapshot;
  private readonly verified: Partial<Record<BrandingRole, Verified>> = {};
  private initialized: Promise<void> | undefined;
  private generation = 0;
  private closed = false;
  private request: AbortController | undefined;
  private commits: Promise<void> = Promise.resolve();
  private readonly work = new Set<Promise<void>>();
  private cacheDirectory: string | undefined;
  constructor(private readonly options: BrandingOptions) {
    this.state = Object.freeze({
      revision: 0,
      appName: options.config?.branding?.appName ?? 'TorchLauncher',
      icon: null,
      background: null,
    });
  }
  snapshot(): BrandingSnapshot {
    return this.state;
  }
  private track(work: Promise<void>): void {
    const settled = work.catch(() => {}).finally(() => this.work.delete(settled));
    this.work.add(settled);
  }
  private initialize(): Promise<void> {
    this.initialized ??= this.loadInitial().catch(() => {});
    return this.initialized;
  }
  start(): void {
    if (this.closed || this.initialized) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.request = controller;
    this.track(
      (async () => {
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          await this.initialize();
          this.check(generation, controller.signal);
          if (!this.options.config) return;
          const reader = await this.options.openReader(controller.signal);
          this.check(generation, controller.signal);
          await this.update(reader, generation, controller.signal);
        } finally {
          clearTimeout(timer);
        }
      })(),
    );
  }
  /** Fire-and-forget; never resets/invalidates the shared game reader or returns its failures. */
  observe(reader: DeploymentReader): void {
    if (this.closed) return;
    this.request?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.request = controller;
    this.track(
      (async () => {
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          await this.initialize();
          this.check(generation, controller.signal);
          await this.update(reader, generation, controller.signal);
        } finally {
          clearTimeout(timer);
        }
      })(),
    );
  }
  private check(generation: number, signal?: AbortSignal): void {
    if (this.closed || generation !== this.generation || signal?.aborted)
      throw new Error('branding-cancelled');
  }
  private verify(role: BrandingRole, metadata: BrandingAssetMetadata, bytes: Buffer): Verified {
    if (
      !isBrandingAssetMetadata(role, metadata) ||
      bytes.length !== metadata.length ||
      digest(bytes) !== metadata.sha256
    )
      throw new Error('invalid-branding-asset');
    inspectBrandingImage(role, metadata.mediaType, bytes);
    if (!this.options.decode(role, metadata.mediaType, bytes))
      throw new Error('invalid-branding-image');
    return {
      metadata: { sha256: metadata.sha256, length: metadata.length, mediaType: metadata.mediaType },
      bytes,
      dataUrl: `data:${metadata.mediaType};base64,${bytes.toString('base64')}`,
    };
  }
  private publish(role: BrandingRole, asset: Verified | null): void {
    if (this.closed) return;
    if (asset) this.verified[role] = asset;
    else delete this.verified[role];
    const value = asset?.dataUrl ?? null;
    if (this.state[role] === value) return;
    this.state = Object.freeze({ ...this.state, revision: this.state.revision + 1, [role]: value });
    this.options.publish(this.state);
  }
  private async loadInitial(): Promise<void> {
    const config = this.options.config;
    if (!config) return;
    try {
      this.cacheDirectory = await ensureBrandingDirectory(this.options.base, [
        'branding',
        'v1',
        config.serverId,
        brandingFingerprint(config, this.options.configPath),
      ]);
    } catch {
      /* Sidecars remain usable when cache is unavailable. */
    }
    for (const role of BRANDING_ROLES) {
      if (this.closed) return;
      let cached = false;
      if (this.cacheDirectory) {
        try {
          const maximum = 256 + 4 * Math.ceil(BRANDING_LIMITS[role].length / 3);
          const bytes = await readBrandingFile(
            this.options.base,
            relative(this.options.base, join(this.cacheDirectory, `${role}.json`)),
            maximum,
          );
          const value = JSON.parse(
            new TextDecoder('utf8', { fatal: true }).decode(bytes),
          ) as Record<string, unknown>;
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
            throw new Error('invalid-cache');
          if (value.removed === true && Object.keys(value).length === 2) {
            this.publish(role, null);
            cached = true;
          } else {
            if (Object.keys(value).length !== 5 || typeof value.base64 !== 'string')
              throw new Error('invalid-cache');
            const metadata = {
              sha256: value.sha256,
              length: value.length,
              mediaType: value.mediaType,
            } as BrandingAssetMetadata;
            if (
              !isBrandingAssetMetadata(role, metadata) ||
              value.base64.length !== 4 * Math.ceil(metadata.length / 3)
            )
              throw new Error('invalid-cache');
            const raw = Buffer.from(value.base64, 'base64');
            if (raw.toString('base64') !== value.base64) throw new Error('invalid-cache');
            this.publish(role, this.verify(role, metadata, raw));
            cached = true;
          }
        } catch {
          /* Corrupt cache is never displayed. */
        }
      }
      if (cached) continue;
      const sidecar = config.branding?.[role];
      if (sidecar)
        try {
          const bytes = await readBrandingFile(
            dirname(this.options.configPath),
            sidecar.path,
            sidecar.length,
          );
          this.publish(role, this.verify(role, sidecar, bytes));
        } catch {
          /* Valid optional references may be missing, unsafe or undecodable. */
        }
    }
  }
  private async commit(
    role: BrandingRole,
    asset: Verified | null,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const work = this.commits.then(async () => {
      this.check(generation, signal);
      if (!this.cacheDirectory && asset === null) throw new Error('branding-cache-unavailable');
      if (this.cacheDirectory) {
        const config = this.options.config;
        if (!config) return;
        await ensureBrandingDirectory(this.options.base, [
          'branding',
          'v1',
          config.serverId,
          brandingFingerprint(config, this.options.configPath),
        ]);
        const record = asset
          ? { version: 1, ...asset.metadata, base64: asset.bytes.toString('base64') }
          : { version: 1, removed: true };
        await atomicBrandingRecord(
          this.cacheDirectory,
          `${role}.json`,
          Buffer.from(JSON.stringify(record)),
          () => this.check(generation, signal),
        );
      }
      // The guarded rename is the acceptance point. New observations wait this queue before
      // retain/hash decisions, so accepted bytes and visible state stay coherent across supersession.
      if (!this.closed) this.publish(role, asset);
    });
    this.commits = work.catch(() => {});
    await work;
  }
  private async update(
    reader: DeploymentReader,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.commits;
    this.check(generation, signal);
    if (reader.index.serverId !== this.options.config?.serverId) return;
    for (const role of BRANDING_ROLES) {
      this.check(generation, signal);
      const asset = reader.index.branding[role];
      if (asset === undefined) continue;
      try {
        reader.assertCurrent();
        if (asset === null) {
          await this.commit(role, null, generation, signal);
          continue;
        }
        const previous = this.verified[role]?.metadata;
        if (previous?.sha256 === asset.sha256) {
          if (previous.length !== asset.originalLength || previous.mediaType !== asset.mediaType)
            throw new Error('inconsistent-branding-metadata');
          continue;
        }
        if (!('stageBrandingAsset' in reader) || typeof reader.stageBrandingAsset !== 'function')
          continue;
        const scratch = await mkdtemp(join(tmpdir(), 'torch-branding-'));
        const scratchIdentity = await lstat(scratch, { bigint: true });
        let imageIdentity: BigIntStats | undefined;
        try {
          await (reader as BrandingDeploymentReader).stageBrandingAsset(
            role,
            join(scratch, 'image'),
            { signal },
          );
          imageIdentity = await lstat(join(scratch, 'image'), { bigint: true });
          this.check(generation, signal);
          reader.assertCurrent();
          const bytes = await readBrandingFile(scratch, 'image', BRANDING_LIMITS[role].length);
          const verified = this.verify(
            role,
            { sha256: asset.sha256, length: asset.originalLength, mediaType: asset.mediaType },
            bytes,
          );
          this.check(generation, signal);
          reader.assertCurrent();
          await this.commit(role, verified, generation, signal);
        } finally {
          await cleanupBrandingScratch(scratch, scratchIdentity, imageIdentity);
        }
      } catch {
        /* Optional image failures never escape into game preparation or erase display. */
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    ++this.generation;
    this.request?.abort();
    // A defective injected transport may ignore abort; publication and commits remain generation guarded.
    await this.commits;
  }
  /** Deterministic fixture/test drain, never used by the game preparation path. */
  async settled(): Promise<void> {
    await Promise.all([...this.work]);
  }
}
