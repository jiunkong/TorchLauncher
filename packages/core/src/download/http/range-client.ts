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
  fetch?: typeof globalThis.fetch;
}

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

  get snapshot(): ResourceSnapshot | undefined {
    return this.resourceSnapshot;
  }

  reset(): void {
    this.resourceSnapshot = undefined;
  }

  async getRange(
    url: string | URL,
    range: ByteRange,
    options: RangeRequestOptions = {},
  ): Promise<RangeResponse> {
    validateRange(range);
    const maxAttempts = options.maxAttempts ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 150;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeDownloadError('maxAttempts must be a positive integer');
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new RangeDownloadError('retryDelayMs must be a non-negative number');
    }

    const fetcher = options.fetch ?? globalThis.fetch;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw abortError(options.signal.reason);
      }

      try {
        return await this.requestRange(fetcher, url, range, options);
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
    range: ByteRange,
    options: RangeRequestOptions,
  ): Promise<RangeResponse> {
    const headers = new Headers(options.headers);
    headers.set('Range', `bytes=${range.start}-${range.end}`);

    const snapshot = this.resourceSnapshot;
    if (snapshot) {
      const validator = getIfRangeValidator(snapshot);
      if (validator) headers.set('If-Range', validator);
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new RetryableRangeTransportError('Range request could not be completed', {
        cause: error,
      });
    }

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

    const contentRange = parseContentRange(response.headers.get('Content-Range'));
    if (!contentRange) {
      await discardBody(response);
      throw new RangeProtocolError('The server returned an invalid or missing Content-Range');
    }
    if (contentRange.start !== range.start || contentRange.end !== range.end) {
      await discardBody(response);
      throw new RangeProtocolError('The returned Content-Range does not match the requested range');
    }

    const expectedLength = range.end - range.start + 1;
    const contentLengthHeader = response.headers.get('Content-Length');
    if (contentLengthHeader === null || !/^\d+$/.test(contentLengthHeader)) {
      await discardBody(response);
      throw new RangeProtocolError('The server returned a missing or invalid Content-Length');
    }
    if (Number(contentLengthHeader) !== expectedLength) {
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
    if (!this.resourceSnapshot) this.resourceSnapshot = currentSnapshot;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new RetryableRangeTransportError('The range response body could not be read', {
        cause: error,
      });
    }
    if (bytes.byteLength !== expectedLength) {
      throw new RangeProtocolError('The received body length does not match the requested range');
    }

    return { bytes, range: { ...range }, snapshot: currentSnapshot };
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

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already unusable; preserve the protocol error.
  }
}
