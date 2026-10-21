import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stat as lstatOrUndefined } from '../../minecraft/filesystem';
import { ServerDataError, throwIfAborted, toServerDataError } from './errors';
import {
  inspectServerDataLock,
  type LockInspection,
  readDeletionMarker,
  readServerDataMarker,
} from './marker';
import { isServerId, SERVERS_DIRECTORY, verifyServerRoot, verifyUserDataBase } from './paths';
import { type DirectoryUsage, measureDirectory, type UsageLimits } from './usage';

/** Upper bound on entries examined directly under `<base>/servers`. */
export const MAX_LISTED_SERVER_ENTRIES = 4096;

export interface ListedServerData {
  serverId: string;
  root: string;
  deletionInProgress: boolean;
  lock: LockInspection;
  usage?: DirectoryUsage;
}

export interface UnrecognizedServerEntry {
  name: string;
  path: string;
  reason:
    | 'not-server-id'
    | 'not-directory'
    | 'unsafe-path'
    | 'marker-missing'
    | 'marker-invalid'
    | 'marker-mismatch'
    | 'deletion-marker-invalid';
}

export interface ServerDataListing {
  serversPath: string;
  servers: ListedServerData[];
  /** Shown to the user only; never modified, adopted or deleted automatically. */
  unrecognized: UnrecognizedServerEntry[];
}

export interface ListOptions {
  includeUsage?: boolean;
  signal?: AbortSignal;
  /** Applied per server when `includeUsage` is set. */
  limits?: Partial<UsageLimits>;
}

/** List marked server roots under `<base>/servers`. Read-only. */
export async function listServerData(
  userDataBase: string,
  options: ListOptions = {},
): Promise<ServerDataListing> {
  await verifyUserDataBase(userDataBase);
  const serversPath = join(userDataBase, SERVERS_DIRECTORY);
  const listing: ServerDataListing = { serversPath, servers: [], unrecognized: [] };
  let names: string[];
  try {
    const info = await lstatOrUndefined(serversPath);
    if (!info) return listing;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ServerDataError('unsafe-path', 'Servers directory is not a plain directory');
    names = (await readdir(serversPath)).sort();
  } catch (error) {
    throw toServerDataError(error, 'Unable to list server data');
  }
  if (names.length > MAX_LISTED_SERVER_ENTRIES)
    throw new ServerDataError('limit-exceeded', 'Too many entries in the servers directory');

  for (const name of names) {
    throwIfAborted(options.signal);
    const path = join(serversPath, name);
    const unrecognized = (reason: UnrecognizedServerEntry['reason']) =>
      listing.unrecognized.push({ name, path, reason });
    if (!isServerId(name)) {
      unrecognized('not-server-id');
      continue;
    }
    try {
      const info = await lstatOrUndefined(path);
      if (!info) continue;
      if (!info.isDirectory() || info.isSymbolicLink()) {
        unrecognized(info.isSymbolicLink() ? 'unsafe-path' : 'not-directory');
        continue;
      }
      try {
        await verifyServerRoot(userDataBase, name);
      } catch (error) {
        if (error instanceof ServerDataError && error.code === 'unsafe-path') {
          unrecognized('unsafe-path');
          continue;
        }
        throw error;
      }
      const marker = await readServerDataMarker(path, name);
      if (marker.state !== 'valid') {
        unrecognized(`marker-${marker.state}`);
        continue;
      }
      const deletion = await readDeletionMarker(path, marker.marker);
      if (deletion.state === 'invalid' || deletion.state === 'mismatch') {
        unrecognized('deletion-marker-invalid');
        continue;
      }
      const entry: ListedServerData = {
        serverId: name,
        root: path,
        deletionInProgress: deletion.state === 'valid',
        lock: await inspectServerDataLock(path),
      };
      if (options.includeUsage) {
        const usageOptions: Parameters<typeof measureDirectory>[1] = {};
        if (options.signal) usageOptions.signal = options.signal;
        if (options.limits) usageOptions.limits = options.limits;
        entry.usage = await measureDirectory(path, usageOptions);
      }
      listing.servers.push(entry);
    } catch (error) {
      throw toServerDataError(error, 'Unable to inspect server data');
    }
  }
  return listing;
}
