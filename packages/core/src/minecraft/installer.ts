import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path';
import { secureDirectory, stat } from './filesystem';
import { acquireServerDataLock } from './lock';
import {
  allows,
  type Download,
  download,
  integer,
  list,
  object,
  type Platform,
  parseRuntime,
  parseVersion,
  type RuntimeEntry,
  runtimePlatform,
  safePath,
  sha1,
  string,
  type Version,
} from './metadata';

export const VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const JAVA_MANIFEST_URL =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
/** Adapter must bound the response while streaming and reject HTTP errors and unsafe redirects. */
export type Downloader = (
  url: string,
  options: { signal?: AbortSignal; maxBytes: number },
) => Promise<Uint8Array>;
export interface InstallOptions {
  /** Dedicated server directory; caller must serialize game launch, updates and deletion. */
  root: string;
  version?: string;
  platform: Platform;
  download: Downloader;
  signal?: AbortSignal;
  onProgress?: (event: { path: string; completed: number; total: number; cached: boolean }) => void;
}
export interface Installation {
  root: string;
  platform: Platform;
  version: Version;
  javaPath: string;
  classpath: string[];
  nativesDirectory: string;
  assetsDirectory: string;
  loggingPath?: string;
}
interface FilePlan {
  path: string;
  source: Download;
}
interface Plan {
  version: Version;
  files: FilePlan[];
  runtime: Record<string, RuntimeEntry>;
  runtimePath: string;
  javaRelativePath: string;
  classpath: string[];
  metadata: { path: string; bytes: Uint8Array }[];
}
const JSON_LIMIT = 16 * 1024 * 1024;
function aborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
function digest(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}
function verify(bytes: Uint8Array, source: Download): void {
  if (bytes.byteLength !== source.size || digest(bytes) !== source.sha1) {
    throw new Error(`Download integrity mismatch: ${source.url}`);
  }
}
async function fetchBytes(options: InstallOptions, source: Download): Promise<Uint8Array> {
  aborted(options.signal);
  const bytes = await options.download(source.url, {
    ...(options.signal ? { signal: options.signal } : {}),
    maxBytes: source.size,
  });
  aborted(options.signal);
  verify(bytes, source);
  return bytes;
}
async function fetchJson(
  options: InstallOptions,
  url: string,
  source?: Download,
): Promise<{ value: unknown; bytes: Uint8Array }> {
  if (source && source.size > JSON_LIMIT) throw new Error('Metadata exceeds size limit');
  aborted(options.signal);
  const bytes = source
    ? await fetchBytes(options, source)
    : await options.download(url, {
        ...(options.signal ? { signal: options.signal } : {}),
        maxBytes: JSON_LIMIT,
      });
  aborted(options.signal);
  if (bytes.byteLength > JSON_LIMIT) throw new Error('Metadata exceeds size limit');
  return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
}
function validateRuntimeLinks(runtime: Record<string, RuntimeEntry>): void {
  const canonical = new Map(
    Object.entries(runtime).map(([path, entry]) => [path.toLowerCase(), entry]),
  );
  for (const [path, entry] of Object.entries(runtime)) {
    let parent = posix.dirname(path);
    while (parent !== '.') {
      if (
        canonical.has(parent.toLowerCase()) &&
        canonical.get(parent.toLowerCase())?.type !== 'directory'
      )
        throw new Error('Runtime entry has a non-directory ancestor');
      parent = posix.dirname(parent);
    }
    if (entry.type !== 'link') continue;
    if (entry.target.includes('\\') || entry.target.startsWith('/') || entry.target.includes(':'))
      throw new Error('Unsafe runtime link');
    const target = posix.normalize(posix.join(posix.dirname(path), entry.target));
    safePath(target);
    // Only direct manifest entries; link chains and dangling links are unnecessary for Java 21.
    if (!runtime[target] || runtime[target]?.type === 'link')
      throw new Error('Invalid runtime link target');
  }
}
/** Resolve trusted HTTPS catalogs through injected transport, verifying every hashed child document. */
async function createPlan(options: InstallOptions): Promise<Plan> {
  const requested = options.version ?? '1.21.1';
  const platformKey = runtimePlatform(options.platform);
  const catalog = object((await fetchJson(options, VERSION_MANIFEST_URL)).value);
  const match = list(catalog.versions)
    .map(object)
    .find((entry) => entry.id === requested);
  if (!match) throw new Error(`Minecraft version unavailable: ${requested}`);
  const versionSource = download({ ...match, size: 0 });
  // The version catalog supplies a hash but no length. Bound its document, then check the hash.
  const versionJson = await fetchJson(options, versionSource.url);
  if (digest(versionJson.bytes) !== versionSource.sha1)
    throw new Error('Version metadata integrity mismatch');
  const version = parseVersion(versionJson.value);
  if (version.id !== requested || version.javaVersion.majorVersion !== 21)
    throw new Error('Only modern Java 21 Minecraft versions are supported');
  const assetJson = await fetchJson(options, version.assetIndex.url, version.assetIndex);
  const javaCatalog = object((await fetchJson(options, JAVA_MANIFEST_URL)).value);
  const candidates = list(object(javaCatalog[platformKey])[version.javaVersion.component], 100);
  // Do not install a runtime still in a staged rollout or an unrelated Java major.
  const runtimeCandidate = candidates.map(object).find((candidate) => {
    const availability = object(candidate.availability);
    const name = string(object(candidate.version).name);
    return (
      availability.progress === 100 &&
      Number(name.split('.')[0]) === version.javaVersion.majorVersion
    );
  });
  if (!runtimeCandidate) throw new Error(`Compatible Java runtime unavailable for ${platformKey}`);
  const runtimeSource = download(runtimeCandidate.manifest);
  const runtimeJson = await fetchJson(options, runtimeSource.url, runtimeSource);
  const runtime = parseRuntime(runtimeJson.value);
  validateRuntimeLinks(runtime);
  const runtimePath = `runtime/${version.javaVersion.component}/${platformKey}`;
  const javaRelativePath =
    options.platform.os === 'osx'
      ? 'jre.bundle/Contents/Home/bin/java'
      : options.platform.os === 'windows'
        ? 'bin/javaw.exe'
        : 'bin/java';
  const javaEntry = runtime[javaRelativePath];
  if (javaEntry?.type !== 'file' || !javaEntry.executable)
    throw new Error('Runtime is missing its executable');
  const files: FilePlan[] = [
    { path: `versions/${version.id}/${version.id}.jar`, source: version.downloads.client },
  ];
  const classpath: string[] = [];
  for (const library of version.libraries) {
    if (!allows(library.rules, options.platform)) continue;
    // 1.21.1 publishes OS rules for native JARs; LWJGL chooses the architecture inside the JAR set.
    const path = `libraries/${library.artifact.path}`;
    files.push({ path, source: library.artifact });
    classpath.push(path);
  }
  classpath.push(files[0]?.path ?? '');
  const assets = Object.entries(object(object(assetJson.value).objects));
  if (assets.length > 100_000) throw new Error('Too many asset entries');
  for (const [, raw] of assets) {
    const asset = object(raw);
    const hash = sha1(asset.hash);
    const path = `${hash.slice(0, 2)}/${hash}`;
    files.push({
      path: `assets/objects/${path}`,
      source: {
        url: `https://resources.download.minecraft.net/${path}`,
        sha1: hash,
        size: integer(asset.size),
      },
    });
  }
  const assetData = object(assetJson.value);
  if (assetData.virtual || assetData.map_to_resources)
    throw new Error('Legacy asset layouts are unsupported');
  if (version.logging)
    files.push({
      path: `assets/log_configs/${version.logging.file.id}`,
      source: version.logging.file,
    });
  const unique = new Map<string, FilePlan>();
  for (const file of files) {
    safePath(file.path);
    const prior = unique.get(file.path.toLowerCase());
    if (
      prior &&
      (prior.path !== file.path ||
        prior.source.sha1 !== file.source.sha1 ||
        prior.source.size !== file.source.size)
    )
      throw new Error('Conflicting installation paths');
    unique.set(file.path.toLowerCase(), file);
  }
  return {
    version,
    files: [...unique.values()],
    runtime,
    runtimePath,
    javaRelativePath,
    classpath,
    metadata: [
      { path: `versions/${version.id}/${version.id}.json`, bytes: versionJson.bytes },
      { path: `assets/indexes/${version.assetIndex.id}.json`, bytes: assetJson.bytes },
    ],
  };
}
async function cached(path: string, source: Download): Promise<boolean> {
  const info = await stat(path);
  if (!info) return false;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe installation file: ${path}`);
  if (info.size !== source.size) return false;
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex') === source.sha1;
}
async function destination(root: string, path: string): Promise<string> {
  safePath(path);
  const target = resolve(root, path);
  if (!target.startsWith(`${root}${sep}`) || isAbsolute(path))
    throw new Error('Path escapes installation root');
  await secureDirectory(dirname(target));
  const info = await stat(target);
  if (info?.isSymbolicLink()) throw new Error(`Unsafe installation destination: ${path}`);
  return target;
}
/** All downloads finish before publication; commit failures roll back replacements. One writer per root. */
export async function installMinecraft(options: InstallOptions): Promise<Installation> {
  aborted(options.signal);
  const lease = await acquireServerDataLock(options.root, 'install');
  try {
    return await installLocked(options, lease.root);
  } finally {
    await lease.release();
  }
}
async function installLocked(options: InstallOptions, root: string): Promise<Installation> {
  const lock = join(root, '.torchlauncher-install-lock');
  // A leftover lock after a killed process requires caller recovery; never steal an active lock.
  await mkdir(lock);
  const staging = join(lock, 'staging');
  const backups = join(lock, 'backups');
  const published: { target: string; backup?: string }[] = [];
  let retainRecovery = false;
  try {
    await mkdir(staging);
    await mkdir(backups);
    const plan = await createPlan(options);
    const updates: { path: string; staged: string }[] = [];
    const runtimeStage = join(staging, 'runtime');
    await mkdir(runtimeStage);
    const runtimeFiles = Object.entries(plan.runtime).filter(([, entry]) => entry.type === 'file');
    const total = plan.files.length + runtimeFiles.length;
    let completed = 0;
    const report = (path: string, hit: boolean) => {
      completed++;
      options.onProgress?.({ path, completed, total, cached: hit });
    };
    for (const file of plan.files) {
      aborted(options.signal);
      const target = await destination(root, file.path);
      if (await cached(target, file.source)) {
        report(file.path, true);
        continue;
      }
      const staged = join(staging, randomUUID());
      await writeFile(staged, await fetchBytes(options, file.source), { flag: 'wx' });
      updates.push({ path: file.path, staged });
      report(file.path, false);
    }
    // Runtime is replaced as one complete tree, avoiding mixed Java versions and unsafe old links.
    for (const [path, entry] of Object.entries(plan.runtime)) {
      const target = join(runtimeStage, path);
      if (entry.type === 'directory') {
        await secureDirectory(target);
        continue;
      }
      if (entry.type === 'link') continue;
      aborted(options.signal);
      await secureDirectory(dirname(target));
      const oldPath = await destination(root, `${plan.runtimePath}/${path}`);
      const hit = await cached(oldPath, entry.download);
      if (hit) await copyFile(oldPath, target);
      else await writeFile(target, await fetchBytes(options, entry.download), { flag: 'wx' });
      await chmod(target, entry.executable ? 0o755 : 0o644);
      report(`${plan.runtimePath}/${path}`, hit);
    }
    for (const [path, entry] of Object.entries(plan.runtime)) {
      if (entry.type !== 'link') continue;
      await secureDirectory(dirname(join(runtimeStage, path)));
      await symlink(
        entry.target,
        join(runtimeStage, path),
        plan.runtime[posix.normalize(posix.join(posix.dirname(path), entry.target))]?.type ===
          'directory'
          ? 'dir'
          : 'file',
      );
    }
    updates.push({ path: plan.runtimePath, staged: runtimeStage });
    for (const metadata of plan.metadata) {
      const staged = join(staging, randomUUID());
      await writeFile(staged, metadata.bytes, { flag: 'wx' });
      updates.push({ path: metadata.path, staged });
    }
    const nativesDirectory = await destination(root, `natives/${plan.version.id}`);
    await secureDirectory(nativesDirectory);
    // Persist intent before the first rename so an interrupted process leaves recoverable paths.
    const operations: { target: string; staged: string; backup?: string }[] = [];
    for (const update of updates) {
      const target = await destination(root, update.path);
      const info = await stat(target);
      if (info && (update.path === plan.runtimePath ? !info.isDirectory() : !info.isFile())) {
        throw new Error('Installation target has unexpected type');
      }
      operations.push({
        target,
        staged: update.staged,
        ...(info ? { backup: join(backups, randomUUID()) } : {}),
      });
    }
    await writeFile(join(lock, 'journal.json'), JSON.stringify({ version: 1, root, operations }), {
      flag: 'wx',
    });
    // Cancellation stops before this commit boundary. Publication finishes or rolls back as a unit.
    aborted(options.signal);
    try {
      for (const operation of operations) {
        // Caller serializes all mutations; recheck parent directories at each rename boundary.
        await secureDirectory(dirname(operation.target));
        if (operation.backup) await rename(operation.target, operation.backup);
        published.push(operation);
        await rename(operation.staged, operation.target);
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const operation of published.reverse()) {
        try {
          await rm(operation.target, { recursive: true, force: true });
          if (operation.backup) await rename(operation.backup, operation.target);
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      if (failures.length) {
        retainRecovery = true;
        throw new AggregateError(
          [error, ...failures],
          `Install rollback failed; preserve recovery files at ${lock}`,
        );
      }
      throw error;
    }
    return {
      root,
      platform: options.platform,
      version: plan.version,
      javaPath: join(root, plan.runtimePath, plan.javaRelativePath),
      classpath: plan.classpath.map((path) => join(root, path)),
      nativesDirectory,
      assetsDirectory: join(root, 'assets'),
      ...(plan.version.logging
        ? { loggingPath: join(root, 'assets/log_configs', plan.version.logging.file.id) }
        : {}),
    };
  } finally {
    if (!retainRecovery) await rm(lock, { recursive: true, force: true });
  }
}
