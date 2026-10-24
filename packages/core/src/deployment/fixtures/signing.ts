import { createPrivateKey } from 'node:crypto';
import { createEd25519Signer, deriveEd25519PublicKey } from '../signing/index.js';

// Public deterministic fixture seed, exclusively for tests.
const key = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${'42'.repeat(32)}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
});
export const testSigning = { sequence: 1, sign: createEd25519Signer(key) };
export const testPublicKey = deriveEd25519PublicKey(key);
