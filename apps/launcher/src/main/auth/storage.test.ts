import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptedMicrosoftTokenStorage, type SafeStorageBoundary } from './storage';

const key = 'torchlauncher.microsoft.11111111-2222-4333-8444-555555555555';
const anotherKey = 'torchlauncher.microsoft.11111111-2222-4333-8444-666666666666';
const value = { version: 1 as const, refreshToken: 'synthetic-refresh-value' };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'torch-auth-storage-test-'));
  directories.push(root);
  const directory = join(root, 'accounts');
  const encryptionKey = randomBytes(32);
  // Independent authenticated cipher for tests; actual Electron safeStorage is exercised by the harness.
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: vi.fn((plainText: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    }),
    decryptString: vi.fn((encrypted: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey, encrypted.subarray(0, 12), {
        authTagLength: 16,
      });
      cipher.setAuthTag(encrypted.subarray(12, 28));
      return Buffer.concat([cipher.update(encrypted.subarray(28)), cipher.final()]).toString(
        'utf8',
      );
    }),
  };
  const storage = new EncryptedMicrosoftTokenStorage({ directory, safeStorage, platform: 'linux' });
  const path = (account = key) =>
    join(directory, `${createHash('sha256').update(account).digest('hex')}.bin`);
  return { root, directory, safeStorage, storage, path };
}

