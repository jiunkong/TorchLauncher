import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptedPublicJavaCache } from './public-java-cache';
import { snapshot } from './public-java-protocol';
import type { SafeStorageBoundary } from './storage';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'torch-public-java-cache-'));
  directories.push(directory);
  const key = randomBytes(32);
  // Synthetic encryption boundary. This does not claim a live OS keychain check.
  const safeStorage: SafeStorageBoundary = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
  const options = { directory, safeStorage };
  return {
    directory,
    safeStorage,
    store: new EncryptedPublicJavaCache(options),
    restart: () => new EncryptedPublicJavaCache(options),
  };
}

describe('public Java encrypted cache', () => {
  it('encrypts every library cache and reloads/clears in a new instance', async () => {
    const ctx = await setup();
    const value = {
      version: 1 as const,
      caches: {
        sisu: { token: { refresh_token: 'synthetic-secret-refresh' } },
        xbl: { proof: 'synthetic-private-key', deviceToken: 'synthetic-secret-device' },
        mca: { access_token: 'synthetic-secret-access' },
      },
    };
    await ctx.store.write(value);
    const [name] = await readdir(ctx.directory);
    if (!name) throw new Error('Missing encrypted test cache');
    const content = await readFile(join(ctx.directory, name));
    expect(content.toString()).not.toContain('synthetic-secret');
    expect(content.toString()).not.toContain('synthetic-private-key');
    expect(await ctx.restart().read()).toEqual(value);
    await ctx.restart().clear();
    expect(await ctx.restart().read()).toBeNull();
  });

  it('fails closed for insecure OS storage without creating a plaintext cache', async () => {
    const ctx = await setup();
    ctx.safeStorage.isEncryptionAvailable = () => false;
    await expect(ctx.store.write({ version: 1, caches: {} })).rejects.toMatchObject({
      code: 'secure_storage_unavailable',
    });
    expect(await readdir(ctx.directory)).toEqual([]);
  });

  it('rejects unknown/oversized cache payloads without replacing the previous encrypted session', async () => {
    const ctx = await setup();
    const initial = { version: 1 as const, caches: { sisu: { token: 'synthetic-previous' } } };
    await ctx.store.write(initial);
    expect(() => snapshot({ version: 1, caches: { unknown: {} } })).toThrow();
    await expect(
      ctx.store.write({ version: 1, caches: { sisu: { token: 'x'.repeat(129 * 1024) } } }),
    ).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await ctx.store.read()).toEqual(initial);
  });
});
