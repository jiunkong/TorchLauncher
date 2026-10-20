import { DriveLinkResolutionError } from '../source/errors.js';

const driveHosts = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com']);
const fileIdPattern = /^[A-Za-z0-9_-]{1,256}$/;

export interface GoogleDriveFileReference {
  id: string;
  originalUrl: URL;
}

export function isGoogleDriveHost(hostname: string): boolean {
  return driveHosts.has(hostname.toLowerCase());
}

export function parseGoogleDriveFileUrl(value: string | URL): GoogleDriveFileReference {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new DriveLinkResolutionError('Google Drive source must be an absolute HTTPS URL', {
      cause: error,
    });
  }
  if (
    url.protocol !== 'https:' ||
    !isGoogleDriveHost(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new DriveLinkResolutionError('Unsupported Google Drive URL host or scheme');
  }

  const ids = url.searchParams.getAll('id');
  let id = ids.length === 1 ? ids[0] : undefined;
  if (ids.length > 1) throw new DriveLinkResolutionError('Google Drive URL has multiple file IDs');
  if (!id) id = getIdFromPath(url);
  if (!id || !fileIdPattern.test(id)) {
    throw new DriveLinkResolutionError('Google Drive URL does not contain a supported file ID');
  }

  return { id, originalUrl: url };
}

function getIdFromPath(url: URL): string | undefined {
  const patterns = [
    /^\/file\/d\/([^/]+)\/(?:view|edit)\/?$/,
    /^\/file\/u\/\d+\/d\/([^/]+)\/(?:view|edit)\/?$/,
    /^\/document\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
    /^\/document\/u\/\d+\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
    /^\/presentation\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
    /^\/presentation\/u\/\d+\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
    /^\/spreadsheets\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
    /^\/spreadsheets\/u\/\d+\/d\/([^/]+)\/(?:edit|htmlview|view)\/?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url.pathname);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch (error) {
        throw new DriveLinkResolutionError('Google Drive file ID is malformed', { cause: error });
      }
    }
  }
  return undefined;
}

export function isDriveOwnedUrl(url: URL): boolean {
  return isGoogleDriveHost(url.hostname);
}
