import { setTimeout as delay } from 'node:timers/promises';
import type { Downloader } from '../../minecraft/installer';

export class FullDownloadError extends Error {
  constructor(
    readonly code: 'protocol' | 'http' | 'transport' | 'timeout',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FullDownloadError';
  }
}
export interface FullDownloaderOptions {
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxRedirects?: number;
  /** Whole-attempt deadline, including redirects and response body. */
  timeoutMs?: number;
  /** Local fixture servers only. Never permits HTTPS-to-HTTP downgrade. */
  allowInsecureLocalhost?: boolean;
  /** Counts bytes received, including failed/retried bodies. No URL or credentials exposed. */
  onBytes?: (count: number) => void;
}
function validateUrl(raw: string | URL, allowLocal: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FullDownloadError('protocol', 'Invalid download URL');
  }
  if (url.username || url.password || url.hash)
    throw new FullDownloadError('protocol', 'Download URL contains credentials or a fragment');
  if (
    url.protocol !== 'https:' &&
    !(
      allowLocal &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  ) {
    throw new FullDownloadError('protocol', 'Downloads require HTTPS');
  }
  return url;
}
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* Keep the original protocol failure. */
  }
}
async function attempt(
  url: URL,
  maxBytes: number,
  signal: AbortSignal,
  options: FullDownloaderOptions,
): Promise<Uint8Array> {
  const fetcher = options.fetch ?? globalThis.fetch;
  let current = url;
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    const response = await fetcher(current, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { 'Accept-Encoding': 'identity' },
      signal,
    });
    if (response.redirected) {
      await discard(response);
      throw new FullDownloadError('protocol', 'Transport followed a redirect without validation');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await discard(response);
      if (!location || redirects >= (options.maxRedirects ?? 5))
        throw new FullDownloadError('protocol', 'Invalid redirect or redirect limit exceeded');
      let next: URL;
      try {
        next = validateUrl(new URL(location, current), options.allowInsecureLocalhost === true);
      } catch {
        throw new FullDownloadError('protocol', 'Unsafe download redirect');
      }
      if (current.protocol === 'https:' && next.protocol !== 'https:')
        throw new FullDownloadError('protocol', 'HTTPS download downgrade refused');
      current = next;
      continue;
    }
    if (response.status !== 200) {
      await discard(response);
      throw new FullDownloadError(
        'http',
        `Full download failed with HTTP ${response.status}`,
        response.status,
      );
    }
    if (response.headers.has('Content-Range')) {
      await discard(response);
      throw new FullDownloadError('protocol', 'Unexpected partial full-download response');
    }
    const encoding = response.headers.get('Content-Encoding');
    if (encoding && encoding.trim().toLowerCase() !== 'identity') {
      await discard(response);
      throw new FullDownloadError('protocol', 'Encoded download response refused');
    }
    const lengthHeader = response.headers.get('Content-Length');
    const length = lengthHeader === null ? undefined : Number(lengthHeader);
    if (
      lengthHeader !== null &&
      (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(length) || (length ?? 0) > maxBytes)
    ) {
      await discard(response);
      throw new FullDownloadError('protocol', 'Invalid or oversized Content-Length');
    }
    const reader = response.body?.getReader();
    if (!reader) {
      if (length === 0) return new Uint8Array();
      throw new FullDownloadError('protocol', 'Download response has no body');
    }
    let bytes = new Uint8Array(length ?? Math.min(maxBytes, 64 * 1024));
    let received = 0;
    // Explicitly cancel the reader too: injected adapters need not wire the signal to their body.
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        options.onBytes?.(value.byteLength);
        received += value.byteLength;
        if (received > maxBytes || (length !== undefined && received > length))
          throw new FullDownloadError('protocol', 'Download body exceeds declared limit');
        if (received > bytes.byteLength) {
          const expanded = new Uint8Array(
            Math.min(maxBytes, Math.max(received, bytes.byteLength * 2)),
          );
          expanded.set(bytes);
          bytes = expanded;
        }
        bytes.set(value, received - value.byteLength);
      }
      if (length !== undefined && received !== length)
        throw new FullDownloadError('transport', 'Download body ended before Content-Length');
      return received === bytes.byteLength ? bytes : bytes.slice(0, received);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }
}
/** Anonymous complete-file transport; intentionally independent of the pinned Range client. */
export function createFullDownloader(options: FullDownloaderOptions = {}): Downloader {
  const attempts = options.maxAttempts ?? 3;
  const retryDelay = options.retryDelayMs ?? 150;
  const redirects = options.maxRedirects ?? 5;
  const timeout = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 10 ||
    !Number.isFinite(retryDelay) ||
    retryDelay < 0 ||
    retryDelay > 60_000 ||
    !Number.isSafeInteger(redirects) ||
    redirects < 0 ||
    redirects > 10 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 600_000
  )
    throw new FullDownloadError('protocol', 'Invalid full-download options');
  return async (raw, request) => {
    const url = validateUrl(raw, options.allowInsecureLocalhost === true);
    if (
      !Number.isSafeInteger(request.maxBytes) ||
      request.maxBytes < 0 ||
      request.maxBytes > 512 * 1024 * 1024
    )
      throw new FullDownloadError('protocol', 'Invalid download byte limit');
    for (let index = 0; ; index++) {
      request.signal?.throwIfAborted();
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), timeout);
      timer.unref();
      const signal = request.signal
        ? AbortSignal.any([request.signal, deadline.signal])
        : deadline.signal;
      let failure: FullDownloadError;
      try {
        return await attempt(url, request.maxBytes, signal, options);
      } catch (error) {
        // Do not attach raw fetch errors/URLs, which may carry signed query strings.
        request.signal?.throwIfAborted();
        failure = deadline.signal.aborted
          ? new FullDownloadError('timeout', 'Full download timed out')
          : error instanceof FullDownloadError
            ? error
            : new FullDownloadError('transport', 'Full download transport failed');
      } finally {
        clearTimeout(timer);
      }
      const retryable =
        failure.code === 'transport' ||
        failure.code === 'timeout' ||
        (failure.code === 'http' &&
          (failure.status === 408 || failure.status === 429 || (failure.status ?? 0) >= 500));
      if (!retryable || index + 1 >= attempts) throw failure;
      await delay(retryDelay, undefined, request.signal ? { signal: request.signal } : {});
    }
  };
}
