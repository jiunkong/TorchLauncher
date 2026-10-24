import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { SigningKeyStore } from '../signing.js';
import { StudioService as Service } from '../studio.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
/** Isolated real signing keys with test-only reversible storage, never used by production. */
export function testSigningKeys(): SigningKeyStore {
  const root = mkdtempSync(join(tmpdir(), 'studio-test-keys-'));
  roots.push(root);
  return new SigningKeyStore(root, {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  });
}
export class StudioService extends Service {
  readonly testKeys: SigningKeyStore;
  constructor(...args: Partial<ConstructorParameters<typeof Service>>) {
    const keys = args[3] ?? testSigningKeys();
    super(
      args[0] as ConstructorParameters<typeof Service>[0],
      args[1],
      args[2],
      keys,
      args[4],
      args[5],
    );
    this.testKeys = keys;
  }
}
