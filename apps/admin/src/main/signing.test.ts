import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDeploymentReader } from '../../../../packages/core/src/deployment/reader/index.js';
import { deriveEd25519PublicKey } from '../../../../packages/core/src/deployment/signing/index.js';
import type { DownloadSource } from '../../../../packages/core/src/download/source/index.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import { createProjectAt } from './fixtures/projects.js';
import { readZip } from './fixtures/zip.js';
import { parseProject } from './project.js';
import { encodeProjectFile } from './project-file.js';
import { PROJECT_DATA_DIR, PROJECT_FILE_NAME } from './project-folder.js';
import { type SafeStorageLike, SigningKeyStore } from './signing.js';
import { type StudioDialogs, StudioService } from './studio.js';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'studio-sign-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const PASS = 'correct horse battery staple';
const FAST = { N: 2 ** 14 };

function fakeStorage(available = true): SafeStorageLike {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(text) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptString(buf) {
      const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
function dialogs() {
  return {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
  };
}
function memorySource(bytes: Buffer): DownloadSource {
  const snapshot = { totalLength: bytes.length, etag: '"t"', lastModified: null };
  return {
    kind: 'https',
    sourceId: 'p',
    generation: 0,
    snapshot,
    async getRange(range) {
      return {
        sourceId: 'p',
        sourceGeneration: 0,
        range,
        bytes: bytes.subarray(range.start, range.end + 1),
        snapshot,
      };
    },
    reset() {},
  };
}
async function setup(storage = fakeStorage()) {
  const root = await temp();
  const keysDir = join(root, 'user-data', 'signing-keys');
  const store = new SigningKeyStore(keysDir, storage, FAST);
  const d = dialogs();
  const s = new StudioService(d, undefined, undefined, store);
  const projDir = join(root, 'proj');
  await mkdir(projDir);
  await createProjectAt(s, d, projDir);
  const source = join(projDir, PROJECT_DATA_DIR);
  await writeFile(join(source, 'a.txt'), 'payload');
  d.open.mockResolvedValueOnce([join(source, 'a.txt')]);
  await s.request({ action: 'files' });
  return { root, keysDir, store, d, s, source, projDir };
}
async function build(ctx: Awaited<ReturnType<typeof setup>>, name: string) {
  const pack = join(ctx.root, name);
  ctx.d.save.mockResolvedValueOnce(pack);
  const reply = await ctx.s.request({ action: 'build' });
  return { reply, pack };
}
function rawSecrets(_store: SigningKeyStore, key: KeyObject) {
  const der = key.export({ format: 'der', type: 'pkcs8' });
  const seed = Buffer.from(key.export({ format: 'jwk' }).d as string, 'base64url');
  return [seed, der, ...[seed, der].flatMap((b) => [b.toString('hex'), b.toString('base64')])].map(
    (v) => (typeof v === 'string' ? Buffer.from(v) : v),
  );
}
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  if (!(await stat(dir)).isDirectory()) return [dir];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
async function expectNoSecrets(dirs: string[], secrets: Buffer[]) {
  for (const dir of dirs)
    for (const file of await walk(dir)) {
      const bytes = await readFile(file);
      for (const secret of secrets) expect(bytes.includes(secret), file).toBe(false);
    }
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'other',
  );

describe('SigningKeyStore', () => {
  it('creates, persists encrypted, loads, and refuses duplicates', async () => {
    const root = await temp();
    const store = new SigningKeyStore(join(root, 'k'), fakeStorage(), FAST);
    expect((await store.status('srv')).keyExists).toBe(false);
    const pub = await store.create('srv');
    const key = await store.load('srv');
    expect(deriveEd25519PublicKey(key)).toBe(pub);
    expect(await store.status('srv')).toMatchObject({ keyExists: true, publicKey: pub });
    expect(await code(store.create('srv'))).toBe('KEY_EXISTS');
    await expectNoSecrets([join(root, 'k')], rawSecrets(store, key));
    expect((await readdir(join(root, 'k'))).every((n) => n.endsWith('.json'))).toBe(true);
    if (process.platform !== 'win32')
      for (const f of await readdir(join(root, 'k')))
        expect((await stat(join(root, 'k', f))).mode & 0o077).toBe(0);
  });
  it('refuses to create or sign without encryption and never writes plaintext', async () => {
    const root = await temp();
    const store = new SigningKeyStore(join(root, 'k'), fakeStorage(false), FAST);
    expect(await code(store.create('srv'))).toBe('ENCRYPTION_UNAVAILABLE');
    await expect(readdir(join(root, 'k'))).rejects.toThrow();
    const linuxWeak = { ...fakeStorage(), getSelectedStorageBackend: () => 'basic_text' };
    expect(await code(new SigningKeyStore(join(root, 'k2'), linuxWeak).create('s'))).toBe(
      'ENCRYPTION_UNAVAILABLE',
    );
    const throwing = {
      ...fakeStorage(),
      encryptString: (): Buffer => {
        throw new Error('no');
      },
    };
    expect(await code(new SigningKeyStore(join(root, 'k3'), throwing).create('s'))).toBe(
      'ENCRYPTION_UNAVAILABLE',
    );
    const good = fakeStorage();
    const real = new SigningKeyStore(join(root, 'k4'), good, FAST);
    await real.create('s');
    const later = new SigningKeyStore(join(root, 'k4'), fakeStorage(false), FAST);
    expect(await code(later.load('s'))).toBe('ENCRYPTION_UNAVAILABLE');
  });
  it('rejects corrupt or foreign key files and stores separate keys per server', async () => {
    const root = await temp();
    const dir = join(root, 'k');
    const store = new SigningKeyStore(dir, fakeStorage(), FAST);
    const a = await store.create('a');
    const b = await store.create('b');
    expect(a).not.toBe(b);
    const [file] = (await readdir(dir)).filter((n) => n.endsWith('.json'));
    if (!file) throw new Error('missing');
    const path = join(dir, file);
    const text = await readFile(path, 'utf8');
    for (const bad of [
      '{',
      text.replace('"version": 1', '"version": 2'),
      text.replace('{', '{"extra":1,'),
      text.replace(/"sequence": 0/, '"sequence": -1'),
      text.replace(/"publicKey": "[^"]+"/, '"publicKey": "AAAA"'),
    ]) {
      await writeFile(path, bad);
      expect((await code(store.status('a'))) ?? (await code(store.status('b')))).toBe(
        'KEY_CORRUPT',
      );
    }
    // swapping the encrypted blob between servers is detected through the public key
    await writeFile(path, text);
    const [x, y] = await Promise.all(
      (await readdir(dir)).map((n) => readFile(join(dir, n), 'utf8')),
    );
    const names = await readdir(dir);
    const swap = JSON.parse(x as string);
    swap.encryptedPrivateKey = JSON.parse(y as string).encryptedPrivateKey;
    await writeFile(join(dir, names[0] as string), JSON.stringify(swap));
    const ids = await Promise.all(
      ['a', 'b'].map((id) => code(store.load(id)).then((c) => [id, c] as const)),
    );
    expect(ids.some(([, c]) => c === 'KEY_CORRUPT')).toBe(true);
  });
});

describe('signing key backup', () => {
  async function pair() {
    const root = await temp();
    const a = new SigningKeyStore(join(root, 'a'), fakeStorage(), FAST);
    const b = new SigningKeyStore(join(root, 'b'), fakeStorage(), FAST);
    return { root, a, b };
  }
  it('round trips to another machine with the same public key and no plaintext', async () => {
    const { root, a, b } = await pair();
    const pub = await a.create('srv');
    const text = await a.exportBackup('srv', PASS);
    expect(JSON.parse(text)).toMatchObject({ format: 'torchlauncher-signing-backup', version: 1 });
    await writeFile(join(root, 'backup.torchkey'), text);
    expect(await b.importBackup('srv', Buffer.from(text), PASS)).toEqual({
      publicKey: pub,
      replaced: false,
    });
    expect(deriveEd25519PublicKey(await b.load('srv'))).toBe(pub);
    for (const secret of rawSecrets(a, await a.load('srv')))
      expect(Buffer.from(text).includes(secret)).toBe(false);
    // idempotent restore of the same key
    expect((await b.importBackup('srv', Buffer.from(text), PASS)).replaced).toBe(false);
  });
  it('uses random salt and nonce, and the default scrypt cost is bounded', async () => {
    const { a } = await pair();
    await a.create('srv');
    const [x, y] = [await a.exportBackup('srv', PASS), await a.exportBackup('srv', PASS)];
    expect(JSON.parse(x).kdf.salt).not.toBe(JSON.parse(y).kdf.salt);
    expect(JSON.parse(x).cipher.nonce).not.toBe(JSON.parse(y).cipher.nonce);
    const strong = new SigningKeyStore(`${await temp()}/s`, fakeStorage());
    await strong.create('srv');
    expect(JSON.parse(await strong.exportBackup('srv', PASS)).kdf.N).toBe(2 ** 17);
  });
  it('gives typed errors for wrong passphrase, tampering, bounds and versions', async () => {
    const { a, b } = await pair();
    await a.create('srv');
    const text = await a.exportBackup('srv', PASS);
    const doc = JSON.parse(text);
    const imp = (o: unknown, pass = PASS, id = 'srv') =>
      code(b.importBackup(id, Buffer.from(JSON.stringify(o)), pass));
    expect(await imp(doc, 'another long passphrase')).toBe('BACKUP_AUTH');
    expect(await imp(doc, 'short')).toBe('WEAK_PASSPHRASE');
    expect(await imp(doc, 'x'.repeat(300))).toBe('WEAK_PASSPHRASE');
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      buf[0] = (buf[0] ?? 0) ^ 1;
      return buf.toString('base64');
    };
    expect(await imp({ ...doc, ciphertext: flip(doc.ciphertext) })).toBe('BACKUP_AUTH');
    expect(await imp({ ...doc, tag: flip(doc.tag) })).toBe('BACKUP_AUTH');
    expect(await imp({ ...doc, cipher: { ...doc.cipher, nonce: flip(doc.cipher.nonce) } })).toBe(
      'BACKUP_AUTH',
    );
    expect(await imp({ ...doc, kdf: { ...doc.kdf, salt: flip(doc.kdf.salt) } })).toBe(
      'BACKUP_AUTH',
    );
    expect(await imp({ ...doc, kdf: { ...doc.kdf, p: 2 } })).toBe('BACKUP_AUTH');
    // header substitution (public key / server) is authenticated or rejected
    const other = await pair();
    const otherPub = await other.a.create('srv');
    expect(await imp({ ...doc, publicKey: otherPub })).toBe('BACKUP_AUTH');
    expect(await imp(doc, PASS, 'different-server')).toBe('KEY_MISMATCH');
    expect(await imp({ ...doc, version: 2 })).toBe('BACKUP_UNSUPPORTED');
    expect(await imp({ ...doc, version: 0 })).toBe('BACKUP_UNSUPPORTED');
    expect(await imp({ ...doc, format: 'x' })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, extra: 1 })).toBe('BACKUP_INVALID');
    for (const N of [2 ** 13, 2 ** 21, 2 ** 15 + 1, 1.5, '16384'])
      expect(await imp({ ...doc, kdf: { ...doc.kdf, N } })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, kdf: { ...doc.kdf, r: 16 } })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, kdf: { ...doc.kdf, p: 0 } })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, kdf: { ...doc.kdf, p: 5 } })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, kdf: { ...doc.kdf, name: 'pbkdf2' } })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, ciphertext: doc.ciphertext.slice(4) })).toBe('BACKUP_INVALID');
    expect(await imp({ ...doc, kdf: { ...doc.kdf, salt: 'AA' } })).toBe('BACKUP_INVALID');
    expect(await code(b.importBackup('srv', Buffer.from('not json'), PASS))).toBe('BACKUP_INVALID');
    expect(await code(b.importBackup('srv', Buffer.alloc(20_000), PASS))).toBe('BACKUP_INVALID');
    expect((await b.status('srv')).keyExists).toBe(false);
    // errors carry no key material or passphrase
    try {
      await b.importBackup('srv', Buffer.from(text), 'another long passphrase');
    } catch (error) {
      expect(String((error as Error).message + (error as Error).stack)).not.toContain(
        'another long',
      );
    }
  });
  it('refuses to overwrite a different key unless told to replace', async () => {
    const { a, b } = await pair();
    const original = await a.create('srv');
    const mine = await b.create('srv');
    const text = Buffer.from(await a.exportBackup('srv', PASS));
    expect(await code(b.importBackup('srv', text, PASS))).toBe('KEY_EXISTS');
    expect((await b.status('srv')).publicKey).toBe(mine);
    expect(await b.importBackup('srv', text, PASS, { replace: true })).toEqual({
      publicKey: original,
      replaced: true,
    });
    expect((await b.status('srv')).publicKey).toBe(original);
  });
});

