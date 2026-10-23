import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import type { BrowserAuthorizationRequest } from '@torchlauncher/core/auth';
import { describe, expect, it, vi } from 'vitest';
import { LoopbackAuthenticationBrowser } from './browser';

const state = 's'.repeat(43);

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function setup(timeoutMs = 2000) {
  const redirectUri = `http://127.0.0.1:${await availablePort()}/callback`;
  const url = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  url.search = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    code_challenge_method: 'S256',
    code_challenge: 'c'.repeat(43),
    state,
  }).toString();
  const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {});
  const browser = new LoopbackAuthenticationBrowser({ openExternal, timeoutMs });
  const controller = new AbortController();
  const request: BrowserAuthorizationRequest = {
    url: url.href,
    redirectUri,
    signal: controller.signal,
  };
  return { browser, openExternal, controller, request, redirectUri };
}

function callback(url: string, extra = `code=synthetic-code&state=${state}`) {
  return `${url}?${extra}`;
}

async function get(url: string, headers: Record<string, string> = {}, method = 'GET') {
  const parsed = new URL(url);
  return new Promise<{ status: number; text: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method,
          headers: { Host: parsed.host, ...headers },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, text, headers: response.headers }),
          );
        },
      );
      request.once('error', reject);
      request.end();
    },
  );
}

