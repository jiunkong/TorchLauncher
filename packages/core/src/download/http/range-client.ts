export interface ByteRange {
  start: number;
  end: number;
}

export interface ResourceSnapshot {
  totalLength: number;
  etag: string | null;
  lastModified: string | null;
}

export interface RangeResponse {
  bytes: Uint8Array;
  range: ByteRange;
  snapshot: ResourceSnapshot;
}

export interface RangeRequestOptions {
  signal?: AbortSignal;
  headers?: NonNullable<Parameters<typeof fetch>[1]>['headers'];
  maxAttempts?: number;
  retryDelayMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetch?: typeof globalThis.fetch;
}

export interface HttpRangeClientOptions {
  /** Enable plain HTTP only for local fixtures or explicit development use. */
  allowInsecureHttp?: boolean;
}

const defaultMaxBytes = 64 * 1024 * 1024;

export class RangeDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RangeNotSupportedError extends RangeDownloadError {}

export class RangeProtocolError extends RangeDownloadError {}

export class RemoteResourceChangedError extends RangeDownloadError {}

export class RangeHttpError extends RangeDownloadError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetches inclusive HTTP byte ranges and pins the remote resource after the first response. */
export class HttpRangeClient {
  private resourceSnapshot: ResourceSnapshot | undefined;
  private resourceIdentity: { requested: string; effective: string } | undefined;
  private readonly allowInsecureHttp: boolean;

  constructor(options: HttpRangeClientOptions = {}) {
    this.allowInsecureHttp = options.allowInsecureHttp === true;
  }

  get snapshot(): ResourceSnapshot | undefined {
    return this.resourceSnapshot ? { ...this.resourceSnapshot } : undefined;
  }

  reset(): void {
    this.resourceSnapshot = undefined;
    this.resourceIdentity = undefined;
  }

  async getRange(
    url: string | URL,
    range: ByteRange,
    options: RangeRequestOptions = {},
  ): Promise<RangeResponse> {
    validateRange(range);
    const maxAttempts = options.maxAttempts ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 150;
    const maxBytes = options.maxBytes ?? defaultMaxBytes;
    const maxRedirects = options.maxRedirects ?? 5;
    const expectedLength = getRangeLength(range);
    const resourceIdentity = getResourceIdentity(url, this.allowInsecureHttp);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeDownloadError('maxAttempts must be a positive integer');
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new RangeDownloadError('retryDelayMs must be a non-negative number');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeDownloadError('maxBytes must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
      throw new RangeDownloadError('maxRedirects must be an integer from 0 through 10');
    }
    if (expectedLength > maxBytes) {
      throw new RangeDownloadError(`Requested range exceeds the ${maxBytes}-byte response limit`);
    }
    if (this.resourceIdentity && resourceIdentity !== this.resourceIdentity.requested) {
      throw new RemoteResourceChangedError(
        'This client is already pinned to a different resource; reset it before reuse',
      );
    }

    const fetcher = options.fetch ?? globalThis.fetch;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw abortError(options.signal.reason);
      }

