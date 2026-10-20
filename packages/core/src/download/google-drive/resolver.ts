import { DriveLinkResolutionError } from '../source/errors.js';
import type { GoogleDriveFileReference } from './parse-url.js';
import { isDriveOwnedUrl } from './parse-url.js';

const defaultMaxRedirects = 5;
const defaultMaxPageBytes = 2 * 1024 * 1024;
const maximumPageBytes = 16 * 1024 * 1024;
const maxResolutionPages = 4;
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0 Safari/537.36';

export interface GoogleDriveResolverOptions {
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
  maxPageBytes?: number;
}

interface DriveResponse {
  response: Response;
  finalUrl: URL;
}

export class GoogleDriveResolver {
  private readonly cookies = new AnonymousGoogleCookieJar();
  private readonly fetcher: typeof globalThis.fetch;
  private readonly maxRedirects: number;
  private readonly maxPageBytes: number;

  constructor(options: GoogleDriveResolverOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
    this.maxPageBytes = options.maxPageBytes ?? defaultMaxPageBytes;
    if (
      !Number.isSafeInteger(this.maxRedirects) ||
      this.maxRedirects < 0 ||
      this.maxRedirects > 10
    ) {
      throw new DriveLinkResolutionError('Drive redirect limit must be between 0 and 10');
    }
    if (
      !Number.isSafeInteger(this.maxPageBytes) ||
      this.maxPageBytes < 1024 ||
      this.maxPageBytes > maximumPageBytes
    ) {
      throw new DriveLinkResolutionError(
        `Drive confirmation page limit must be between 1024 and ${maximumPageBytes} bytes`,
      );
    }
  }

  async resolveFileUrl(reference: GoogleDriveFileReference, signal?: AbortSignal): Promise<URL> {
    let url = new URL(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(reference.id)}`,
    );

    for (let page = 0; page < maxResolutionPages; page += 1) {
      const { response, finalUrl } = await this.requestFollowingRedirects(url, signal);
      const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
      const contentDisposition = response.headers.get('Content-Disposition');
      if (response.ok && (contentDisposition || isLikelyFileContentType(contentType))) {
        await discardBody(response);
        return finalUrl;
      }

      if (response.status === 500 && page === 0) {
        await discardBody(response);
        url = new URL(`https://drive.google.com/open?id=${encodeURIComponent(reference.id)}`);
        continue;
      }
      if (!response.ok && !contentType.includes('text/html')) {
        await discardBody(response);
        throw new DriveLinkResolutionError(`Google Drive returned HTTP ${response.status}`);
      }

      const html = await readBoundedText(response, this.maxPageBytes, signal);
      try {
        url = extractDriveConfirmationUrl(html, finalUrl);
      } catch (error) {
        if (response.status >= 400) {
          throw new DriveLinkResolutionError(
            `Google Drive could not resolve this public file (HTTP ${response.status})`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    throw new DriveLinkResolutionError(
      `Google Drive did not produce a file URL within ${maxResolutionPages} confirmation pages`,
    );
  }

  reset(): void {
    this.cookies.clear();
  }

  cookieHeaderFor(url: URL): string | undefined {
    return this.cookies.headerFor(url);
  }

  private async requestFollowingRedirects(url: URL, signal?: AbortSignal): Promise<DriveResponse> {
    let currentUrl = url;
    for (let redirects = 0; ; redirects += 1) {
      validateDriveTarget(currentUrl);
      const headers = new Headers({
        Accept: 'text/html,application/xhtml+xml,application/octet-stream;q=0.9,*/*;q=0.8',
        'User-Agent': userAgent,
      });
      const cookie = this.cookies.headerFor(currentUrl);
      if (cookie) headers.set('Cookie', cookie);

      const response = await this.fetcher(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        ...(signal ? { signal } : {}),
      });
      this.cookies.store(response.headers, currentUrl);

      if (response.status < 300 || response.status > 399) {
        return { response, finalUrl: currentUrl };
      }
      const location = response.headers.get('Location');
      await discardBody(response);
      if (!location) throw new DriveLinkResolutionError('Drive redirect is missing Location');
      if (redirects >= this.maxRedirects) {
        throw new DriveLinkResolutionError(
          `Google Drive exceeded the ${this.maxRedirects}-redirect limit`,
        );
      }
      try {
        currentUrl = new URL(location, currentUrl);
      } catch (error) {
        throw new DriveLinkResolutionError('Google Drive returned an invalid redirect target', {
          cause: error,
        });
      }
      validateDriveTarget(currentUrl);
    }
  }
}

function isLikelyFileContentType(contentType: string): boolean {
  return (
    contentType.length > 0 &&
    !contentType.includes('text/html') &&
    !contentType.startsWith('text/') &&
    !contentType.includes('json') &&
    !contentType.includes('xml')
  );
}

export function extractDriveConfirmationUrl(html: string, baseUrl: URL): URL {
  const hrefMatch = /href="(\/uc\?export=download[^"]+)"/i.exec(html);
  if (hrefMatch) {
    const href = hrefMatch[1];
    if (href)
      return validateDriveTarget(new URL(decodeHtmlEntities(href), 'https://docs.google.com'));
  }

  const formMatch =
    /<form\b([^>]*)\bid\s*=\s*(["'])download-form\2([^>]*)>([\s\S]*?)<\/form\s*>/i.exec(html);
  if (formMatch) {
    const formAttributes = parseAttributes(`${formMatch[1]} ${formMatch[3]}`);
    const action = formAttributes.get('action');
    if (!action) throw new DriveLinkResolutionError('Drive confirmation form has no action');
    const actionUrl = new URL(decodeHtmlEntities(action), baseUrl);
    const parameters = new Map<string, string>();
    const inputPattern = /<input\b[^>]*>/gi;
    for (const inputMatch of (formMatch[4] ?? '').matchAll(inputPattern)) {
      const attributes = parseAttributes(inputMatch[0]);
      if (attributes.get('type')?.toLowerCase() !== 'hidden') continue;
      const name = attributes.get('name');
      const value = attributes.get('value');
      if (name && value !== undefined) parameters.set(name, decodeHtmlEntities(value));
    }
    for (const [name, value] of parameters) actionUrl.searchParams.set(name, value);
    return validateDriveTarget(actionUrl);
  }

  const downloadUrlMatch = /"downloadUrl"\s*:\s*"([^"]+)"/.exec(html);
  if (downloadUrlMatch?.[1]) {
    const decoded = downloadUrlMatch[1]
      .replace(/\\u003d/gi, '=')
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/');
    return validateDriveTarget(new URL(decodeHtmlEntities(decoded), baseUrl));
  }

  const errorMatch =
    /<p\b[^>]*class\s*=\s*["'][^"']*uc-error-subcaption[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (errorMatch?.[1]) {
    const message = decodeHtmlEntities(errorMatch[1].replace(/<[^>]*>/g, '').trim());
    throw new DriveLinkResolutionError(message || 'Google Drive rejected the public link');
  }

  throw new DriveLinkResolutionError(
    'Google Drive confirmation page has no supported download form or URL',
  );
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (name) attributes.set(name.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&#x0*26;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function validateDriveTarget(url: URL): URL {
  if (url.protocol !== 'https:' || url.username || url.password || !isDriveOwnedUrl(url)) {
    throw new DriveLinkResolutionError('Drive download target is not an allowed HTTPS Google URL');
  }
  url.hash = '';
  return url;
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await discardBody(response);
    throw new DriveLinkResolutionError('Google Drive confirmation page exceeds the size limit');
  }

  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let totalBytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal.reason);
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new DriveLinkResolutionError('Google Drive confirmation page exceeds the size limit');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original page-read error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const error = new Error('Google Drive resolution was aborted', { cause: reason });
  error.name = 'AbortError';
  return error;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the redirect or resolution result.
  }
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expiresAt: number | undefined;
}

class AnonymousGoogleCookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  store(headers: Headers, url: URL): void {
    const responseHeaders = headers as Headers & { getSetCookie?: () => string[] };
    const setCookieValues = responseHeaders.getSetCookie?.() ?? [];
    if (setCookieValues.length === 0) {
      const combined = headers.get('Set-Cookie');
      if (combined) setCookieValues.push(...splitCombinedCookies(combined));
    }

    for (const setCookie of setCookieValues) this.storeCookie(setCookie, url);
  }

  headerFor(url: URL): string | undefined {
    const now = Date.now();
    const matching: string[] = [];
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      const domainMatches =
        url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`);
      const pathMatches =
        url.pathname === cookie.path ||
        url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);
      if (domainMatches && pathMatches && (!cookie.secure || url.protocol === 'https:')) {
        matching.push(`${cookie.name}=${cookie.value}`);
      }
    }
    if (matching.length === 0) return undefined;
    const header = matching.join('; ');
    return header.length <= 4096 ? header : undefined;
  }

  clear(): void {
    this.cookies.clear();
  }

  private storeCookie(setCookie: string, responseUrl: URL): void {
    const [nameValue, ...attributeParts] = setCookie.split(';');
    if (nameValue === undefined) return;
    const equalsIndex = nameValue.indexOf('=');
    if (equalsIndex <= 0) return;
    const name = nameValue.slice(0, equalsIndex).trim();
    const value = nameValue.slice(equalsIndex + 1).trim();
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) return;

    const attributes = new Map<string, string>();
    for (const part of attributeParts) {
      const index = part.indexOf('=');
      const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
      attributes.set(key, index < 0 ? '' : part.slice(index + 1).trim());
    }
    const explicitDomain = attributes.get('domain')?.replace(/^\./, '').toLowerCase();
    const domain = explicitDomain ?? responseUrl.hostname.toLowerCase();
    if (
      (explicitDomain &&
        responseUrl.hostname !== domain &&
        !responseUrl.hostname.endsWith(`.${domain}`)) ||
      (domain !== 'google.com' && !domain.endsWith('.google.com'))
    ) {
      return;
    }
    const defaultPath =
      responseUrl.pathname.slice(0, responseUrl.pathname.lastIndexOf('/') + 1) || '/';
    const path = attributes.get('path')?.startsWith('/')
      ? (attributes.get('path') as string)
      : defaultPath;
    const key = `${domain}\n${path}\n${name}`;
    const maxAge = Number(attributes.get('max-age'));
    if (attributes.has('max-age') && Number.isFinite(maxAge) && maxAge <= 0) {
      this.cookies.delete(key);
      return;
    }
    if (this.cookies.size >= 100 && !this.cookies.has(key)) return;

    let expiresAt: number | undefined;
    if (attributes.has('max-age') && Number.isFinite(maxAge)) {
      expiresAt = Date.now() + maxAge * 1000;
    } else if (attributes.has('expires')) {
      const parsedDate = Date.parse(attributes.get('expires') ?? '');
      if (Number.isFinite(parsedDate)) expiresAt = parsedDate;
    }
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.cookies.delete(key);
      return;
    }
    this.cookies.set(key, {
      name,
      value,
      domain,
      path,
      secure: attributes.has('secure'),
      expiresAt,
    });
  }
}

function splitCombinedCookies(value: string): string[] {
  return value
    .split(/,(?=\s*[^;,\s]+=)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}