async function expectClosed(redirectUri: string) {
  await expect(get(redirectUri)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
}

describe('system browser loopback adapter', () => {
  it('binds before opening, accepts a callback while browser-open is pending, and releases the port', async () => {
    const ctx = await setup();
    let reply: Awaited<ReturnType<typeof get>> | undefined;
    ctx.openExternal.mockImplementationOnce(async () => {
      reply = await get(callback(ctx.redirectUri));
      await new Promise(() => {});
    });
    expect(await ctx.browser.authorize(ctx.request)).toBe(callback(ctx.redirectUri));
    await vi.waitFor(() => expect(reply?.status).toBe(200));
    expect(reply?.text).not.toContain('synthetic-code');
    expect(reply?.headers).toMatchObject({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    expect(ctx.openExternal).toHaveBeenCalledWith(ctx.request.url);
    await expectClosed(ctx.redirectUri);
  });

  it('returns consent denial to the core without reflecting provider text', async () => {
    const ctx = await setup();
    ctx.openExternal.mockImplementationOnce(async () => {
      const reply = await get(
        callback(ctx.redirectUri, `error=access_denied&error_description=private&state=${state}`),
      );
      expect(reply.text).not.toContain('private');
    });
    expect(await ctx.browser.authorize(ctx.request)).toContain('error=access_denied');
    await expectClosed(ctx.redirectUri);
  });

  it.each([
    { query: 'code=x&state=wrong', status: 400 },
    { query: 'code=x', status: 400 },
    { query: `code=x&state=${state}&state=${state}`, status: 400 },
    { query: `code=x&code=y&state=${state}`, status: 400 },
    { query: `code=x&error=denied&state=${state}`, status: 400 },
    { query: `error=&state=${state}`, status: 400 },
    { query: `state=${state}`, status: 400 },
    { query: `code=x&state=${state}`, headers: { Host: 'evil.example' }, status: 400 },
    { query: `code=x&state=${state}`, headers: { Origin: 'https://evil.example' }, status: 400 },
    { query: `code=x&state=${state}`, method: 'POST', status: 405 },
    { query: `code=x&state=${state}`, path: '/other', status: 404 },
  ])('ignores invalid callback and remains available for the valid attempt: %j', async (test) => {
    const ctx = await setup();
    ctx.openExternal.mockImplementationOnce(async () => {
      const target = new URL(ctx.redirectUri);
      if (test.path) target.pathname = test.path;
      const invalid = await get(callback(target.href, test.query), test.headers, test.method);
      expect(invalid.status).toBe(test.status);
      await get(callback(ctx.redirectUri));
    });
    expect(await ctx.browser.authorize(ctx.request)).toBe(callback(ctx.redirectUri));
    await expectClosed(ctx.redirectUri);
  });

  it.each([
    { redirectUri: 'http://0.0.0.0:45678/callback' },
    { redirectUri: 'http://127.0.0.1/callback' },
    { redirectUri: 'http://127.0.0.1:45678/callback?' },
    { redirectUri: 'http://127.0.0.1:45678/callback#' },
    { url: 'file:///tmp/signin.html' },
    { url: 'https://login.microsoftonline.com.evil.example/consumers/oauth2/v2.0/authorize' },
    { url: 'https://user@login.microsoftonline.com/consumers/oauth2/v2.0/authorize' },
  ])('rejects unsafe system-browser configuration %j', async (overrides) => {
    const ctx = await setup();
    await expect(ctx.browser.authorize({ ...ctx.request, ...overrides })).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
    expect(ctx.openExternal).not.toHaveBeenCalled();
  });

  it('fails before opening when the configured port is occupied', async () => {
    const ctx = await setup();
    const occupied = createServer();
    occupied.listen(Number(new URL(ctx.redirectUri).port), '127.0.0.1');
    await once(occupied, 'listening');
    try {
      await expect(ctx.browser.authorize(ctx.request)).rejects.toMatchObject({
        code: 'browser_failed',
      });
      expect(ctx.openExternal).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it('closes on system-browser failure and allows a new attempt', async () => {
    const ctx = await setup();
    ctx.openExternal.mockRejectedValueOnce(new Error('private URL and launch failure'));
    const error = await ctx.browser.authorize(ctx.request).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'browser_failed' });
    expect(String(error)).not.toContain('private');
    await expectClosed(ctx.redirectUri);
    ctx.openExternal.mockImplementationOnce(async () => {
      await get(callback(ctx.redirectUri));
    });
    await expect(ctx.browser.authorize(ctx.request)).resolves.toBe(callback(ctx.redirectUri));
  });

  it('does not bind or open a browser for an already aborted attempt', async () => {
    const ctx = await setup();
    ctx.controller.abort();
    await expect(ctx.browser.authorize(ctx.request)).rejects.toMatchObject({ code: 'cancelled' });
    expect(ctx.openExternal).not.toHaveBeenCalled();
    await expectClosed(ctx.redirectUri);
  });

  it('cleans up cancellation immediately during binding', async () => {
    const ctx = await setup();
    const attempt = ctx.browser.authorize(ctx.request);
    ctx.controller.abort();
    await expect(attempt).rejects.toMatchObject({ code: 'cancelled' });
    expect(ctx.openExternal).not.toHaveBeenCalled();
    await expectClosed(ctx.redirectUri);
  });

  it('cancels an active browser wait, destroys idle sockets and rejects parallel attempts', async () => {
    const ctx = await setup();
    const attempt = ctx.browser.authorize(ctx.request);
    await vi.waitFor(() => expect(ctx.openExternal).toHaveBeenCalled());
    const socket = createConnection({
      host: '127.0.0.1',
      port: Number(new URL(ctx.redirectUri).port),
    });
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    await expect(ctx.browser.authorize(ctx.request)).rejects.toMatchObject({ code: 'busy' });
    ctx.controller.abort();
    await expect(attempt).rejects.toMatchObject({ code: 'cancelled' });
    await closed;
    await expectClosed(ctx.redirectUri);
  });

  it('times out without leaving the listener open', async () => {
    const ctx = await setup(40);
    await expect(ctx.browser.authorize(ctx.request)).rejects.toMatchObject({
      code: 'callback_timeout',
    });
    await expectClosed(ctx.redirectUri);
  });

  it('handles a localhost callback while binding only IPv4 loopback', async () => {
    const ctx = await setup();
    ctx.request.redirectUri = ctx.redirectUri.replace('127.0.0.1', 'localhost');
    const url = new URL(ctx.request.url);
    url.searchParams.set('redirect_uri', ctx.request.redirectUri);
    ctx.request.url = url.href;
    ctx.openExternal.mockImplementationOnce(async () => {
      await get(callback(ctx.request.redirectUri));
    });
    await expect(ctx.browser.authorize(ctx.request)).resolves.toBe(
      callback(ctx.request.redirectUri),
    );
  });
});
