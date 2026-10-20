import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  type BrowserAuthorizationRequest,
  MicrosoftAuthenticator,
  type MicrosoftAuthOptions,
  type StoredMicrosoftSession,
} from './index';

// Synthetic application ID and credentials. No live authentication requests are made.
const clientId = '11111111-2222-4333-8444-555555555555';
const redirectUri = 'http://127.0.0.1:45678/callback';
const profile = { id: '0123456789abcdef0123456789abcdef', name: 'TorchPlayer' };
const clock = 1_800_000_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responses() {
  return [
    json({
      token_type: 'Bearer',
      access_token: 'ms-access',
      refresh_token: 'ms-refresh',
      expires_in: 3600,
    }),
    json({ Token: 'xbox-token', DisplayClaims: { xui: [{ uhs: '123' }] } }),
    json({ Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: '123', xid: '456' }] } }),
    json({ token_type: 'Bearer', access_token: 'mc-access', expires_in: 3600 }),
    json({ items: [{ name: 'game_minecraft' }, { name: 'product_minecraft' }] }),
    json(profile),
  ];
}

function setup(overrides: Partial<MicrosoftAuthOptions> = {}) {
  let saved: unknown = null;
  const queue = responses();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const response = queue.shift();
    if (!response) throw new Error('Unexpected request');
    return response;
  });
  const authorize = vi.fn(async ({ url, redirectUri: callback }: BrowserAuthorizationRequest) => {
    const state = new URL(url).searchParams.get('state');
    return `${callback}?code=authorization-code&state=${state}`;
  });
  const storage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (_key: string, session: StoredMicrosoftSession) => {
      saved = structuredClone(session);
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  const auth = new MicrosoftAuthenticator({
    clientId,
    redirectUri,
    browser: { authorize },
    storage,
    fetch,
    now: () => clock,
    ...overrides,
  });
  return {
    auth,
    fetch,
    authorize,
    storage,
    queue,
    saved: () => saved,
    setSaved: (value: unknown) => {
      saved = value;
    },
  };
}

