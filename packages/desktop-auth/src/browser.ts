import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { AuthenticationBrowser, BrowserAuthorizationRequest } from '@torchlauncher/core/auth';
import { HostAuthenticationError } from './errors';

export interface LoopbackBrowserOptions {
  openExternal(url: string): Promise<void>;
  timeoutMs?: number;
}

function parameters(request: BrowserAuthorizationRequest) {
  const redirect = new URL(request.redirectUri);
  const authorize = new URL(request.url);
  const state = authorize.searchParams.get('state');
  if (
    redirect.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) ||
    !redirect.port ||
    Number(redirect.port) < 1024 ||
    redirect.username ||
    redirect.password ||
    redirect.href.includes('?') ||
    redirect.href.includes('#') ||
    authorize.origin !== 'https://login.microsoftonline.com' ||
    authorize.pathname !== '/consumers/oauth2/v2.0/authorize' ||
    authorize.username ||
    authorize.password ||
    authorize.hash ||
    request.url.length > 2081 ||
    authorize.searchParams.getAll('redirect_uri').length !== 1 ||
    authorize.searchParams.get('redirect_uri') !== redirect.href ||
    authorize.searchParams.get('response_type') !== 'code' ||
    authorize.searchParams.get('response_mode') !== 'query' ||
    authorize.searchParams.get('code_challenge_method') !== 'S256' ||
    !/^[\w-]{43}$/.test(authorize.searchParams.get('code_challenge') ?? '') ||
    authorize.searchParams.getAll('state').length !== 1 ||
    !state ||
    !/^[\w-]{32,256}$/.test(state)
  )
    throw new HostAuthenticationError('invalid_configuration');
  return { redirect, authorize, state };
}

/** One local listener per attempt; opens only the Microsoft OAuth URL supplied by AUTH-01. */
export class LoopbackAuthenticationBrowser implements AuthenticationBrowser {
  private active = false;
  private readonly timeoutMs: number;

  constructor(private readonly options: LoopbackBrowserOptions) {
    this.timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 600_000) {
      throw new HostAuthenticationError('invalid_configuration');
    }
  }

  async authorize(request: BrowserAuthorizationRequest): Promise<string> {
    if (this.active) throw new HostAuthenticationError('busy');
    let config: ReturnType<typeof parameters>;
    try {
      config = parameters(request);
    } catch {
      throw new HostAuthenticationError('invalid_configuration');
    }
    if (request.signal.aborted) throw new HostAuthenticationError('cancelled');
    this.active = true;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const lifetime = new AbortController();
    const signal = AbortSignal.any([request.signal, timeout, lifetime.signal]);
    const sockets = new Set<Socket>();
    let resolveOutcome: (value: string) => void = () => {};
    let rejectOutcome: (error: unknown) => void = () => {};
    const outcome = new Promise<string>((resolve, reject) => {
      resolveOutcome = resolve;
      rejectOutcome = reject;
    });
    // An early bind failure/abort may reject before the browser wait starts.
    void outcome.catch(() => {});
    let received = false;
    const reply = (response: ServerResponse, status: number, message: string) => {
      response.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'close',
      });
      response.end(message);
    };
    const handler = (incoming: IncomingMessage, response: ServerResponse) => {
      incoming.resume();
      if (received || signal.aborted) {
        reply(response, 409, 'Sign-in attempt is closed.');
        return;
      }
      if (incoming.method !== 'GET') {
        reply(response, 405, 'Use the browser sign-in redirect.');
        return;
      }
      if (
        incoming.headers.host !== config.redirect.host ||
        !incoming.url?.startsWith('/') ||
        incoming.url.startsWith('//') ||
        incoming.url.length > 8192 ||
        incoming.headers.origin
      ) {
        reply(response, 400, 'Invalid sign-in response.');
        return;
      }
      let callback: URL;
      try {
        callback = new URL(incoming.url, config.redirect);
      } catch {
        reply(response, 400, 'Invalid sign-in response.');
        return;
      }
      if (
        callback.origin !== config.redirect.origin ||
        callback.pathname !== config.redirect.pathname
      ) {
        reply(response, 404, 'Not found.');
        return;
      }
      const query = callback.searchParams;
      const hasCode = query.getAll('code').length === 1 && Boolean(query.get('code'));
      const hasError = query.getAll('error').length === 1 && Boolean(query.get('error'));
      if (
        callback.href.includes('#') ||
        query.getAll('state').length !== 1 ||
        query.get('state') !== config.state ||
        hasCode === hasError ||
        query.getAll('code').length > 1 ||
        query.getAll('error').length > 1 ||
        (query.has('code') && query.has('error'))
      ) {
        reply(response, 400, 'Invalid sign-in response.');
        return;
      }
      received = true;
      reply(response, 200, 'Sign-in response received. Return to TorchLauncher.');
      // Flush the static response before the finally block closes all connections.
      response.once('finish', () => resolveOutcome(callback.href));
    };
    const server = createServer(
      { maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 5000 },
      handler,
    );
    server.maxConnections = 8;
    server.maxHeadersCount = 32;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.setTimeout(5000, () => socket.destroy());
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('error', () => rejectOutcome(new HostAuthenticationError('browser_failed')));
    const cancel = () =>
      rejectOutcome(
        new HostAuthenticationError(timeout.aborted ? 'callback_timeout' : 'cancelled'),
      );
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const listening = once(server, 'listening', { signal });
      server.listen({
        host:
          config.redirect.hostname === 'localhost'
            ? '127.0.0.1'
            : config.redirect.hostname.replace(/[[\]]/g, ''),
        port: Number(config.redirect.port),
        exclusive: true,
        signal,
      });
      await listening;
      signal.throwIfAborted();
      // Callback requests are accepted while openExternal is pending; never await it first.
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return this.options.openExternal(config.authorize.href);
        })
        .catch(() => rejectOutcome(new HostAuthenticationError('browser_failed')));
      return await outcome;
    } catch (error) {
      if (signal.aborted)
        throw new HostAuthenticationError(timeout.aborted ? 'callback_timeout' : 'cancelled');
      if (error instanceof HostAuthenticationError) throw error;
      throw new HostAuthenticationError('browser_failed');
    } finally {
      signal.removeEventListener('abort', cancel);
      lifetime.abort();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.active = false;
    }
  }
}
