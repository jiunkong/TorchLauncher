import { isGoogleDriveHost, parseGoogleDriveFileUrl } from '../google-drive/parse-url.js';
import { GoogleDriveDownloadSource } from '../google-drive/source.js';
import type { DownloadSource, DownloadSourceOptions } from './contracts.js';
import { UnsupportedDownloadSourceError } from './errors.js';
import { HttpsDownloadSource } from './https-source.js';

export function createDownloadSource(
  url: string | URL,
  options: DownloadSourceOptions = {},
): DownloadSource {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new UnsupportedDownloadSourceError('Download source must be an absolute HTTPS URL', {
      cause: error,
    });
  }
  if (isGoogleDriveHost(parsed.hostname)) {
    return new GoogleDriveDownloadSource(parseGoogleDriveFileUrl(parsed), options);
  }
  return new HttpsDownloadSource(parsed, options);
}
