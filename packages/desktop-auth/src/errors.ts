export type HostAuthErrorCode =
  | 'invalid_configuration'
  | 'browser_failed'
  | 'callback_timeout'
  | 'cancelled'
  | 'busy'
  | 'secure_storage_unavailable'
  | 'storage_failed';

/** Safe to report: never retains provider exceptions, callback URLs or local paths. */
export class HostAuthenticationError extends Error {
  override readonly name = 'HostAuthenticationError';

  constructor(readonly code: HostAuthErrorCode) {
    super(`Authentication host failed (${code}).`);
  }
}
