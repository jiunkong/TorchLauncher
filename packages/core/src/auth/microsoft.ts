import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  type AuthStage,
  type MicrosoftAuthOptions,
  type MinecraftAuthResult,
  type StoredMicrosoftSession,
} from './contracts';

const oauthBase = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const scopes = 'XboxLive.signin offline_access';
const minecraftBase = 'https://api.minecraftservices.com';
const maxResponseBytes = 256 * 1024;

function object(value: unknown, stage: AuthStage): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthenticationError('invalid_response', stage);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, stage: AuthStage): string {
  if (typeof value !== 'string' || !value || value.length > 65_536 || /\s/.test(value)) {
    throw new AuthenticationError('invalid_response', stage);
  }
  return value;
}

function token(value: unknown, stage: AuthStage, issuedAt: number) {
  const data = object(value, stage);
  const accessToken = string(data.access_token, stage);
  const seconds = data.expires_in;
  if (
    typeof data.token_type !== 'string' ||
    data.token_type.toLowerCase() !== 'bearer' ||
    typeof seconds !== 'number' ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    !Number.isSafeInteger(issuedAt + seconds * 1000)
  ) {
    throw new AuthenticationError('invalid_response', stage);
  }
  return { accessToken, expiresAt: issuedAt + seconds * 1000 };
}

function xboxToken(value: unknown, stage: AuthStage) {
  const data = object(value, stage);
  const claims = object(data.DisplayClaims, stage).xui;
  if (!Array.isArray(claims) || claims.length !== 1) {
    throw new AuthenticationError('invalid_response', stage);
  }
  const claim = object(claims[0], stage);
  const uhs = string(claim.uhs, stage);
  if (!/^\d+$/.test(uhs)) throw new AuthenticationError('invalid_response', stage);
  return { token: string(data.Token, stage), uhs, claim };
}

/** Cancels even an injected browser/transport that fails to observe the signal. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Single-account online authentication service. Has no Electron, browser-server or disk dependency.
 * OAuth refresh credentials are persisted; Minecraft/Xbox credentials exist only in memory.
 */
export class MicrosoftAuthenticator {
  private readonly options: MicrosoftAuthOptions;
  private readonly redirect: URL;
  private readonly storageKey: string;
  private readonly request: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private operation: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private logoutOperation: Promise<void> | undefined;