describe('OS encrypted token storage', () => {
  it('stores only private ciphertext, reads it in a new instance, and clears only the selected account', async () => {
    const ctx = await setup();
    expect(await ctx.storage.read(key)).toBeNull();
    await ctx.storage.write(key, value);
    await ctx.storage.write(anotherKey, { version: 1, refreshToken: 'another-synthetic-refresh' });
    const encrypted = await readFile(ctx.path());
    expect(encrypted.includes(Buffer.from(value.refreshToken))).toBe(false);
    expect(encrypted.includes(Buffer.from(key))).toBe(false);
    expect((await stat(ctx.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(ctx.path())).mode & 0o777).toBe(0o600);
    const restarted = new EncryptedMicrosoftTokenStorage({
      directory: ctx.directory,
      safeStorage: ctx.safeStorage,
      platform: 'linux',
    });
    expect(await restarted.read(key)).toEqual(value);
    await restarted.clear(key);
    expect(await restarted.read(key)).toBeNull();
    expect(await restarted.read(anotherKey)).toEqual({
      version: 1,
      refreshToken: 'another-synthetic-refresh',
    });
    await restarted.clear(key);
  });

  it.each(['basic_text', 'unknown', '', 'unrecognized-future-backend'])(
    'rejects insecure/unknown Linux backend %s before any filesystem write',
    async (backend) => {
      const ctx = await setup();
      ctx.safeStorage.getSelectedStorageBackend.mockReturnValue(backend);
      await expect(ctx.storage.write(key, value)).rejects.toMatchObject({
        code: 'secure_storage_unavailable',
      });
      await expect(ctx.storage.read(key)).rejects.toMatchObject({
        code: 'secure_storage_unavailable',
      });
      expect(ctx.safeStorage.encryptString).not.toHaveBeenCalled();
      await expect(stat(ctx.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    'supports known secure Linux backend %s',
    async (backend) => {
      const ctx = await setup();
      ctx.safeStorage.getSelectedStorageBackend.mockReturnValue(backend);
      await ctx.storage.write(key, value);
      expect(await ctx.storage.read(key)).toEqual(value);
    },
  );

  it.each(['win32', 'darwin'] as const)(
    'does not query the Linux backend on %s',
    async (platform) => {
      const ctx = await setup();
      ctx.safeStorage.getSelectedStorageBackend.mockImplementation(() => {
        throw new Error();
      });
      const storage = new EncryptedMicrosoftTokenStorage({
        directory: ctx.directory,
        safeStorage: ctx.safeStorage,
        platform,
      });
      await storage.write(key, value);
      expect(await storage.read(key)).toEqual(value);
      expect(ctx.safeStorage.getSelectedStorageBackend).not.toHaveBeenCalled();
    },
  );

  it('fails closed when OS encryption is unavailable or backend lookup throws', async () => {
    const ctx = await setup();
    ctx.safeStorage.isEncryptionAvailable.mockReturnValueOnce(false);
    await expect(ctx.storage.write(key, value)).rejects.toMatchObject({
      code: 'secure_storage_unavailable',
    });
    ctx.safeStorage.getSelectedStorageBackend.mockImplementationOnce(() => {
      throw new Error('private OS failure');
    });
    expect(() => ctx.storage.assertSecureBackend()).toThrow('secure_storage_unavailable');
  });

  it('preserves the old token and removes temporary ciphertext if encryption becomes unavailable before rename', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    const before = await readFile(ctx.path());
    ctx.safeStorage.isEncryptionAvailable
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await expect(
      ctx.storage.write(key, { version: 1, refreshToken: 'new-synthetic' }),
    ).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
    expect(await readFile(ctx.path())).toEqual(before);
    expect(await readdir(ctx.directory)).toEqual([
      `${createHash('sha256').update(key).digest('hex')}.bin`,
    ]);
    expect(await ctx.storage.read(key)).toEqual(value);
  });

  it('preserves previous credentials on encryption failure and redacts the failure', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    ctx.safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error('private credential');
    });
    const error = await ctx.storage
      .write(key, { version: 1, refreshToken: 'new' })
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'storage_failed' });
    expect(String(error)).not.toContain('private');
    expect(error).not.toHaveProperty('cause');
    expect(await ctx.storage.read(key)).toEqual(value);
  });

  it('allows logout cleanup when the OS keyring is unavailable', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    ctx.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await ctx.storage.clear(key);
    await expect(stat(ctx.path())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes concurrent writes/read/clear in invocation order', async () => {
    const ctx = await setup();
    const first = ctx.storage.write(key, value);
    const second = ctx.storage.write(key, { version: 1, refreshToken: 'rotated' });
    const read = ctx.storage.read(key);
    const clear = ctx.storage.clear(key);
    await Promise.all([first, second, clear]);
    expect(await read).toEqual({ version: 1, refreshToken: 'rotated' });
    expect(await ctx.storage.read(key)).toBeNull();
  });

  it.each(['../../outside', 'torchlauncher.microsoft.../outside', '', 'another-app'])(
    'rejects unscoped storage key %j',
    async (invalid) => {
      const ctx = await setup();
      await expect(ctx.storage.write(invalid, value)).rejects.toMatchObject({
        code: 'storage_failed',
      });
      await expect(ctx.storage.clear(invalid)).rejects.toMatchObject({ code: 'storage_failed' });
      expect(await readdir(ctx.root)).toEqual([]);
    },
  );

  it('binds the ciphertext to its account key', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    await ctx.storage.write(anotherKey, value);
    await copyFile(ctx.path(), ctx.path(anotherKey));
    await expect(ctx.storage.read(anotherKey)).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await ctx.storage.read(key)).toEqual(value);
  });

  it.each([Buffer.from('plaintext is never accepted'), Buffer.alloc(300_000), Buffer.alloc(0)])(
    'rejects corrupt/oversized ciphertext',
    async (bytes) => {
      const ctx = await setup();
      await mkdir(ctx.directory, { mode: 0o700 });
      await writeFile(ctx.path(), bytes, { mode: 0o600 });
      await expect(ctx.storage.read(key)).rejects.toMatchObject({ code: 'storage_failed' });
      expect(await readFile(ctx.path())).toEqual(bytes);
    },
  );

  it('rejects malformed decrypted data without leaking plaintext', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    ctx.safeStorage.decryptString.mockReturnValueOnce('private, invalid JSON');
    const error = await ctx.storage.read(key).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'storage_failed' });
    expect(String(error)).not.toContain('private');
  });

  it('rejects a symlinked account directory', async () => {
    const ctx = await setup();
    const outside = join(ctx.root, 'outside');
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, ctx.directory);
    await expect(ctx.storage.write(key, value)).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await readdir(outside)).toEqual([]);
  });

  it.each(['symlink', 'hardlink'])(
    'rejects a %s credential file before read/write/clear',
    async (type) => {
      const ctx = await setup();
      await mkdir(ctx.directory, { mode: 0o700 });
      const outside = join(ctx.root, 'outside');
      await writeFile(outside, 'outside-data', { mode: 0o600 });
      if (type === 'symlink') await symlink(outside, ctx.path());
      else await link(outside, ctx.path());
      await expect(ctx.storage.read(key)).rejects.toMatchObject({ code: 'storage_failed' });
      await expect(ctx.storage.write(key, value)).rejects.toMatchObject({ code: 'storage_failed' });
      await expect(ctx.storage.clear(key)).rejects.toMatchObject({ code: 'storage_failed' });
      expect(await readFile(outside, 'utf8')).toBe('outside-data');
    },
  );

  it('rejects permissive directories/files instead of silently accepting them', async () => {
    const ctx = await setup();
    await ctx.storage.write(key, value);
    await chmod(ctx.path(), 0o644);
    await expect(ctx.storage.read(key)).rejects.toMatchObject({ code: 'storage_failed' });
    await chmod(ctx.directory, 0o755);
    await expect(ctx.storage.write(key, value)).rejects.toMatchObject({ code: 'storage_failed' });
  });

  it('requires a trusted absolute directory', () => {
    expect(
      () =>
        new EncryptedMicrosoftTokenStorage({
          directory: 'relative',
          safeStorage: {} as SafeStorageBoundary,
        }),
    ).toThrow('invalid_configuration');
  });
});