      try {
        return await this.requestRange(
          fetcher,
          url,
          resourceIdentity,
          range,
          expectedLength,
          maxRedirects,
          options,
        );
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) {
          throw abortError(options.signal?.reason ?? error);
        }
        if (!isRetryable(error) || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        await delay(retryDelayMs, options.signal);
      }
    }

    throw new RangeDownloadError('Range request failed', { cause: lastError });
  }

  private async requestRange(
    fetcher: typeof globalThis.fetch,
    url: string | URL,
    resourceIdentity: string,
    range: ByteRange,
    expectedLength: number,
    maxRedirects: number,
    options: RangeRequestOptions,
  ): Promise<RangeResponse> {
    const headers = new Headers(options.headers);
    headers.set('Accept-Encoding', 'identity');
    headers.set('Range', `bytes=${range.start}-${range.end}`);

    const snapshot = this.resourceSnapshot;
    if (snapshot) {
      const validator = getIfRangeValidator(snapshot);
      if (validator) headers.set('If-Range', validator);
    }

    const { response, finalUrl } = await fetchFollowingRedirects(
      fetcher,
      url,
      headers,
      maxRedirects,
      this.allowInsecureHttp,
      options.signal,
    );
    const effectiveResourceIdentity = getResourceIdentity(finalUrl, this.allowInsecureHttp);

    if (response.status === 200) {
      await discardBody(response);
      if (snapshot && getIfRangeValidator(snapshot)) {
        throw new RemoteResourceChangedError(
          'The remote resource no longer matches the pinned validator',
        );
      }
      throw new RangeNotSupportedError('The server ignored the Range request');
    }
    if (response.status !== 206) {
      await discardBody(response);
      if (isRetryableStatus(response.status)) {
        throw new RetryableRangeHttpError(
          response.status,
          `Range request failed with retryable HTTP ${response.status}`,
        );
      }
      throw new RangeHttpError(
        response.status,
        `Range request failed with HTTP ${response.status}`,
      );
    }

    const contentEncoding = response.headers.get('Content-Encoding');
    if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
      await discardBody(response);
      throw new RangeProtocolError('The server returned an encoded range response');
    }

    const contentRange = parseContentRange(response.headers.get('Content-Range'));
    if (!contentRange) {
      await discardBody(response);
      throw new RangeProtocolError('The server returned an invalid or missing Content-Range');
    }
    if (contentRange.start !== range.start || contentRange.end !== range.end) {
      await discardBody(response);
      throw new RangeProtocolError('The returned Content-Range does not match the requested range');
    }

    const contentLengthHeader = response.headers.get('Content-Length');
    if (contentLengthHeader !== null && !/^\d+$/.test(contentLengthHeader)) {
      await discardBody(response);
      throw new RangeProtocolError('The server returned an invalid Content-Length');
    }
    if (
      contentLengthHeader !== null &&
      (!Number.isSafeInteger(Number(contentLengthHeader)) ||
        Number(contentLengthHeader) !== expectedLength)
    ) {
      await discardBody(response);
      throw new RangeProtocolError('Content-Length does not match the requested range');
    }

    const currentSnapshot: ResourceSnapshot = {
      totalLength: contentRange.totalLength,
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
    };
    if (range.end >= currentSnapshot.totalLength) {
      await discardBody(response);
      throw new RangeProtocolError('The requested range extends beyond the resource length');
    }
    if (snapshot && !sameSnapshot(snapshot, currentSnapshot)) {
      await discardBody(response);
      throw new RemoteResourceChangedError('The remote resource changed during range transfer');
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(response, expectedLength, options.signal);
    } catch (error) {
      if (error instanceof RangeProtocolError) throw error;
      throw new RetryableRangeTransportError('The range response body could not be read', {
        cause: error,
      });
    }

    const liveSnapshot = this.resourceSnapshot;
    if (
      this.resourceIdentity &&
      (resourceIdentity !== this.resourceIdentity.requested ||
        effectiveResourceIdentity !== this.resourceIdentity.effective)
    ) {
      throw new RemoteResourceChangedError(
        'The concurrent request targeted a different resource than the pinned one',
      );
    }
    if (liveSnapshot && !sameSnapshot(liveSnapshot, currentSnapshot)) {
      throw new RemoteResourceChangedError(
        'The remote resource changed during concurrent range transfer',
      );
    }
    if (!liveSnapshot) {
      this.resourceSnapshot = { ...currentSnapshot };
      this.resourceIdentity = {
        requested: resourceIdentity,
        effective: effectiveResourceIdentity,
      };
    }

    return { bytes, range: { ...range }, snapshot: { ...currentSnapshot } };
  }
}

