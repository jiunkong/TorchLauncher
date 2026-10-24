import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_REPOSITORY = 'jiunkong/TorchLauncher';
const LIMIT = 2 * 1024 ** 3;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export async function releaseVersion(root) {
  const files = ['package.json', 'apps/launcher/package.json', 'apps/admin/package.json'];
  const versions = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(root, file), 'utf8')).version),
  );
  if (!STABLE_VERSION.test(versions[0]) || versions.some((version) => version !== versions[0]))
    throw new Error('Root, launcher and Studio must have the same stable x.y.z version.');
  return versions[0];
}
export function assetNames(version, platform) {
  if (!STABLE_VERSION.test(version) || !['windows', 'linux'].includes(platform))
    throw new Error('Invalid release version or platform.');
  const suffix = platform === 'windows' ? 'win-x64.exe' : 'linux-x64.AppImage';
  return [
    { app: 'launcher', name: `TorchLauncher-${version}-${suffix}` },
    { app: 'admin', name: `TorchLauncher Studio-${version}-${suffix}` },
  ];
}
export async function fileFacts(path, binary = false) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > LIMIT)
    throw new Error('Invalid release asset file.');
  if (binary) {
    const handle = await open(path, 'r');
    try {
      const header = Buffer.alloc(4);
      const { bytesRead } = await handle.read(header, 0, 4, 0);
      const valid = path.endsWith('.exe')
        ? header.subarray(0, 2).toString() === 'MZ'
        : header.toString('hex') === '7f454c46';
      if (bytesRead !== 4 || !valid) throw new Error('Invalid executable header.');
    } finally {
      await handle.close();
    }
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: stat.size, sha256: hash.digest('hex') };
}
export async function stageAssets(root, output, version, platform) {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Release staging directory must be empty.');
  for (const { app, name } of assetNames(version, platform)) {
    const source = join(root, 'apps', app, 'dist', name);
    await fileFacts(source, true);
    await copyFile(source, join(output, name), constants.COPYFILE_EXCL);
  }
}
export async function writeMetadata(directory, version, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a full release commit SHA.');
  const names = ['windows', 'linux']
    .flatMap((platform) => assetNames(version, platform).map((asset) => asset.name))
    .sort();
  const actual = (await readdir(directory)).sort();
  if (actual.join('\n') !== names.join('\n'))
    throw new Error('Expected exactly four Windows/Linux x64 release executables.');
  const assets = await Promise.all(
    names.map(async (name) => ({ name, ...(await fileFacts(join(directory, name), true)) })),
  );
  const metadata = { repository: RELEASE_REPOSITORY, version, tag: `v${version}`, commit, assets };
  // This is integrity metadata, not the signed updater manifest planned for RELEASE-02.
  await writeFile(
    join(directory, 'release-metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { flag: 'wx' },
  );
  await writeFile(
    join(directory, 'SHA256SUMS'),
    assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(''),
    { flag: 'wx' },
  );
  return metadata;
}
/** Read-only check. Existing tags/releases and API failures must never become overwrite attempts. */
export async function checkUnpublished(version, token, request = fetch) {
  if (!STABLE_VERSION.test(version) || !token)
    throw new Error('A stable version and GitHub token are required.');
  for (const resource of [`git/ref/tags/v${version}`, `releases/tags/v${version}`]) {
    const response = await request(
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/${resource}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'TorchLauncher-Release',
        },
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      },
    );
    await response.body?.cancel();
    if (response.status === 404) continue;
    if (response.ok)
      throw new Error(
        `v${version} already has a tag or release. Bump all three package versions; never overwrite published assets.`,
      );
    throw new Error(`GitHub preflight failed with HTTP ${response.status}.`);
  }
}
export async function verifyUploaded(directory, version, commit, remote) {
  if (
    remote.tag_name !== `v${version}` ||
    remote.target_commitish !== commit ||
    remote.draft !== true ||
    remote.prerelease !== false ||
    !Array.isArray(remote.assets)
  )
    throw new Error('Unexpected draft release identity.');
  const names = (await readdir(directory)).sort();
  if (remote.assets.length !== names.length) throw new Error('Uploaded asset count mismatch.');
  for (const name of names) {
    const expected = await fileFacts(join(directory, name));
    const found = remote.assets.filter((asset) => asset.name === name);
    if (
      found.length !== 1 ||
      found[0].state !== 'uploaded' ||
      found[0].size !== expected.size ||
      found[0].digest !== `sha256:${expected.sha256}`
    )
      throw new Error(`GitHub upload verification failed for ${name}.`);
  }
}
async function main() {
  const root = process.cwd();
  const version = await releaseVersion(root);
  const directory = join(root, '.cache/release-assets');
  switch (process.argv[2]) {
    case 'version': {
      const output = `version=${version}\ntag=v${version}\n`;
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
      process.stdout.write(output);
      return;
    }
    case 'preflight':
      await checkUnpublished(version, process.env.GH_TOKEN);
      return;
    case 'stage':
      await stageAssets(root, directory, version, process.argv[3]);
      return;
    case 'metadata':
      await writeMetadata(directory, version, process.env.GITHUB_SHA ?? '');
      return;
    case 'verify':
      await verifyUploaded(
        directory,
        version,
        process.env.GITHUB_SHA ?? '',
        JSON.parse(await readFile(join(root, '.cache/remote-release.json'), 'utf8')),
      );
      return;
    default:
      throw new Error(
        'Usage: node scripts/release.mjs version|preflight|stage <windows|linux>|metadata|verify',
      );
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
