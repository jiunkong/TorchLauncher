import { type ByteRange, RangeHttpError } from '../http/index.js';
import { BaseDownloadSource } from '../source/base.js';
import type {
  DownloadSourceOptions,
  DownloadSourceRequestOptions,
  SourceRangeResponse,
} from '../source/contracts.js';
import { SourceRestartRequiredError } from '../source/errors.js';
import { type GoogleDriveFileReference, isDriveOwnedUrl } from './parse-url.js';
import { GoogleDriveResolver } from './resolver.js';

export class GoogleDriveDownloadSource extends BaseDownloadSource {
  private readonly resolver: GoogleDriveResolver;
  private resolvedUrl: URL | undefined;
  private resolution:
    | { promise: Promise<URL>; controller: AbortController; waiters: number }
    | undefined;

  constructor(reference: GoogleDriveFileReference, options: DownloadSourceOptions = {}) {
    const maxRedirects = options.maxRedirects ?? 5;
    const fetcher = options.fetch ?? globalThis.fetch;
    super(
      'google-drive',
      `google-drive:${reference.id}`,
      createRangeRedirectGuard(fetcher),
      maxRedirects,
    );
    this.reference = reference;
    this.resolver = new GoogleDriveResolver({
      fetch: fetcher,
      maxRedirects,
      ...(options.maxPageBytes !== undefined ? { maxPageBytes: options.maxPageBytes } : {}),
    });
  }

  private readonly reference: GoogleDriveFileReference;

  async getRange(
    range: ByteRange,
    options: DownloadSourceRequestOptions = {},
  ): Promise<SourceRangeResponse> {
    this.assertActive();
    const generation = this.generation;
    let resolvedUrl: URL;
    try {
      resolvedUrl = await this.getResolvedUrl(options.signal);
      if (generation !== this.generation) {
        throw this.createRestartError(new Error('Source generation changed during resolution'));
      }
    } catch (error) {
      if (generation !== this.generation) throw this.createRestartError(error);
      throw error;
    }
    const cookie = this.resolver.cookieHeaderFor(resolvedUrl);
    const headers = cookie ? { Cookie: cookie } : undefined;

    try {
      return await this.transferRange(resolvedUrl, range, options, headers);
    } catch (error) {
      if (error instanceof SourceRestartRequiredError) throw error;
      if (error instanceof RangeHttpError && isExpiredAddressStatus(error.status)) {
        throw this.restartSource(error);
      }
      throw error;
    }
  }

  protected override onReset(): void {
    this.resolvedUrl = undefined;
    this.resolution?.controller.abort(new Error('Download source reset'));
    this.resolution = undefined;
    this.resolver.reset();
  }

  private async getResolvedUrl(signal?: AbortSignal): Promise<URL> {
    this.assertActive();
    if (this.resolvedUrl) return this.resolvedUrl;
    if (!this.resolution) {
      const generation = this.generation;
      const controller = new AbortController();
      const promise = this.resolver
        .resolveFileUrl(this.reference, AbortSignal.any([this.sourceSignal(), controller.signal]))
        .then((url) => {
          if (generation !== this.generation) {
            throw this.createRestartError(new Error('Source generation changed during resolution'));
          }
          this.resolvedUrl = url;
          return url;
        })
        .finally(() => {
          if (this.resolution?.promise === promise) this.resolution = undefined;
        });
      this.resolution = { promise, controller, waiters: 0 };
    }
    const resolution = this.resolution;
    resolution.waiters += 1;
    try {
      return await awaitWithSignal(resolution.promise, signal);
    } finally {
      resolution.waiters -= 1;
      if (resolution.waiters === 0 && !this.resolvedUrl && this.resolution === resolution) {
        resolution.controller.abort(new Error('All Drive resolution requests were canceled'));
      }
    }
  }
}

function isExpiredAddressStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

function createRangeRedirectGuard(fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = getRequestUrl(input);
    if (!isSafeRangeHost(url)) return blockedRedirect();
    const response = await fetcher(input, init);
    if (response.status < 300 || response.status > 399) return response;
    const location = response.headers.get('Location');
    if (!location) return response;
    let target: URL;
    try {
      target = new URL(location, url);
    } catch {
      await discardBody(response);
      return blockedRedirect();
    }
    if (!isSafeRangeHost(target)) {
      await discardBody(response);
      return blockedRedirect();
    }
    return response;
  };
}

function getRequestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

function isSafeRangeHost(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && isDriveOwnedUrl(url);
}

function blockedRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: 'http://blocked.invalid/' },
  });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the safe redirect rejection.
  }
}

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal.reason));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const error = new Error('Google Drive resolution was aborted', { cause: reason });
  error.name = 'AbortError';
  return error;
}
