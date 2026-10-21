export type ServerDataErrorCode =
  /** Server identifier is not a lowercase UUID v4. */
  | 'invalid-server-id'
  /** User-data base is not an absolute, normalized, existing, non-link directory. */
  | 'invalid-base'
  /** A path component is a link, has the wrong type, or resolves outside the expected location. */
  | 'unsafe-path'
  | 'root-not-found'
  /** The server root has no `.torchlauncher-root.json` ownership marker. */
  | 'marker-missing'
  /** The marker (or deletion marker) is oversized, malformed or not a regular file. */
  | 'marker-invalid'
  /** The marker belongs to another server or another root instance. */
  | 'marker-mismatch'
  /** A non-empty existing directory without a marker was not adopted. */
  | 'unmarked-root'
  /** The cooperative server-data lock is held (game, installation or maintenance). */
  | 'locked'
  /** Deletion requires a valid, unexpired, unused confirmation token from the preview. */
  | 'confirmation-required'
  /** The server root changed identity between preview and deletion. */
  | 'target-changed'
  /** Bounded traversal hit an entry, depth or time limit. */
  | 'limit-exceeded'
  | 'aborted'
  /** Deletion stopped after removing some data; retry after a new preview. */
  | 'deletion-incomplete'
  | 'io-error';

export class ServerDataError extends Error {
  readonly code: ServerDataErrorCode;

  constructor(code: ServerDataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ServerDataError';
    this.code = code;
  }
}

export function isServerDataError(error: unknown, code?: ServerDataErrorCode): boolean {
  return error instanceof ServerDataError && (code === undefined || error.code === code);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ServerDataError('aborted', 'Server-data operation was cancelled');
}

/** Wrap unexpected filesystem errors without exposing anything beyond the errno code. */
export function toServerDataError(error: unknown, context: string): ServerDataError {
  if (error instanceof ServerDataError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new ServerDataError('io-error', `${context}${code ? ` (${code})` : ''}`, {
    cause: error,
  });
}