  constructor(options: MicrosoftAuthOptions) {
    let redirect: URL;
    try {
      redirect = new URL(options.redirectUri);
    } catch {
      throw new AuthenticationError('invalid_configuration', 'configuration');
    }
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.clientId) ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(options.clientId) ||
      redirect.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) ||
      redirect.username ||
      redirect.password ||
      redirect.search ||
      redirect.hash ||
      (options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs <= 0 ||
          options.timeoutMs > 600_000))
    ) {
      throw new AuthenticationError('invalid_configuration', 'configuration');
    }
    this.options = { ...options };
    this.redirect = redirect;
    this.storageKey = `torchlauncher.microsoft.${options.clientId.toLowerCase()}`;
    this.request = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  login(signal?: AbortSignal): Promise<MinecraftAuthResult> {
    return this.run(async (operationSignal) => {
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(32).toString('base64url');
      const authorize = new URL(`${oauthBase}/authorize`);
      authorize.search = new URLSearchParams({
        client_id: this.options.clientId,
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: this.redirect.href,
        scope: scopes,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
      }).toString();
      let callback: string;
      try {
        callback = await abortable(
          this.options.browser.authorize({
            url: authorize.href,
            redirectUri: this.redirect.href,
            signal: operationSignal,
          }),
          operationSignal,
        );
      } catch {
        operationSignal.throwIfAborted();
        throw new AuthenticationError('browser_failed', 'browser');
      }
      const code = this.authorizationCode(callback, state);
      return this.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirect.href,
          code_verifier: verifier,
        }),
        operationSignal,
      );
    }, signal);
  }

  /** Always obtains a fresh Minecraft token and rechecks entitlement/profile; never launches offline. */
  refresh(signal?: AbortSignal): Promise<MinecraftAuthResult> {
    return this.run(async (operationSignal) => {
      const stored = await this.storage(() => this.options.storage.read(this.storageKey));
      operationSignal.throwIfAborted();
      if (stored === null || stored === undefined) {
        throw new AuthenticationError('no_session', 'storage');
      }
      let refreshToken: string;
      try {
        const session = object(stored, 'storage');
        if (session.version !== 1) throw new Error();
        refreshToken = string(session.refreshToken, 'storage');
      } catch {
        await this.storage(() => this.options.storage.clear(this.storageKey));
        throw new AuthenticationError('invalid_session', 'storage');
      }
      try {
        return await this.exchange(
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
          operationSignal,
          refreshToken,
        );
      } catch (error) {
        if (error instanceof AuthenticationError && error.code === 'reauthentication_required') {
          await this.storage(() => this.options.storage.clear(this.storageKey));
        }
        throw error;
      }
    }, signal);
  }

  /**
   * Local logout: cancels active work, waits for any atomic store write, then clears credentials.
   * Does not revoke Microsoft consent, clear system-browser cookies or invalidate issued tokens.
   */
  logout(): Promise<void> {
    if (this.logoutOperation) return this.logoutOperation;
    this.controller?.abort();
    this.logoutOperation = (async () => {
      await this.operation;
      await this.storage(() => this.options.storage.clear(this.storageKey));
    })().finally(() => {
      this.logoutOperation = undefined;
    });
    return this.logoutOperation;
  }

  private authorizationCode(callback: string, state: string): string {
    let url: URL;
    try {
      url = new URL(callback);
    } catch {
      throw new AuthenticationError('invalid_callback', 'browser');
    }
    if (
      url.origin !== this.redirect.origin ||
      url.pathname !== this.redirect.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== state ||
      url.searchParams.getAll('code').length > 1 ||
      url.searchParams.getAll('error').length > 1 ||
      (url.searchParams.has('code') && url.searchParams.has('error'))
    )
      throw new AuthenticationError('invalid_callback', 'browser');
    if (url.searchParams.has('error')) {
      throw new AuthenticationError('access_denied', 'browser');
    }
    const code = url.searchParams.get('code');
    if (!code || code.length > 65_536) throw new AuthenticationError('invalid_callback', 'browser');
    return code;
  }

  private async exchange(form: URLSearchParams, signal: AbortSignal, previousRefresh?: string) {
    form.set('client_id', this.options.clientId);
    form.set('scope', scopes);
    const issuedAt = this.now();
    const response = await this.json(`${oauthBase}/token`, 'oauth', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    token(response, 'oauth', issuedAt);
    const refreshToken =
      response.refresh_token === undefined && previousRefresh
        ? previousRefresh
        : string(response.refresh_token, 'oauth');
    signal.throwIfAborted();
    // Save rotation before downstream requests: a transient Xbox failure must not lose it.
    const session: StoredMicrosoftSession = { version: 1, refreshToken };
    await this.storage(() => this.options.storage.write(this.storageKey, session));
    signal.throwIfAborted();
    return this.minecraft(string(response.access_token, 'oauth'), signal);
  }

  private async minecraft(accessToken: string, signal: AbortSignal): Promise<MinecraftAuthResult> {
    const xbox = xboxToken(
      await this.post('https://user.auth.xboxlive.com/user/authenticate', 'xbox', signal, {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${accessToken}`,
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      }),
      'xbox',
    );
    const xsts = xboxToken(
      await this.post('https://xsts.auth.xboxlive.com/xsts/authorize', 'xsts', signal, {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      }),
      'xsts',
    );
    if (xbox.uhs !== xsts.uhs) throw new AuthenticationError('invalid_response', 'xsts');
    const issuedAt = this.now();
    const minecraft = token(
      await this.post(`${minecraftBase}/launcher/login`, 'minecraft', signal, {
        xtoken: `XBL3.0 x=${xsts.uhs};${xsts.token}`,
        platform: 'PC_LAUNCHER',
      }),
      'minecraft',
      issuedAt,
    );
    const headers = { Authorization: `Bearer ${minecraft.accessToken}` };
    const entitlements = await this.json(
      `${minecraftBase}/entitlements/license?requestId=${randomUUID()}`,
      'entitlements',
      signal,
      { headers },
    );
    if (!Array.isArray(entitlements.items))
      throw new AuthenticationError('invalid_response', 'entitlements');
    const items = entitlements.items.map((entry) =>
      string(object(entry, 'entitlements').name, 'entitlements'),
    );
    if (!items.includes('game_minecraft') && !items.includes('product_minecraft')) {
      throw new AuthenticationError('game_not_owned', 'entitlements');
    }
    const profile = await this.json(`${minecraftBase}/minecraft/profile`, 'profile', signal, {
      headers,
    });
    const id = string(profile.id, 'profile');
    const name = string(profile.name, 'profile');
    if (!/^[0-9a-f]{32}$/i.test(id) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) {
      throw new AuthenticationError('invalid_response', 'profile');
    }
    signal.throwIfAborted();
    if (minecraft.expiresAt <= this.now())
      throw new AuthenticationError('token_expired', 'minecraft');
    const result: MinecraftAuthResult = {
      ...minecraft,
      profile: { id: id.toLowerCase(), name },
      userType: 'msa',
      clientId: this.options.clientId,
    };
    if (xsts.claim.xid !== undefined) {
      const xuid = string(xsts.claim.xid, 'xsts');
      if (!/^\d+$/.test(xuid)) throw new AuthenticationError('invalid_response', 'xsts');
      result.xuid = xuid;
    }
    return result;
  }

  private post(url: string, stage: AuthStage, signal: AbortSignal, body: unknown) {
    return this.json(url, stage, signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify(body),
    });
  }

  private async json(url: string, stage: AuthStage, signal: AbortSignal, init: RequestInit) {
    signal.throwIfAborted();
    let response: Response;
    let data: unknown;
    try {
      response = await abortable(
        this.request(url, {
          ...init,
          headers: { Accept: 'application/json', ...init.headers },
          redirect: 'error',
          cache: 'no-store',
          signal,
        }),
        signal,
      );
      try {
        data = await abortable(this.readJson(response, stage, signal), signal);
      } catch (error) {
        if (!response.ok && error instanceof AuthenticationError) {
          throw new AuthenticationError('http_failed', stage, response.status);
        }
        throw error;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('network_failed', stage);
    }
    const body = response.ok
      ? object(data, stage)
      : typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    if (!response.ok) {
      if (stage === 'oauth' && body.error === 'invalid_grant') {
        throw new AuthenticationError('reauthentication_required', stage, response.status);
      }
      if (
        stage === 'oauth' &&
        ['invalid_client', 'unauthorized_client'].includes(String(body.error))
      ) {
        throw new AuthenticationError('app_registration_rejected', stage, response.status);
      }
      if (stage === 'xbox' || stage === 'xsts') {
        const xerr =
          typeof body.XErr === 'number' && Number.isSafeInteger(body.XErr) ? body.XErr : undefined;
        const codes = {
          2148916233: 'xbox_account_required',
          2148916235: 'xbox_region_restricted',
          2148916236: 'xbox_adult_verification_required',
          2148916237: 'xbox_adult_verification_required',
          2148916238: 'xbox_family_required',
        } as const;
        const code =
          xerr === undefined
            ? 'http_failed'
            : (codes[xerr as keyof typeof codes] ?? 'xbox_rejected');
        throw new AuthenticationError(code, stage, response.status, xerr);
      }
      if (stage === 'profile' && response.status === 404) {
        throw new AuthenticationError('profile_required', stage, 404);
      }
      throw new AuthenticationError('http_failed', stage, response.status);
    }
    return body;
  }

  private async readJson(
    response: Response,
    stage: AuthStage,
    signal: AbortSignal,
  ): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new AuthenticationError('invalid_response', stage);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      while (true) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) throw new AuthenticationError('invalid_response', stage);
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new AuthenticationError('invalid_response', stage);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      // Cancel on oversize/parse failures; avoid leaking transport errors through cleanup.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async storage<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      throw new AuthenticationError('storage_failed', 'storage');
    }
  }

  private async run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> {
    if (this.operation || this.logoutOperation)
      throw new AuthenticationError('busy', 'configuration');
    const controller = new AbortController();
    this.controller = controller;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([controller.signal, timeout, ...(external ? [external] : [])]);
    const task = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return action(signal);
    });
    this.operation = task.then(
      () => {},
      () => {},
    );
    try {
      return await task;
    } catch (error) {
      if (signal.aborted)
        throw new AuthenticationError(timeout.aborted ? 'timeout' : 'cancelled', 'oauth');
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('network_failed', 'oauth');
    } finally {
      this.operation = undefined;
      this.controller = undefined;
    }
  }
}
