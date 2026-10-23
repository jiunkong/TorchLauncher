import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { type FileHandle, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { HostAuthenticationError } from './errors';

export interface SafeStorageBoundary {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface EncryptedAuthStoreOptions {
  /** Trusted, dedicated application account directory, outside any deletable server directory. */
  directory: string;
  safeStorage: SafeStorageBoundary;
  platform?: NodeJS.Platform;
}

const maxCiphertextBytes = 256 * 1024;
const linuxBackends = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

/**
 * safeStorage ciphertext only; no plaintext fallback. One instance per account directory.
 * The host must use an Electron single-instance lock for cross-process mutual exclusion.
 */
export class EncryptedAuthStore<T> {
  private readonly platform: NodeJS.Platform;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: EncryptedAuthStoreOptions,
    private readonly validate: (value: unknown) => T,
    private readonly keyPattern: RegExp,
  ) {
    this.platform = options.platform ?? process.platform;
    if (!isAbsolute(options.directory)) throw new HostAuthenticationError('invalid_configuration');
  }

  /** Call after app.whenReady(); a true Electron availability flag alone is insufficient on Linux. */
  assertSecureBackend(): void {
    try {
      if (
        !['win32', 'darwin', 'linux'].includes(this.platform) ||
        !this.options.safeStorage.isEncryptionAvailable() ||
        (this.platform === 'linux' &&
          !linuxBackends.has(this.options.safeStorage.getSelectedStorageBackend()))
      ) {
        throw new Error();
      }
    } catch {
      throw new HostAuthenticationError('secure_storage_unavailable');
    }
  }

  read(key: string): Promise<T | null> {
    return this.exclusive(async () => {
      this.assertSecureBackend();
      const path = this.path(key);
      await this.directory();
      await this.checkExisting(path);
      let file: FileHandle;
      try {
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size <= 0 ||
          stat.size > maxCiphertextBytes ||
          (this.platform !== 'win32' &&
            ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
        ) {
          throw new Error();
        }
        // A bounded read also rejects a file that grows after the stat call.
        const encrypted = Buffer.alloc(maxCiphertextBytes + 1);
        let length = 0;
        while (length < encrypted.length) {
          const { bytesRead } = await file.read(encrypted, length, encrypted.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > maxCiphertextBytes) throw new Error();
        this.assertSecureBackend();
        const decoded = JSON.parse(
          this.options.safeStorage.decryptString(encrypted.subarray(0, length)),
        ) as Record<string, unknown>;
        if (decoded.key !== key) throw new Error();
        return this.validate(decoded.session);
      } finally {
        await file.close();
      }
    });
  }

  write(key: string, value: T): Promise<void> {
    return this.exclusive(async () => {
      this.assertSecureBackend();
      const path = this.path(key);
      const plainText = JSON.stringify({ key, session: this.validate(value) });
      const encrypted = this.options.safeStorage.encryptString(plainText);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > maxCiphertextBytes)
        throw new Error();
      this.assertSecureBackend();
      await this.directory();
      await this.checkExisting(path);
      const temp = join(this.options.directory, `.${randomUUID()}.tmp`);
      let file: FileHandle | undefined;
      try {
        file = await open(
          temp,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await file.writeFile(encrypted);
        await file.sync();
        await file.close();
        file = undefined;
        this.assertSecureBackend();
        await rename(temp, path);
      } finally {
        await file?.close();
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    });
  }

  /** Removing ciphertext remains possible when the OS credential service is unavailable. */
  clear(key: string): Promise<void> {
    return this.exclusive(async () => {
      const path = this.path(key);
      if (!(await this.directory(false))) return;
      await this.checkExisting(path);
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  }

  private path(key: string): string {
    if (!this.keyPattern.test(key)) {
      throw new HostAuthenticationError('storage_failed');
    }
    return join(this.options.directory, `${createHash('sha256').update(key).digest('hex')}.bin`);
  }

  private async directory(create = true): Promise<boolean> {
    if (create) await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    let stat: Stats;
    try {
      stat = await lstat(this.options.directory);
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (this.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw new Error();
    return true;
  }

  private async checkExisting(path: string): Promise<void> {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action).catch((error: unknown) => {
      if (error instanceof HostAuthenticationError) throw error;
      throw new HostAuthenticationError('storage_failed');
    });
    this.pending = result.catch(() => {});
    return result;
  }
}
