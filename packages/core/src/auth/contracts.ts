/** Main-process only. Never expose this result wholesale over renderer IPC or log it. */
export interface MinecraftAuthResult {
  accessToken: string;
  /** Unix epoch milliseconds; callers must refresh before launching with an expired token. */
  expiresAt: number;
  profile: { id: string; name: string };
  userType: 'msa';
  /** Selected OAuth app ID or explicitly configured temporary public Java Title ID. */
  clientId: string;
  xuid?: string;
}

export interface BrowserAuthorizationRequest {
  url: string;
  redirectUri: string;
  signal: AbortSignal;
}

export interface AuthenticationBrowser {
  /**
   * Bind the configured loopback listener BEFORE opening the system browser. Return the
   * complete callback URL; close listener/browser resources on completion or abort.
   * Do not collect credentials in an embedded webview. Core validates the callback.
   */
  authorize(request: BrowserAuthorizationRequest): Promise<string>;
}

export interface StoredMicrosoftSession {
  version: 1;
  refreshToken: string;
}

/**
 * Required OS credential-store/encryption adapter, owned by the host's main process.
 * Writes replace the value atomically; failures must reject. Do not fall back to plaintext.
 * Share one authenticator per key; cross-process locking is the host's responsibility.
 */
export interface MicrosoftTokenStorage {
  read(key: string): Promise<unknown>;
  write(key: string, session: StoredMicrosoftSession): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface MicrosoftAuthOptions {
  /** TorchLauncher's own registered public-client application ID. No default is provided. */
  clientId: string;
  /** Registered HTTP loopback URL; no query, fragment or user information. */
  redirectUri: string;
  browser: AuthenticationBrowser;
  storage: MicrosoftTokenStorage;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Whole login/refresh timeout, including browser interaction; defaults to five minutes. */
  timeoutMs?: number;
}

export type AuthStage =
  | 'configuration'
  | 'browser'
  | 'oauth'
  | 'xbox'
  | 'xsts'
  | 'minecraft'
  | 'entitlements'
  | 'profile'
  | 'storage';

export type AuthErrorCode =
  | 'invalid_configuration'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'invalid_callback'
  | 'browser_failed'
  | 'access_denied'
  | 'reauthentication_required'
  | 'no_session'
  | 'invalid_session'
  | 'storage_failed'
  | 'network_failed'
  | 'http_failed'
  | 'app_registration_rejected'
  | 'invalid_response'
  | 'xbox_account_required'
  | 'xbox_region_restricted'
  | 'xbox_adult_verification_required'
  | 'xbox_family_required'
  | 'xbox_rejected'
  | 'game_not_owned'
  | 'profile_required'
  | 'token_expired';

/** Intentionally excludes remote descriptions, response bodies, URLs and exception causes. */
export class AuthenticationError extends Error {
  override readonly name = 'AuthenticationError';

  constructor(
    readonly code: AuthErrorCode,
    readonly stage: AuthStage,
    readonly status?: number,
    readonly xboxError?: number,
  ) {
    super(`Authentication failed (${stage}: ${code}).`);
  }
}
