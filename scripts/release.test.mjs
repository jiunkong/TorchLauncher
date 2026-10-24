import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  assetNames,
  checkUnpublished,
  fileFacts,
  releaseVersion,
  stageAssets,
  verifyUploaded,
  writeMetadata,
} from './release.mjs';

const roots = [];
const version = '0.1.0';
const commit = 'a'.repeat(40);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'torch-release-'));
  roots.push(root);
  for (const app of ['', 'apps/launcher', 'apps/admin']) {
    await mkdir(join(root, app), { recursive: true });
    await writeFile(join(root, app, 'package.json'), JSON.stringify({ version }));
  }
  for (const platform of ['windows', 'linux']) {
    for (const { app, name } of assetNames(version, platform)) {
      const file = join(root, 'apps', app, 'dist', name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        platform === 'windows' ? 'MZ00 fixture' : Buffer.from('\x7fELF fixture'),
      );
    }
  }
  const output = join(root, 'release-assets');
  await mkdir(output);
  return { root, output };
}
async function assembled() {
  const h = await fixture();
  for (const platform of ['windows', 'linux']) {
    for (const { app, name } of assetNames(version, platform)) {
      await writeFile(
        join(h.output, name),
        await readFile(join(h.root, 'apps', app, 'dist', name)),
      );
    }
  }
  return h;
}
test('requires matching stable versions in the root and both apps', async () => {
  const h = await fixture();
  assert.equal(await releaseVersion(h.root), version);
  await writeFile(join(h.root, 'apps/admin/package.json'), JSON.stringify({ version: '0.2.0' }));
  await assert.rejects(releaseVersion(h.root), /same stable/);
  for (const path of ['package.json', 'apps/launcher/package.json', 'apps/admin/package.json'])
    await writeFile(join(h.root, path), JSON.stringify({ version: '0.2.0-beta.1' }));
  await assert.rejects(releaseVersion(h.root), /same stable/);
});
for (const platform of ['windows', 'linux']) {
  test(`stages only the two expected ${platform} x64 binaries, including the Studio name with spaces`, async () => {
    const h = await fixture();
    await writeFile(join(h.root, 'apps/launcher/dist/private.env'), 'must never be uploaded');
    await stageAssets(h.root, h.output, version, platform);
    assert.deepEqual(
      (await readdir(h.output)).sort(),
      assetNames(version, platform)
        .map((asset) => asset.name)
        .sort(),
    );
    await assert.rejects(stageAssets(h.root, h.output, version, platform), /must be empty/);
  });
}
test('rejects missing target artifacts and bad executable headers', async () => {
  const h = await fixture();
  const artifact = assetNames(version, 'windows')[0];
  const path = join(h.root, 'apps', artifact.app, 'dist', artifact.name);
  await writeFile(path, 'not an executable');
  await assert.rejects(stageAssets(h.root, h.output, version, 'windows'), /executable header/);
  assert.deepEqual(await readdir(h.output), []);
  await rm(path);
  await assert.rejects(stageAssets(h.root, h.output, version, 'windows'), { code: 'ENOENT' });
});
test('refuses invalid platforms and unstable version names', () => {
  assert.throws(() => assetNames(version, 'macos'), /Invalid/);
  assert.throws(() => assetNames('../unsafe', 'windows'), /Invalid/);
});
test('produces checksums and commit metadata only for the complete four-asset set', async () => {
  const h = await assembled();
  const metadata = await writeMetadata(h.output, version, commit);
  assert.equal(metadata.commit, commit);
  assert.equal(metadata.assets.length, 4);
  for (const asset of metadata.assets) {
    const data = await readFile(join(h.output, asset.name));
    assert.equal(asset.sha256, createHash('sha256').update(data).digest('hex'));
    assert.equal(asset.size, data.length);
    assert.ok(
      (await readFile(join(h.output, 'SHA256SUMS'), 'utf8')).includes(
        `${asset.sha256}  ${asset.name}\n`,
      ),
    );
  }
  await assert.rejects(writeMetadata(h.output, version, commit), /exactly four/);
});
test('refuses incomplete or unexpected assets before writing metadata', async () => {
  const h = await assembled();
  await writeFile(join(h.output, 'extra-secret.txt'), 'private');
  await assert.rejects(writeMetadata(h.output, version, commit), /exactly four/);
  await rm(join(h.output, 'extra-secret.txt'));
  await rm(join(h.output, assetNames(version, 'linux')[0].name));
  await assert.rejects(writeMetadata(h.output, version, commit), /exactly four/);
  await assert.rejects(writeMetadata(h.output, version, 'release'), /full release commit/);
});
test('verifies GitHub asset digests, lengths and draft identity before publication', async () => {
  const h = await assembled();
  await writeMetadata(h.output, version, commit);
  const assets = await Promise.all(
    (await readdir(h.output)).map(async (name) => {
      const facts = await fileFacts(join(h.output, name));
      return { name, size: facts.size, digest: `sha256:${facts.sha256}`, state: 'uploaded' };
    }),
  );
  const remote = {
    tag_name: `v${version}`,
    target_commitish: commit,
    draft: true,
    prerelease: false,
    assets,
  };
  await verifyUploaded(h.output, version, commit, remote);
  const bad = structuredClone(remote);
  bad.assets[0].digest = 'sha256:wrong';
  await assert.rejects(verifyUploaded(h.output, version, commit, bad), /upload verification/);
  await assert.rejects(
    verifyUploaded(h.output, version, commit, { ...remote, draft: false }),
    /draft release identity/,
  );
  await assert.rejects(
    verifyUploaded(h.output, version, commit, { ...remote, target_commitish: 'b'.repeat(40) }),
    /draft release identity/,
  );
  await assert.rejects(
    verifyUploaded(h.output, version, commit, { ...remote, assets: assets.slice(1) }),
    /count mismatch/,
  );
});
test('preflight permits only absent tag and release, with no mutating HTTP calls', async () => {
  const urls = [];
  await checkUnpublished(version, 'test-token', async (url, options) => {
    urls.push(url);
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(urls, [
    'https://api.github.com/repos/jiunkong/TorchLauncher/git/ref/tags/v0.1.0',
    'https://api.github.com/repos/jiunkong/TorchLauncher/releases/tags/v0.1.0',
  ]);
  for (const status of [200, 403, 429, 500]) {
    await assert.rejects(
      checkUnpublished(version, 'test-token', async () => new Response(null, { status })),
      /already has|preflight failed/,
    );
  }
  let count = 0;
  await assert.rejects(
    checkUnpublished(
      version,
      'test-token',
      async () => new Response(null, { status: count++ ? 200 : 404 }),
    ),
    /already has/,
  );
});
test('does not interpret offline or missing credentials as permission to publish', async () => {
  await assert.rejects(
    checkUnpublished(version, '', async () => {
      throw new Error('must not call');
    }),
    /token are required/,
  );
  await assert.rejects(
    checkUnpublished(version, 'test-token', async () => {
      throw new TypeError('offline');
    }),
    /offline/,
  );
});
test('refuses symlinked release inputs', { skip: process.platform === 'win32' }, async () => {
  const h = await fixture();
  const path = join(h.root, 'file.exe');
  await symlink(join(h.root, 'package.json'), path);
  await assert.rejects(fileFacts(path), /Invalid release asset/);
});