describe('Studio signing integration', () => {
  it('auto-creates a key on first build, signs 1.2 and verifies only with the derived key', async () => {
    const ctx = await setup();
    const { reply, pack } = await build(ctx, 'one.torchpack');
    expect(reply.ok).toBe(true);
    const state = ctx.s.snapshot();
    const status = await ctx.store.status(state.project?.serverId as string);
    expect(state.signing).toMatchObject({
      keyExists: true,
      publicKey: status.publicKey,
      lastOperation: { keyCreated: true, sequence: 1 },
    });
    expect(state.project?.sequence).toBe(1);
    expect(state.result).toMatchObject({ key: 'packCreated', sequence: 1, signed: true });
    const bytes = await readFile(pack);
    const serverId = state.project?.serverId as string;
    const reader = await openDeploymentReader(memorySource(bytes), {
      expectedServerId: serverId,
      trustedPublicKey: status.publicKey as string,
    });
    expect(reader.verification).toBe('verified');
    expect(reader.index.sequence).toBe(1);
    expect(() =>
      parseProject({
        ...state.project,
        lastBuild: { ...state.project?.lastBuild, sequence: null },
      }),
    ).toThrow();
    expect(reader.header.formatVersion).toEqual({ major: 1, minor: 2 });
    const wrong = generateKeyPairSync('ed25519').privateKey;
    await expect(
      openDeploymentReader(memorySource(bytes), {
        expectedServerId: serverId,
        trustedPublicKey: deriveEd25519PublicKey(wrong),
      }),
    ).rejects.toMatchObject({ code: 'signature-invalid' });
  });
  it('increments the sequence per build, never decreasing after deletions, resets or failures', async () => {
    const ctx = await setup();
    const sequences: number[] = [];
    const serverId = ctx.s.snapshot().project?.serverId as string;
    const read = async (pack: string) =>
      (
        await openDeploymentReader(memorySource(await readFile(pack)), {
          expectedServerId: serverId,
        })
      ).index.sequence as number;
    const a = await build(ctx, 'a.torchpack');
    sequences.push(await read(a.pack));
    await rm(a.pack);
    const b = await build(ctx, 'b.torchpack');
    sequences.push(await read(b.pack));
    // failed build (output directory missing) burns a number but never reuses one
    ctx.d.save.mockResolvedValueOnce(join(ctx.root, 'missing-dir', 'x.torchpack'));
    expect((await ctx.s.request({ action: 'build' })).ok).toBe(false);
    const c = await build(ctx, 'c.torchpack');
    sequences.push(await read(c.pack));
    expect(sequences[0]).toBe(1);
    expect(sequences[1]).toBe(2);
    expect(sequences[2]).toBeGreaterThan(2);
    // project file without sequence (copy to another folder / deleted state): key store keeps the max
    const project = parseProject(ctx.s.snapshot().project);
    delete project.sequence;
    const fresh = new StudioService(dialogs(), undefined, undefined, ctx.store);
    const path = join(ctx.projDir, PROJECT_FILE_NAME);
    await writeFile(path, encodeProjectFile(project, {}));
    const fd = dialogs();
    const f2 = new StudioService(fd, undefined, undefined, ctx.store);
    fd.open.mockResolvedValueOnce([ctx.projDir]);
    await f2.request({ action: 'open', discard: true });
    const d = join(ctx.root, 'd.torchpack');
    fd.save.mockResolvedValueOnce(d);
    await f2.request({ action: 'build' });
    expect(await read(d)).toBeGreaterThan(sequences[2] as number);
    // a project carrying a higher sequence than the key store (restored key on a new machine)
    const high = { ...project, sequence: 500 };
    await writeFile(path, encodeProjectFile(high, {}));
    fd.open.mockResolvedValueOnce([ctx.projDir]);
    await f2.request({ action: 'open', discard: true });
    const e = join(ctx.root, 'e.torchpack');
    fd.save.mockResolvedValueOnce(e);
    await f2.request({ action: 'build' });
    expect(await read(e)).toBe(501);
    expect(fresh.snapshot().project).toBeNull();
    // the renderer cannot rewind the sequence through update
    const current = parseProject(f2.snapshot().project);
    expect(await f2.request({ action: 'update', project: { ...current, sequence: 1 } })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  });
  it('blocks the build when encryption is unavailable and writes nothing', async () => {
    const ctx = await setup(fakeStorage(false));
    const { reply, pack } = await build(ctx, 'x.torchpack');
    expect(reply).toEqual({ ok: false, code: 'ENCRYPTION_UNAVAILABLE' });
    await expect(stat(pack)).rejects.toThrow();
    expect(ctx.s.snapshot().project?.sequence).toBeUndefined();
  });
  it('keeps private key material out of project, deploy output and reply state', async () => {
    const ctx = await setup();
    const { pack } = await build(ctx, 'o.torchpack');
    await ctx.s.request({ action: 'save' });
    const projectPath = join(ctx.projDir, PROJECT_FILE_NAME);
    const serverId = ctx.s.snapshot().project?.serverId as string;
    const secrets = rawSecrets(ctx.store, await ctx.store.load(serverId));
    const files = [pack, projectPath, ...(await walk(ctx.source)), ...(await walk(ctx.keysDir))];
    for (const f of files) {
      const bytes = await readFile(f);
      for (const secret of secrets) expect(bytes.includes(secret), f).toBe(false);
    }
    const snapshot = JSON.stringify(ctx.s.snapshot());
    for (const secret of secrets) expect(snapshot).not.toContain(secret.toString('latin1'));
    expect(snapshot).not.toContain((secrets[1] as Buffer).toString('base64'));
  });
  it('exports only a verified current deployment using the project key', async () => {
    const ctx = await setup();
    const { reply, pack } = await build(ctx, 'signed.torchpack');
    expect(reply.ok).toBe(true);
    const bytes = await readFile(pack);
    const d = dialogs();
    let remote = bytes;
    const service = new StudioService(
      d,
      () => memorySource(remote),
      undefined,
      ctx.store,
      null,
      async () => join(ctx.root, 'Torch.exe'),
    );
    const project = parseProject(ctx.s.snapshot().project);
    project.sourceUrl = 'https://example.org/pack';
    await writeFile(join(ctx.projDir, PROJECT_FILE_NAME), encodeProjectFile(project, {}));
    d.open.mockResolvedValueOnce([ctx.projDir]);
    expect((await service.request({ action: 'open' })).ok).toBe(true);
    const binary = join(ctx.root, 'Torch.exe');
    await writeFile(binary, 'MZ fixture');
    const out = join(ctx.root, 'out.zip');
    d.save.mockResolvedValueOnce(out);
    expect((await service.request({ action: 'export' })).ok).toBe(true);
    const cfg = parseServerConfig(
      JSON.parse(
        readZip(await readFile(out))
          .get('torchlauncher-server.json')
          ?.data.toString('utf8') ?? '',
      ),
    );
    expect(cfg.signing.publicKey).toBe((await ctx.store.status(project.serverId)).publicKey);
    expect(service.snapshot().signing?.lastOperation?.keyCreated).toBe(false);
    await expectNoSecrets([out], rawSecrets(ctx.store, await ctx.store.load(project.serverId)));
    remote = Buffer.from(bytes);
    remote[64] = (remote[64] ?? 0) ^ 1;
    expect((await service.request({ action: 'check' })).ok).toBe(false);
    expect((await service.request({ action: 'export' })).ok).toBe(false);
    for (const minor of [0, 1]) {
      remote = Buffer.from(bytes);
      remote.writeUInt16LE(minor, 10);
      expect((await service.request({ action: 'export' })).ok).toBe(false);
    }
  });
  it('validates key commands and drives create/export/import through the service', async () => {
    const ctx = await setup();
    const bad = [
      { action: 'keyExport' },
      { action: 'keyExport', passphrase: 1 },
      { action: 'keyImport', passphrase: PASS },
      { action: 'keyImport', passphrase: PASS, replace: 'yes' },
      { action: 'keyCreate', path: '/x' },
    ];
    for (const b of bad) expect(await ctx.s.request(b)).toEqual({ ok: false, code: 'INVALID' });
    expect((await ctx.s.request({ action: 'keyCreate' })).ok).toBe(true);
    expect(await ctx.s.request({ action: 'keyCreate' })).toEqual({ ok: false, code: 'KEY_EXISTS' });
    const backup = join(ctx.root, 'k.torchkey');
    ctx.d.save.mockResolvedValueOnce(backup);
    const reply = await ctx.s.request({ action: 'keyExport', passphrase: PASS });
    expect(reply.ok).toBe(true);
    expect(JSON.stringify(reply)).not.toContain(PASS);
    const project = parseProject(ctx.s.snapshot().project);
    const pub = (await ctx.store.status(project.serverId)).publicKey;
    // restore on a second machine that opens the same project
    const store2 = new SigningKeyStore(join(ctx.root, 'm2'), fakeStorage(), FAST);
    const d2 = dialogs();
    const s2 = new StudioService(d2, undefined, undefined, store2);
    d2.open.mockResolvedValueOnce([ctx.projDir]);
    await s2.request({ action: 'open', discard: true });
    d2.open.mockResolvedValueOnce([backup]);
    expect(
      await s2.request({ action: 'keyImport', passphrase: 'wrong passphrase!!', replace: false }),
    ).toEqual({ ok: false, code: 'BACKUP_AUTH' });
    d2.open.mockResolvedValueOnce([backup]);
    const ok = await s2.request({ action: 'keyImport', passphrase: PASS, replace: false });
    expect(ok.ok && ok.state.signing).toMatchObject({ keyExists: true, publicKey: pub });
    // another project cannot use this backup
    const d4 = dialogs();
    const s4 = new StudioService(d4, undefined, undefined, store2);
    const projDir4 = join(ctx.root, 'proj4');
    await mkdir(projDir4);
    await createProjectAt(s4, d4, projDir4);
    d4.open.mockResolvedValueOnce([backup]);
    expect(await s4.request({ action: 'keyImport', passphrase: PASS, replace: false })).toEqual({
      ok: false,
      code: 'KEY_MISMATCH',
    });
  });
});
