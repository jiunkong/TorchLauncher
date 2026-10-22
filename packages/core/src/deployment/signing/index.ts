import { createPublicKey, sign as cryptoSign, type KeyObject, verify } from 'node:crypto';
import {
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_SIGNATURE_CONTEXT,
  DEPLOYMENT_SIGNATURE_LENGTH,
} from '../contracts/types.js';

export { isEd25519PublicKeyText } from './key-text.js';

import { isEd25519PublicKeyText } from './key-text.js';

export const ED25519_PUBLIC_KEY_LENGTH = 32;
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export class DeploymentSigningKeyError extends Error {
  constructor() {
    super('Invalid Ed25519 public key');
    this.name = 'DeploymentSigningKeyError';
  }
}

/** Strict canonical base64url (no padding) of exactly 32 bytes; anything else throws. */
export function decodeEd25519PublicKey(value: string | Uint8Array): Buffer {
  if (typeof value === 'string') {
    if (!isEd25519PublicKeyText(value)) throw new DeploymentSigningKeyError();
    return Buffer.from(value, 'base64url');
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new DeploymentSigningKeyError();
  }
  return Buffer.from(value);
}

/** Node KeyObject for a raw 32-byte key; throws DeploymentSigningKeyError when unusable. */
export function importEd25519PublicKey(value: string | Uint8Array): KeyObject {
  const raw = decodeEd25519PublicKey(value);
  try {
    return createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    throw new DeploymentSigningKeyError();
  }
}

/** Signed message: context prefix followed by the exact 64 header bytes. */
export function deploymentSignatureMessage(headerBytes: Uint8Array): Buffer {
  if (headerBytes.byteLength !== DEPLOYMENT_HEADER_LENGTH) {
    throw new RangeError('Deployment header must be exactly 64 bytes');
  }
  return Buffer.concat([Buffer.from(DEPLOYMENT_SIGNATURE_CONTEXT, 'latin1'), headerBytes]);
}

export function verifyDeploymentSignature(
  key: KeyObject,
  headerBytes: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (signature.byteLength !== DEPLOYMENT_SIGNATURE_LENGTH) return false;
  try {
    return verify(null, deploymentSignatureMessage(headerBytes), key, signature);
  } catch {
    return false;
  }
}

/** Studio helper: base64url public key for a private Ed25519 KeyObject. */
export function deriveEd25519PublicKey(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new DeploymentSigningKeyError();
  }
  return jwk.x;
}

/** Studio helper: a `sign` callback for writeDeployment; core never stores the key itself. */
export function createEd25519Signer(privateKey: KeyObject): (message: Uint8Array) => Buffer {
  return (message) => cryptoSign(null, message, privateKey);
}

export type DeploymentRollbackDecision = 'accept' | 'reject-lower' | 'reject-conflict';

/** The newest deployment the launcher has applied (or is applying) for one server. */
export interface DeploymentRollbackState {
  readonly sequence: number;
  readonly deploymentId: string;
  /** Lowercase hex SHA-256 of the index bytes (header.indexSha256). */
  readonly indexSha256: string;
}

function checkState(state: DeploymentRollbackState): void {
  if (
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 1 ||
    typeof state.deploymentId !== 'string' ||
    typeof state.indexSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(state.indexSha256)
  ) {
    throw new TypeError('Invalid rollback state');
  }
}

/**
 * Pure rollback decision. `seen` is the stored maximum (null when nothing is stored: first
 * install or deleted data). Equal sequence is accepted only for the identical deployment.
 */
export function decideRollback(
  seen: DeploymentRollbackState | null,
  incoming: DeploymentRollbackState,
): DeploymentRollbackDecision {
  checkState(incoming);
  if (seen === null) return 'accept';
  checkState(seen);
  if (incoming.sequence < seen.sequence) return 'reject-lower';
  if (incoming.sequence > seen.sequence) return 'accept';
  return incoming.deploymentId === seen.deploymentId && incoming.indexSha256 === seen.indexSha256
    ? 'accept'
    : 'reject-conflict';
}
