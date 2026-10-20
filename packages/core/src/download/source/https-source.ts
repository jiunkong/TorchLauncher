import { createHash } from 'node:crypto';
import type { ByteRange } from '../http/index.js';
import { BaseDownloadSource } from './base.js';
import type {
  DownloadSourceOptions,
  DownloadSourceRequestOptions,
  SourceRangeResponse,
} from './contracts.js';
import { UnsupportedDownloadSourceError } from './errors.js';

export class HttpsDownloadSource extends BaseDownloadSource {
  private readonly url: URL;

  constructor(url: string | URL, options: DownloadSourceOptions = {}) {
    const parsed = parseHttpsUrl(url);
    super(
      'https',
      `https-sha256:${createHash('sha256').update(parsed.href).digest('hex')}`,
      options.fetch ?? globalThis.fetch,
      options.maxRedirects ?? 5,
    );
    this.url = parsed;
  }

  getRange(
    range: ByteRange,
    options: DownloadSourceRequestOptions = {},
  ): Promise<SourceRangeResponse> {
    return this.transferRange(this.url, range, options);
  }
}

function parseHttpsUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new UnsupportedDownloadSourceError('Download source must be an absolute HTTPS URL', {
      cause: error,
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new UnsupportedDownloadSourceError('Download source must be a credential-free HTTPS URL');
  }
  url.hash = '';
  return url;
}
