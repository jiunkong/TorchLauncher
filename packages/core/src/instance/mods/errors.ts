export type UserModErrorCode =
  | 'invalid-server-id'
  | 'invalid-source'
  | 'invalid-extension'
  | 'invalid-path'
  | 'unsafe-path'
  | 'limit-exceeded'
  | 'invalid-jar'
  | 'path-conflict'
  | 'mod-id-conflict'
  | 'already-registered'
  | 'not-registered'
  | 'not-unregistered'
  | 'not-found'
  | 'local-changed'
  | 'locked'
  | 'sync-recovery-required'
  | 'invalid-state';

export class UserModError extends Error {
  constructor(
    readonly code: UserModErrorCode,
    readonly detail?: { readonly path?: string; readonly conflictsWith?: readonly string[] },
    options?: ErrorOptions,
  ) {
    super(`User mod operation failed: ${code}`, options);
    this.name = 'UserModError';
  }
}

export const USER_MOD_LIMITS = {
  jarBytes: 256 * 1024 ** 2,
  registryBytes: 2 * 1024 ** 2,
  intentBytes: 64 * 1024,
  registeredMods: 1_000,
  modIdsPerJar: 64,
  modIdLength: 64,
  zipEntries: 50_000,
  zipCentralDirectoryBytes: 16 * 1024 ** 2,
  zipDeclaredBytes: 4 * 1024 ** 3,
  metadataBytes: 1024 ** 2,
  listedFiles: 10_000,
  listedDepth: 8,
  operatorJarsParsed: 1_000,
} as const;
