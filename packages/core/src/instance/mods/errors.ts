export type UserModErrorCode =
  | 'invalid-server-id'
  | 'invalid-source'
  | 'invalid-extension'
  | 'invalid-path'
  | 'unsafe-path'
  | 'limit-exceeded'
  | 'insufficient-space'
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
    readonly detail?: {
      readonly path?: string;
      readonly conflictsWith?: readonly string[];
      /** `insufficient-space` only: bytes needed (jar size plus safety margin) and bytes available. */
      readonly required?: number;
      readonly available?: number;
    },
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

/** Free space kept beyond the jar size when registering: the larger of 64 MiB or 10% of the jar. */
export const USER_MOD_SPACE_MARGIN = { minimumBytes: 64 * 1024 ** 2, fraction: 0.1 } as const;

export function requiredSpaceBytes(jarBytes: number): number {
  return (
    jarBytes +
    Math.max(
      USER_MOD_SPACE_MARGIN.minimumBytes,
      Math.ceil(jarBytes * USER_MOD_SPACE_MARGIN.fraction),
    )
  );
}
