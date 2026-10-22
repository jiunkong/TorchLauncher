// Dependency-free so renderer-visible modules (server-config) never pull in node:crypto.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Canonical unpadded base64url of exactly 32 bytes: 43 characters, final 2 bits zero. */
export function isEd25519PublicKeyText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 43) return false;
  for (const character of value) if (!ALPHABET.includes(character)) return false;
  return ALPHABET.indexOf(value.charAt(42)) % 4 === 0;
}
