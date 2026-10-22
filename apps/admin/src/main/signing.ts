import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomUUID,
  scrypt,
} from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveEd25519PublicKey } from '../../../../packages/core/src/deployment/signing/index.js';
import { isEd25519PublicKeyText } from '../../../../packages/core/src/deployment/signing/key-text.js';
import { StudioFailure } from './project.js';

/** The subset of Electron's `safeStorage` that Studio needs (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only. `basic_text` means no real keyring; Studio treats it as unavailable. */
  getSelectedStorageBackend?(): string;
}

export interface SigningKeyStatus {
  encryptionAvailable: boolean;
  keyExists: boolean;
  publicKey: string | null;
  /** Highest sequence reserved for this server by this key store (0 if none). */
  lastSequence: number;
}

const STORE_FORMAT = 'torchlauncher-signing-key';
const STORE_LIMIT = 16 * 1024;
const BACKUP_FORMAT = 'torchlauncher-signing-backup';
const BACKUP_LIMIT = 16 * 1024;
const BACKUP_CONTEXT = 'TORCHKEY-BACKUP-v1';
export const BACKUP_SCRYPT = { N: 2 ** 17, r: 8, p: 1 } as const;
export const BACKUP_LIMITS = { minN: 2 ** 14, maxN: 2 ** 20, r: 8, maxP: 4 } as const;
export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX_BYTES = 256;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;

function fail(code: ConstructorParameters<typeof StudioFailure>[0]): never {
  throw new StudioFailure(code);
}
function canonicalBase64(text: unknown, length: number): Buffer {
  if (typeof text !== 'string') fail('BACKUP_INVALID');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== text) fail('BACKUP_INVALID');
  return bytes;
}
function strictObject(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const names = Object.keys(input);
  return names.length === keys.length && keys.every((k) => Object.hasOwn(input, k))
    ? (input as Record<string, unknown>)
    : null;
}
function validServerId(serverId: unknown): serverId is string {
  return typeof serverId === 'string' && serverId.length > 0 && serverId.length <= 128;
}
async function readSmall(path: string, limit: number): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new StudioFailure('IO');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) fail('KEY_CORRUPT');
    const data = Buffer.alloc(info.size);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== info.size) fail('IO');
    return data;
  } finally {
    await handle.close();
  }
}
async function atomicWrite(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.key-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
function privateFromDer(der: Buffer): KeyObject {
  try {
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') fail('KEY_CORRUPT');
    return key;
  } catch (error) {
    if (error instanceof StudioFailure) throw error;
    return fail('KEY_CORRUPT');
  }
}
function normalizePassphrase(passphrase: unknown): Buffer {
  if (typeof passphrase !== 'string') return fail('INVALID');
  const text = passphrase.normalize('NFKC');
  const bytes = Buffer.from(text, 'utf8');
  if ([...text].length < PASSPHRASE_MIN || bytes.length > PASSPHRASE_MAX_BYTES)
    return fail('WEAK_PASSPHRASE');
  return bytes;
}
function deriveKey(
  passphrase: Buffer,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, { N, r, p, maxmem: 160 * N * r * p + 64 * 1024 ** 2 }, (e, key) =>
      e ? reject(e) : resolve(key),
    );
  });
}
function backupAad(h: {
  serverId: string;
  publicKey: string;
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  nonce: Buffer;
}): Buffer {
  return Buffer.from(
    [
      BACKUP_CONTEXT,
      h.serverId,
      h.publicKey,
      `${h.N}`,
      `${h.r}`,
      `${h.p}`,
      h.salt.toString('base64'),
      h.nonce.toString('base64'),
    ].join('\0'),
    'utf8',
  );
}

interface StoredKey {
  serverId: string;
  publicKey: string;
  sequence: number;
  encryptedPrivateKey: string;
}

export class SigningKeyStore {
  constructor(
    private readonly directory: string,
    private readonly storage: SafeStorageLike,
    private readonly scryptParams: { N: number } = BACKUP_SCRYPT,
  ) {}