describe('Microsoft authentication', () => {
  it('uses PKCE, exact OAuth parameters, Xbox exchange, Java entitlement and profile', async () => {
    const ctx = setup();
    const result = await ctx.auth.login();
    expect(result).toEqual({
      accessToken: 'mc-access',
      expiresAt: clock + 3_600_000,
      profile,
      userType: 'msa',
      clientId,
      xuid: '456',
    });
    const browser = ctx.authorize.mock.calls[0]?.[0];
    expect(browser?.redirectUri).toBe(redirectUri);
    const url = new URL(browser?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('scope')).toBe('XboxLive.signin offline_access');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const calls = ctx.fetch.mock.calls;
    const form = new URLSearchParams(String(calls[0]?.[1]?.body));
    expect(form.get('client_id')).toBe(clientId);
    expect(form.get('redirect_uri')).toBe(redirectUri);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('authorization-code');
    expect(form.has('client_secret')).toBe(false);
    const verifier = form.get('code_verifier') ?? '';
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: 'd=ms-access',
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    });
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      Properties: { SandboxId: 'RETAIL', UserTokens: ['xbox-token'] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
    expect(calls[3]?.[0]).toBe('https://api.minecraftservices.com/launcher/login');
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toEqual({
      xtoken: 'XBL3.0 x=123;xsts-token',
      platform: 'PC_LAUNCHER',
    });
    expect(String(calls[4]?.[0])).toMatch(
      /^https:\/\/api\.minecraftservices\.com\/entitlements\/license\?requestId=[\w-]+$/,
    );
    expect(calls[5]?.[0]).toBe('https://api.minecraftservices.com/minecraft/profile');
    expect(calls[5]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer mc-access' });
    for (const [, init] of calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(ctx.saved()).toEqual({ version: 1, refreshToken: 'ms-refresh' });
    expect(ctx.storage.write.mock.calls[0]?.[0]).toBe(`torchlauncher.microsoft.${clientId}`);
    expect(JSON.stringify(ctx.saved())).not.toContain('access');
  });

  it('generates independent one-use browser attempts', async () => {
    const ctx = setup();
    await ctx.auth.login();
    ctx.queue.push(...responses());
    await ctx.auth.login();
    const first = new URL(ctx.authorize.mock.calls[0]?.[0]?.url ?? '');
    const second = new URL(ctx.authorize.mock.calls[1]?.[0]?.url ?? '');
    expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
    expect(first.searchParams.get('code_challenge')).not.toBe(
      second.searchParams.get('code_challenge'),
    );
  });

  it.each([
    '?code=x',
    '?code=x&state=wrong',
    '?code=x&code=y&state=STATE',
    '?code=x&state=STATE&state=STATE',
    '?code=x&error=denied&state=STATE',
    '?state=STATE',
    '?code=&state=STATE',
    '?code=x&state=STATE#fragment',
    'http://localhost:45678/callback?code=x&state=STATE',
    'http://127.0.0.1:45679/callback?code=x&state=STATE',
    'http://127.0.0.1:45678/other?code=x&state=STATE',
    'http://user@127.0.0.1:45678/callback?code=x&state=STATE',
    'https://evil.example/callback?code=x&state=STATE',
    'invalid URL',
  ])('rejects untrusted callback %s before exchanging credentials', async (callback) => {
    const ctx = setup();
    ctx.authorize.mockImplementationOnce(async ({ url }) => {
      const state = new URL(url).searchParams.get('state') ?? '';
      return (callback.startsWith('?') ? redirectUri + callback : callback).replaceAll(
        'STATE',
        state,
      );
    });
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'invalid_callback' });
    expect(ctx.fetch).not.toHaveBeenCalled();
    expect(ctx.saved()).toBeNull();
  });

  it('reports browser consent denial without including provider text', async () => {
    const ctx = setup();
    ctx.authorize.mockImplementationOnce(
      async ({ url }) =>
        `${redirectUri}?state=${new URL(url).searchParams.get('state')}&error=access_denied&error_description=secret`,
    );
    const error = await ctx.auth.login().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'access_denied', stage: 'browser' });
    expect(String(error)).not.toContain('secret');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { clientId: '' },
    { clientId: '00000000-0000-0000-0000-000000000000' },
    { redirectUri: 'https://example.com' },
    { redirectUri: 'http://127.0.0.1.evil.example/' },
    { redirectUri: 'http://127.0.0.2/' },
    { redirectUri: 'http://user@localhost/' },
    { redirectUri: 'http://localhost/?q=x' },
    { redirectUri: 'http://localhost/#x' },
    { redirectUri: 'invalid' },
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
  ])('rejects unsafe or missing public-client configuration: %j', (options) => {
    expect(() => setup(options)).toThrowError(AuthenticationError);
  });

  it('refreshes and saves rotated credentials before downstream failure, then retries with them', async () => {
    const ctx = setup();
    ctx.setSaved({ version: 1, refreshToken: 'old-refresh' });
    ctx.queue[1] = json({ private: 'secret' }, 503);
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'http_failed', status: 503 });
    expect(ctx.saved()).toEqual({ version: 1, refreshToken: 'ms-refresh' });
    ctx.queue.splice(0, ctx.queue.length, ...responses());
    await ctx.auth.refresh();
    const first = new URLSearchParams(String(ctx.fetch.mock.calls[0]?.[1]?.body));
    const second = new URLSearchParams(String(ctx.fetch.mock.calls[2]?.[1]?.body));
    expect(first.get('refresh_token')).toBe('old-refresh');
    expect(second.get('refresh_token')).toBe('ms-refresh');
    expect(second.get('grant_type')).toBe('refresh_token');
    expect(second.has('code_verifier')).toBe(false);
    expect(ctx.authorize).not.toHaveBeenCalled();
  });

  it('keeps the old refresh token if the service does not rotate it', async () => {
    const ctx = setup();
    ctx.setSaved({ version: 1, refreshToken: 'old-refresh' });
    ctx.queue[0] = json({ token_type: 'Bearer', access_token: 'ms-access', expires_in: 3600 });
    await ctx.auth.refresh();
    expect(ctx.saved()).toEqual({ version: 1, refreshToken: 'old-refresh' });
  });

  it('clears a revoked refresh token and requires interactive login', async () => {
    const ctx = setup();
    ctx.setSaved({ version: 1, refreshToken: 'revoked' });
    ctx.queue[0] = json({ error: 'invalid_grant', error_description: 'secret' }, 400);
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'reauthentication_required' });
    expect(ctx.saved()).toBeNull();
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined])('reports missing storage session %s', async (stored) => {
    const ctx = setup();
    ctx.setSaved(stored);
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'no_session' });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it.each([
    {},
    [],
    { version: 2, refreshToken: 'x' },
    { version: 1, refreshToken: '' },
    { version: 1, refreshToken: 4 },
  ])('clears malformed stored session %j', async (stored) => {
    const ctx = setup();
    ctx.setSaved(stored);
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'invalid_session' });
    expect(ctx.saved()).toBeNull();
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it.each(['invalid_client', 'unauthorized_client'])(
    'identifies OAuth registration rejection %s',
    async (error) => {
      const ctx = setup();
      ctx.queue[0] = json({ error }, 400);
      await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'app_registration_rejected' });
    },
  );

  it.each([
    [2148916233, 'xbox_account_required'],
    [2148916235, 'xbox_region_restricted'],
    [2148916236, 'xbox_adult_verification_required'],
    [2148916237, 'xbox_adult_verification_required'],
    [2148916238, 'xbox_family_required'],
    [999, 'xbox_rejected'],
  ])('maps XSTS restriction %s', async (xboxError, code) => {
    const ctx = setup();
    ctx.queue[2] = json(
      { XErr: xboxError, Message: 'private', Redirect: 'https://evil.example' },
      401,
    );
    const error = await ctx.auth.login().catch((error: unknown) => error);
    expect(error).toMatchObject({ code, stage: 'xsts', xboxError, status: 401 });
    expect(String(error)).not.toContain('private');
    expect(ctx.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([3, 4, 5])(
    'preserves HTTP 403 at Minecraft stage %i without falsely claiming app approval',
    async (index) => {
      const ctx = setup();
      ctx.queue[index] = json(
        { error: 'ForbiddenOperationException', errorMessage: 'Invalid app registration' },
        403,
      );
      await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'http_failed', status: 403 });
    },
  );

  it.each([
    [0, { token_type: 'Bearer', access_token: 'x', refresh_token: 'y', expires_in: 0 }],
    [0, { token_type: 'Basic', access_token: 'x', refresh_token: 'y', expires_in: 3600 }],
    [0, { token_type: 'Bearer', access_token: 'x', expires_in: 3600 }],
    [1, { Token: 'x', DisplayClaims: { xui: [] } }],
    [2, { Token: 'x', DisplayClaims: { xui: [{ uhs: 'different' }] } }],
    [2, { Token: 'x', DisplayClaims: { xui: [{ uhs: '123', xid: 'bad' }] } }],
    [3, { token_type: 'Bearer', access_token: 'x', expires_in: Infinity }],
    [4, { items: 'bad' }],
    [4, { items: [{}] }],
    [5, { id: '../bad', name: 'TorchPlayer' }],
    [5, { id: profile.id, name: 'invalid name' }],
  ])('rejects malformed credential/identity response at step %i', async (index, response) => {
    const ctx = setup();
    ctx.queue[index as number] = json(response);
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    { items: [] },
    { items: [{ name: 'product_dungeons' }] },
    { items: [{ name: 'other' }] },
  ])('does not launch without Java entitlement %j', async ({ items }) => {
    const ctx = setup();
    ctx.queue[4] = json({ items });
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'game_not_owned' });
    expect(ctx.fetch).toHaveBeenCalledTimes(5);
  });

  it('requires an initialized Java profile', async () => {
    const ctx = setup();
    ctx.queue[5] = json({ error: 'NOT_FOUND' }, 404);
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'profile_required' });
  });

  it('rejects a token expiring during the entitlement/profile checks', async () => {
    let time = clock;
    const ctx = setup({ now: () => time });
    ctx.queue[3] = json({ token_type: 'Bearer', access_token: 'mc-access', expires_in: 1 });
    ctx.fetch.mockImplementation(async () => {
      const next = ctx.queue.shift();
      if (!ctx.queue.length) time += 2000;
      if (!next) throw new Error();
      return next;
    });
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'token_expired' });
  });

  it.each([
    new Response('not json'),
    new Response(JSON.stringify('a string')),
    new Response('x'.repeat(300_000)),
  ])('rejects invalid or oversized response body', async (response) => {
    const ctx = setup();
    ctx.queue[0] = response;
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('redacts transport errors and preserves refresh credentials on transient network failures', async () => {
    const ctx = setup();
    ctx.setSaved({ version: 1, refreshToken: 'old-refresh' });
    ctx.fetch.mockRejectedValueOnce(new Error('secret request body and token'));
    const error = await ctx.auth.refresh().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'network_failed', stage: 'oauth' });
    expect(String(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('cause');
    expect(ctx.saved()).toEqual({ version: 1, refreshToken: 'old-refresh' });
  });

  it('fails closed on secure storage read/write/clear failures', async () => {
    const ctx = setup();
    ctx.storage.read.mockRejectedValueOnce(new Error('private location'));
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'storage_failed' });
    ctx.storage.write.mockRejectedValueOnce(new Error('private credential'));
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'storage_failed' });
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
    ctx.storage.clear.mockRejectedValueOnce(new Error('private credential'));
    await expect(ctx.auth.logout()).rejects.toMatchObject({ code: 'storage_failed' });
  });

  it('cancels before opening a browser when already aborted', async () => {
    const ctx = setup();
    await expect(ctx.auth.login(AbortSignal.abort('private reason'))).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(ctx.authorize).not.toHaveBeenCalled();
  });

  it('redacts system-browser failures separately from user consent denial', async () => {
    const ctx = setup();
    ctx.authorize.mockRejectedValueOnce(new Error('private callback and authorization URL'));
    const error = await ctx.auth.login().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'browser_failed', stage: 'browser' });
    expect(String(error)).not.toContain('private');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('preserves HTTP status when a provider returns an HTML error page', async () => {
    const ctx = setup();
    ctx.queue[0] = new Response('<html>private gateway failure</html>', { status: 502 });
    await expect(ctx.auth.login()).rejects.toMatchObject({
      code: 'http_failed',
      stage: 'oauth',
      status: 502,
    });
  });

  it.each(['game_minecraft', 'product_minecraft'])(
    'accepts a recognized Java entitlement %s without requiring optional XUID',
    async (entitlement) => {
      const ctx = setup();
      ctx.queue[2] = json({ Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: '123' }] } });
      ctx.queue[4] = json({ items: [{ name: entitlement }] });
      ctx.queue[5] = json({ ...profile, id: profile.id.toUpperCase() });
      const result = await ctx.auth.login();
      expect(result.profile).toEqual(profile);
      expect(result).not.toHaveProperty('xuid');
    },
  );

  it('cancels a stalled response body and closes its stream', async () => {
    const ctx = setup();
    const cancelled = vi.fn();
    const controller = new AbortController();
    ctx.queue[0] = new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(Buffer.from('{'));
        },
        cancel: cancelled,
      }),
    );
    const login = ctx.auth.login(controller.signal);
    await vi.waitFor(() => expect(ctx.fetch).toHaveBeenCalled());
    controller.abort();
    await expect(login).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });

  it('aborts browser wait and releases the operation lock', async () => {
    const ctx = setup();
    const controller = new AbortController();
    ctx.authorize.mockImplementationOnce(async () => new Promise(() => {}));
    const login = ctx.auth.login(controller.signal);
    await vi.waitFor(() => expect(ctx.authorize).toHaveBeenCalled());
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'busy' });
    controller.abort();
    await expect(login).rejects.toMatchObject({ code: 'cancelled' });
    expect(ctx.fetch).not.toHaveBeenCalled();
    await expect(ctx.auth.refresh()).rejects.toMatchObject({ code: 'no_session' });
  });

  it('times out a nonresponsive browser', async () => {
    const ctx = setup({ timeoutMs: 10 });
    ctx.authorize.mockImplementationOnce(async () => new Promise(() => {}));
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('cancels during transport before storing credentials', async () => {
    const ctx = setup();
    const controller = new AbortController();
    ctx.fetch.mockImplementationOnce(async () => new Promise(() => {}));
    const login = ctx.auth.login(controller.signal);
    await vi.waitFor(() => expect(ctx.fetch).toHaveBeenCalled());
    controller.abort();
    await expect(login).rejects.toMatchObject({ code: 'cancelled' });
    expect(ctx.storage.write).not.toHaveBeenCalled();
  });

  it('logout cancels browser authorization and ignores its late callback', async () => {
    const ctx = setup();
    let complete: ((url: string) => void) | undefined;
    ctx.authorize.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const login = ctx.auth.login().catch((error: unknown) => error);
    await vi.waitFor(() => expect(ctx.authorize).toHaveBeenCalled());
    await ctx.auth.logout();
    expect(await login).toMatchObject({ code: 'cancelled' });
    const state = new URL(ctx.authorize.mock.calls[0]?.[0]?.url ?? '').searchParams.get('state');
    complete?.(`${redirectUri}?code=late&state=${state}`);
    await Promise.resolve();
    expect(ctx.saved()).toBeNull();
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('logout waits for an in-flight atomic token write before clearing to prevent resurrection', async () => {
    const ctx = setup();
    let finishWrite: (() => void) | undefined;
    ctx.storage.write.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      ctx.setSaved({ version: 1, refreshToken: 'late-write' });
    });
    const login = ctx.auth.login().catch((error: unknown) => error);
    await vi.waitFor(() => expect(ctx.storage.write).toHaveBeenCalled());
    const logout = ctx.auth.logout();
    expect(ctx.auth.logout()).toBe(logout);
    await expect(ctx.auth.login()).rejects.toMatchObject({ code: 'busy' });
    expect(ctx.storage.clear).not.toHaveBeenCalled();
    finishWrite?.();
    await logout;
    expect(await login).toMatchObject({ code: 'cancelled' });
    expect(ctx.saved()).toBeNull();
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
  });
});