function validateRange(range: ByteRange): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start
  ) {
    throw new RangeDownloadError(
      'Byte range must use non-negative safe integers with end >= start',
    );
  }
  getRangeLength(range);
}

function getRangeLength(range: ByteRange): number {
  const length = range.end - range.start + 1;
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeDownloadError('Byte range length must be a positive safe integer');
  }
  return length;
}

function getResourceIdentity(url: string | URL, allowInsecureHttp: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new RangeDownloadError('Range URL must be absolute', { cause: error });
  }
  validateTransportUrl(parsed, allowInsecureHttp);
  parsed.hash = '';
  return parsed.href;
}

async function fetchFollowingRedirects(
  fetcher: typeof globalThis.fetch,
  initialUrl: string | URL,
  headers: Headers,
  maxRedirects: number,
  allowInsecureHttp: boolean,
  signal?: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = new URL(initialUrl);
  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new RetryableRangeTransportError('Range request could not be completed', {
        cause: error,
      });
    }

    if (response.status < 300 || response.status > 399) {
      return { response, finalUrl: currentUrl };
    }
    const location = response.headers.get('Location');
    await discardBody(response);
    if (!location) throw new RangeProtocolError('Redirect response is missing Location');
    if (redirects >= maxRedirects) {
      throw new RangeProtocolError(`Range request exceeded the ${maxRedirects}-redirect limit`);
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch (error) {
      throw new RangeProtocolError('The server returned an invalid redirect target', {
        cause: error,
      });
    }
    validateTransportUrl(nextUrl, allowInsecureHttp);
    if (nextUrl.origin !== currentUrl.origin) {
      const forwardedHeaders = new Headers();
      for (const name of ['Accept-Encoding', 'If-Range', 'Range']) {
        const value = headers.get(name);
        if (value !== null) forwardedHeaders.set(name, value);
      }
      headers = forwardedHeaders;
    }
    currentUrl = nextUrl;
  }
}

function validateTransportUrl(url: URL, allowInsecureHttp: boolean): void {
  if (url.username || url.password) {
    throw new RangeProtocolError('Credentials in range URLs are not allowed');
  }
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw new RangeProtocolError('Range sources and redirects must use HTTPS');
  }
}

function parseContentRange(
  value: string | null,
): { start: number; end: number; totalLength: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const [, startText, endText, totalText] = match;
  const start = Number(startText);
  const end = Number(endText);
  const totalLength = Number(totalText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(totalLength) ||
    end < start ||
    totalLength <= end
  ) {
    return undefined;
  }
  return { start, end, totalLength };
}

function sameSnapshot(left: ResourceSnapshot, right: ResourceSnapshot): boolean {
  return (
    left.totalLength === right.totalLength &&
    left.etag === right.etag &&
    left.lastModified === right.lastModified
  );
}

function getIfRangeValidator(snapshot: ResourceSnapshot): string | undefined {
  if (snapshot.etag && !snapshot.etag.startsWith('W/')) return snapshot.etag;
  return snapshot.lastModified ?? undefined;
}

function isRetryable(error: unknown): boolean {
  return error instanceof RetryableRangeHttpError || error instanceof RetryableRangeTransportError;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

class RetryableRangeHttpError extends RangeHttpError {}

class RetryableRangeTransportError extends RangeDownloadError {}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const error = new Error('Range request was aborted', { cause: reason });
  error.name = 'AbortError';
  return error;
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal.reason);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal?.reason));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readBoundedBody(
  response: Response,
  expectedLength: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new RangeProtocolError('The range response has no body');
  const bytes = new Uint8Array(expectedLength);
  let received = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal.reason);
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > expectedLength - received) {
        throw new RangeProtocolError('The response body exceeds the requested range length');
      }
      bytes.set(value, received);
      received += value.byteLength;
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original read or protocol error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedLength) {
    throw new RangeProtocolError('The received body length does not match the requested range');
  }
  return bytes;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already unusable; preserve the protocol error.
  }
}
