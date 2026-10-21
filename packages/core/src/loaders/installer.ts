import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, opendir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { secureDirectory, stat } from '../minecraft/filesystem';
import type { Downloader, Installation } from '../minecraft/installer';
import { acquireServerDataLock } from '../minecraft/lock';
import { allows, object, parseVersion, safePath } from '../minecraft/metadata';
import { runInstallerJava } from '../minecraft/process';
import { jarJson } from './archive';
import {
  exactSelection,
  inspectProfile,
  type LoaderSelection,
  loaderInstallation,
} from './profile';

export interface InstallLoaderOptions {
  selection: LoaderSelection;
  download: Downloader;
  signal?: AbortSignal;
  timeoutMs?: number;
}
async function bytes(options: InstallLoaderOptions, url: string, maxBytes: number) {
  options.signal?.throwIfAborted();
  const result = await options.download(url, {
    maxBytes,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  options.signal?.throwIfAborted();
  if (result.length > maxBytes) throw new Error('Loader response limit exceeded');
  return result;
}
function hash(data: Uint8Array, algorithm = 'sha256') {
  return createHash(algorithm).update(data).digest('hex');
}
async function sidecar(options: InstallLoaderOptions, url: string) {
  const text = new TextDecoder('utf8', { fatal: true })
    .decode(await bytes(options, `${url}.sha256`, 1024))
    .trim();
  if (!/^[a-f0-9]{64}(?:\s+\S+)?$/.test(text)) throw new Error('Invalid loader checksum');
  return text.slice(0, 64);
}
async function readRegular(path: string, maximum: number): Promise<Buffer> {
  await secureDirectory(dirname(path));
  const before = await stat(path);
  if (!before?.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum)
    throw new Error('Unsafe or oversized loader file');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
      throw new Error('Loader file changed');
    const data = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const read = await handle.read(data, offset, data.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.nlink !== 1
    )
      throw new Error('Loader file changed');
    return data.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
async function copyBase(base: Installation, stage: string) {
  await secureDirectory(join(stage, 'versions', base.version.id));
  const client = await readRegular(
    join(base.root, 'versions', base.version.id, `${base.version.id}.jar`),
    512 * 1024 * 1024,
  );
  if (
    client.length !== base.version.downloads.client.size ||
    hash(client, 'sha1') !== base.version.downloads.client.sha1
  )
    throw new Error('Base client integrity mismatch');
  const json = await readRegular(
    join(base.root, 'versions', base.version.id, `${base.version.id}.json`),
    4 * 1024 * 1024,
  );
  if (
    JSON.stringify(parseVersion(JSON.parse(json.toString('utf8')))) !== JSON.stringify(base.version)
  )
    throw new Error('Base metadata integrity mismatch');
  await writeFile(join(stage, 'versions', base.version.id, `${base.version.id}.jar`), client, {
    flag: 'wx',
  });
  await writeFile(join(stage, 'versions', base.version.id, `${base.version.id}.json`), json, {
    flag: 'wx',
  });
  for (const library of base.version.libraries) {
    if (!allows(library.rules, base.platform)) continue;
    const target = join(stage, 'libraries', library.artifact.path);
    await secureDirectory(dirname(target));
    const data = await readFile(join(base.root, 'libraries', library.artifact.path)).catch(
      () => undefined,
    );
    if (!data) continue;
    if (data.length !== library.artifact.size || hash(data, 'sha1') !== library.artifact.sha1)
      throw new Error('Base library integrity mismatch');
    await writeFile(target, data, { flag: 'wx' });
  }
  await writeFile(
    join(stage, 'launcher_profiles.json'),
    JSON.stringify({ profiles: {}, settings: {} }),
    { flag: 'wx' },
  );
}
async function treeFiles(
  root: string,
  prefix = '',
  result: { path: string; sha256: string; size: number }[] = [],
) {
  for await (const entry of await opendir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safePath(path);
    if (entry.isSymbolicLink()) throw new Error('Installer emitted a symlink');
    if (entry.isDirectory()) await treeFiles(root, path, result);
    else {
      const info = await stat(join(root, path));
      if (
        !info?.isFile() ||
        info.nlink !== 1 ||
        info.size > 512 * 1024 * 1024 ||
        result.length >= 10000
      )
        throw new Error('Unsafe installer output');
      const data = await readRegular(join(root, path), 512 * 1024 * 1024);
      result.push({ path, sha256: hash(data), size: data.length });
    }
  }
  return result;
}
/** Run official processors only in private staging, verify outputs, then publish an immutable loader tree. */
export async function installLoader(
  base: Installation,
  original: InstallLoaderOptions,
): Promise<Installation> {
  exactSelection(original.selection);
  const timeout = original.timeoutMs ?? 600000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 1800000)
    throw new Error('Invalid loader timeout');
  const options = {
    ...original,
    signal: AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(original.signal ? [original.signal] : []),
    ]),
  };
  const lease = await acquireServerDataLock(base.root, 'install');
  const parent = join(base.root, '.torchlauncher-loaders');
  const name = `${options.selection.kind}-${options.selection.version}`;
  let stage = '';
  try {
    if (await stat(join(base.root, '.torchlauncher-install-lock')))
      throw new Error('Base installation recovery required');
    await secureDirectory(parent);
    const destination = join(parent, name);
    // Never use a preexisting, unverified tree, nor replace one referenced by a previous installation.
    if (await stat(destination)) {
      await secureDirectory(destination);
      const saved = object(
        JSON.parse(
          (await readRegular(join(destination, 'receipt.json'), 16 * 1024 * 1024)).toString('utf8'),
        ),
      );
      if (
        object(saved.selection).kind !== options.selection.kind ||
        object(saved.selection).version !== options.selection.version ||
        saved.minecraft !== base.version.id
      )
        throw new Error('Loader cache identity mismatch');
      const actual = await treeFiles(join(destination, 'libraries'));
      actual.sort((a, b) => a.path.localeCompare(b.path));
      if (JSON.stringify(actual) !== JSON.stringify(saved.files))
        throw new Error('Loader cache integrity mismatch');
      const savedProfile = await readRegular(join(destination, 'profile.json'), 4 * 1024 * 1024);
      if (savedProfile.length > 4 * 1024 * 1024 || hash(savedProfile) !== saved.profileSha256)
        throw new Error('Loader profile integrity mismatch');
      return loaderInstallation(
        base,
        options.selection,
        JSON.parse(savedProfile.toString('utf8')),
        destination,
      );
    }
    stage = join(parent, `.stage-${randomUUID()}`);
    await mkdir(stage);
    let profile: unknown;
    if (options.selection.kind === 'neoforge') {
      const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${options.selection.version}/neoforge-${options.selection.version}-installer.jar`;
      const expected = await sidecar(options, url);
      const jar = await bytes(options, url, 64 * 1024 * 1024);
      if (hash(jar) !== expected) throw new Error('Installer integrity mismatch');
      const install = object(jarJson(jar, 'install_profile.json'));
      profile = jarJson(jar, 'version.json');
      inspectProfile(profile, base, options.selection);
      if (
        install.minecraft !== base.version.id ||
        install.version !== `neoforge-${options.selection.version}`
      )
        throw new Error('Installer version mismatch');
      await copyBase(base, stage);
      const jarPath = join(stage, 'installer.jar');
      await writeFile(jarPath, jar, { flag: 'wx' });
      const result = await runInstallerJava(
        base,
        stage,
        ['-Djava.awt.headless=true', '-jar', jarPath, '--installClient', stage],
        options.signal,
      );
      if (result.code !== 0 || result.reason !== 'exited')
        throw new Error('NeoForge official client installer failed');
      const emitted = JSON.parse(
        (
          await readRegular(
            join(
              stage,
              'versions',
              `neoforge-${options.selection.version}`,
              `neoforge-${options.selection.version}.json`,
            ),
            4 * 1024 * 1024,
          )
        ).toString('utf8'),
      );
      if (JSON.stringify(emitted) !== JSON.stringify(profile))
        throw new Error('Installer profile changed unexpectedly');
      const patched = join(
        stage,
        'libraries/net/neoforged/neoforge',
        options.selection.version,
        `neoforge-${options.selection.version}-client.jar`,
      );
      const content = await readRegular(patched, 512 * 1024 * 1024);
      if (content.length < 4 || content.readUInt32LE(0) !== 0x04034b50)
        throw new Error('Patched client missing');
    } else {
      const url = `https://meta.fabricmc.net/v2/versions/loader/${base.version.id}/${options.selection.version}/profile/json`;
      profile = JSON.parse(
        new TextDecoder('utf8', { fatal: true }).decode(await bytes(options, url, 4 * 1024 * 1024)),
      );
      await secureDirectory(join(stage, 'libraries'));
    }
    const parsed = inspectProfile(profile, base, options.selection);
    for (const library of parsed.libraries) {
      const target = join(stage, 'libraries', library.path);
      await secureDirectory(dirname(target));
      const existing = await readFile(target).catch(() => undefined);
      const expected =
        library.sha256 ?? (library.sha1 ? undefined : await sidecar(options, library.url));
      const data =
        existing ?? (await bytes(options, library.url, library.size ?? 64 * 1024 * 1024));
      if (
        (library.size !== undefined && data.length !== library.size) ||
        (library.sha1 && hash(data, 'sha1') !== library.sha1) ||
        (expected && hash(data) !== expected)
      )
        throw new Error('Loader library integrity mismatch');
      if (!existing) await writeFile(target, data, { flag: 'wx' });
      const rawLibraries = object(profile).libraries as unknown[];
      rawLibraries[parsed.libraries.indexOf(library)] = {
        ...library.raw,
        downloads: {
          artifact: {
            path: library.path,
            url: library.url,
            sha1: hash(data, 'sha1'),
            size: data.length,
          },
        },
      };
    }
    // Retain only the validated library tree and profile; installer logs/bookkeeping never enter game data.
    const published = join(stage, 'publish');
    await mkdir(published);
    await rename(join(stage, 'libraries'), join(published, 'libraries'));
    const files = await treeFiles(join(published, 'libraries'));
    files.sort((a, b) => a.path.localeCompare(b.path));
    await writeFile(join(published, 'profile.json'), JSON.stringify(profile), { flag: 'wx' });
    await writeFile(
      join(published, 'receipt.json'),
      JSON.stringify({
        selection: options.selection,
        minecraft: base.version.id,
        profileSha256: hash(Buffer.from(JSON.stringify(profile))),
        files,
      }),
      { flag: 'wx' },
    );
    options.signal.throwIfAborted();
    await rename(published, destination);
    return loaderInstallation(base, options.selection, profile, destination);
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await lease.release();
  }
}