  encryptionAvailable(): boolean {
    try {
      if (!this.storage.isEncryptionAvailable()) return false;
      const backend = this.storage.getSelectedStorageBackend?.();
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  }
  private requireEncryption(): void {
    if (!this.encryptionAvailable()) fail('ENCRYPTION_UNAVAILABLE');
  }
  private path(serverId: string): string {
    if (!validServerId(serverId)) fail('INVALID');
    return join(this.directory, `${createHash('sha256').update(serverId).digest('hex')}.json`);
  }
  private async read(serverId: string): Promise<StoredKey | null> {
    const data = await readSmall(this.path(serverId), STORE_LIMIT);
    if (!data) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      return fail('KEY_CORRUPT');
    }
    const o = strictObject(parsed, [
      'format',
      'version',
      'serverId',
      'publicKey',
      'sequence',
      'encryptedPrivateKey',
    ]);
    if (
      !o ||
      o.format !== STORE_FORMAT ||
      o.version !== 1 ||
      o.serverId !== serverId ||
      typeof o.publicKey !== 'string' ||
      !isEd25519PublicKeyText(o.publicKey) ||
      !Number.isSafeInteger(o.sequence) ||
      (o.sequence as number) < 0 ||
      (o.sequence as number) > MAX_SEQUENCE ||
      typeof o.encryptedPrivateKey !== 'string' ||
      o.encryptedPrivateKey.length > 4096
    )
      return fail('KEY_CORRUPT');
    return o as unknown as StoredKey;
  }
  private async write(record: StoredKey): Promise<void> {
    await atomicWrite(
      this.directory,
      this.path(record.serverId),
      `${JSON.stringify({ format: STORE_FORMAT, version: 1, ...record }, null, 2)}\n`,
    );
  }
  private seal(serverId: string, key: KeyObject, sequence: number): StoredKey {
    const der = key.export({ format: 'der', type: 'pkcs8' });
    let encrypted: Buffer;
    try {
      encrypted = this.storage.encryptString(der.toString('base64'));
    } catch {
      return fail('ENCRYPTION_UNAVAILABLE');
    }
    return {
      serverId,
      publicKey: deriveEd25519PublicKey(key),
      sequence,
      encryptedPrivateKey: encrypted.toString('base64'),
    };
  }

  async status(serverId: string): Promise<SigningKeyStatus> {
    const record = await this.read(serverId);
    return {
      encryptionAvailable: this.encryptionAvailable(),
      keyExists: record !== null,
      publicKey: record?.publicKey ?? null,
      lastSequence: record?.sequence ?? 0,
    };
  }
  /** Creates a new key for the server; refuses to replace an existing one. */
  async create(serverId: string): Promise<string> {
    this.requireEncryption();
    if (await this.read(serverId)) fail('KEY_EXISTS');
    const { privateKey } = generateKeyPairSync('ed25519');
    const record = this.seal(serverId, privateKey, 0);
    await this.write(record);
    return record.publicKey;
  }
  /** Decrypts the private key. The caller must not log or persist it. */
  async load(serverId: string): Promise<KeyObject> {
    this.requireEncryption();
    const record = await this.read(serverId);
    if (!record) return fail('KEY_MISSING');
    let der: Buffer;
    try {
      der = Buffer.from(
        this.storage.decryptString(Buffer.from(record.encryptedPrivateKey, 'base64')),
        'base64',
      );
    } catch {
      return fail('KEY_CORRUPT');
    }
    const key = privateFromDer(der);
    if (deriveEd25519PublicKey(key) !== record.publicKey) fail('KEY_CORRUPT');
    return key;
  }
  /**
   * Reserves the next deployment sequence: max(stored, floor) + 1, persisted BEFORE the build
   * starts. A failed or cancelled build therefore burns its number (a gap is harmless because
   * the launcher only needs strictly increasing values); a number is never handed out twice.
   */
  async reserveSequence(serverId: string, floor: number): Promise<number> {
    const record = await this.read(serverId);
    if (!record) return fail('KEY_MISSING');
    if (!Number.isSafeInteger(floor) || floor < 0 || floor > MAX_SEQUENCE) fail('INVALID');
    const next = Math.max(record.sequence, floor) + 1;
    if (next > MAX_SEQUENCE) fail('INVALID');
    await this.write({ ...record, sequence: next });
    return next;
  }

  /** Encrypted backup file content (JSON text). Contains no plaintext private material. */
  async exportBackup(serverId: string, passphrase: string): Promise<string> {
    const pass = normalizePassphrase(passphrase);
    const key = await this.load(serverId);
    const publicKey = deriveEd25519PublicKey(key);
    const { r, p } = BACKUP_SCRYPT;
    const N = this.scryptParams.N;
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const derived = await deriveKey(pass, salt, N, r, p);
    const cipher = createCipheriv('aes-256-gcm', derived, nonce);
    cipher.setAAD(backupAad({ serverId, publicKey, N, r, p, salt, nonce }));
    const plain = key.export({ format: 'der', type: 'pkcs8' });
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    derived.fill(0);
    plain.fill(0);
    return `${JSON.stringify(
      {
        format: BACKUP_FORMAT,
        version: 1,
        serverId,
        publicKey,
        kdf: { name: 'scrypt', N, r, p, salt: salt.toString('base64') },
        cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64') },
        ciphertext: ciphertext.toString('base64'),
        tag: tag.toString('base64'),
      },
      null,
      2,
    )}\n`;
  }

  /**
   * Restores a key from backup text for `serverId`. A different existing key is only replaced
   * when `replace` is true. Returns the restored public key.
   */
  async importBackup(
    serverId: string,
    content: Buffer,
    passphrase: string,
    options: { replace?: boolean } = {},
  ): Promise<{ publicKey: string; replaced: boolean }> {
    const pass = normalizePassphrase(passphrase);
    this.requireEncryption();
    if (content.length > BACKUP_LIMIT) fail('BACKUP_INVALID');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString('utf8'));
    } catch {
      return fail('BACKUP_INVALID');
    }
    const root = strictObject(parsed, [
      'format',
      'version',
      'serverId',
      'publicKey',
      'kdf',
      'cipher',
      'ciphertext',
      'tag',
    ]);
    if (!root || root.format !== BACKUP_FORMAT) return fail('BACKUP_INVALID');
    if (root.version !== 1) return fail('BACKUP_UNSUPPORTED');
    const kdf = strictObject(root.kdf, ['name', 'N', 'r', 'p', 'salt']);
    const cipherInfo = strictObject(root.cipher, ['name', 'nonce']);
    if (
      !kdf ||
      !cipherInfo ||
      !validServerId(root.serverId) ||
      typeof root.publicKey !== 'string' ||
      !isEd25519PublicKeyText(root.publicKey) ||
      kdf.name !== 'scrypt' ||
      cipherInfo.name !== 'aes-256-gcm' ||
      !Number.isInteger(kdf.N) ||
      !Number.isInteger(kdf.p)
    )
      return fail('BACKUP_INVALID');
    const N = kdf.N as number;
    const p = kdf.p as number;
    if (
      N < BACKUP_LIMITS.minN ||
      N > BACKUP_LIMITS.maxN ||
      (N & (N - 1)) !== 0 ||
      kdf.r !== BACKUP_LIMITS.r ||
      p < 1 ||
      p > BACKUP_LIMITS.maxP
    )
      return fail('BACKUP_INVALID');
    const salt = canonicalBase64(kdf.salt, 16);
    const nonce = canonicalBase64(cipherInfo.nonce, 12);
    const tag = canonicalBase64(root.tag, 16);
    const ciphertext = canonicalBase64(root.ciphertext, 48);
    if (root.serverId !== serverId) return fail('KEY_MISMATCH');
    const derived = await deriveKey(pass, salt, N, BACKUP_LIMITS.r, p);
    let plain: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', derived, nonce);
      decipher.setAAD(
        backupAad({
          serverId,
          publicKey: root.publicKey,
          N,
          r: BACKUP_LIMITS.r,
          p,
          salt,
          nonce,
        }),
      );
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return fail('BACKUP_AUTH');
    } finally {
      derived.fill(0);
    }
    let key: KeyObject;
    try {
      key = privateFromDer(plain);
    } catch {
      return fail('BACKUP_INVALID');
    } finally {
      plain.fill(0);
    }
    const publicKey = deriveEd25519PublicKey(key);
    if (publicKey !== root.publicKey) fail('KEY_MISMATCH');
    const existing = await this.read(serverId);
    if (existing && existing.publicKey !== publicKey && !options.replace) fail('KEY_EXISTS');
    const record = this.seal(serverId, key, existing?.sequence ?? 0);
    await this.write(record);
    return { publicKey, replaced: existing !== null && existing.publicKey !== publicKey };
  }
}
