import type { Stats } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { stat as lstatOrUndefined } from '../../minecraft/filesystem';
import { ServerDataError, toServerDataError } from './errors';

export const SERVERS_DIRECTORY = 'servers';
export const ROOT_MARKER_FILE = '.torchlauncher-root.json';
export const DELETION_MARKER_FILE = '.torchlauncher-deletion.json';
export const LOCK_DIRECTORY = '.torchlauncher-server-lock';

const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export function isServerId(value: unknown): value is string {
  return typeof value === 'string' && uuidV4.test(value);
}

export function assertServerId(value: unknown): asserts value is string {
  if (!isServerId(value))
    throw new ServerDataError('invalid-server-id', 'Server ID must be a lowercase UUID v4');
}

/** Syntax-only base validation: absolute, already normalized, not a filesystem root. */
export function assertUserDataBase(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    dirname(value) === value
  )
    throw new ServerDataError(
      'invalid-base',
      'User-data base must be an absolute, normalized, non-root directory path',
    );
}

/** Pure path resolution: `<userDataBase>/servers/<serverId>`. Touches no filesystem state. */
export function resolveServerDataRoot(userDataBase: string, serverId: string): string {
  assertUserDataBase(userDataBase);
  assertServerId(serverId);
  const root = join(userDataBase, SERVERS_DIRECTORY, serverId);
  if (relative(userDataBase, root) !== `${SERVERS_DIRECTORY}${sep}${serverId}`)
    throw new ServerDataError('unsafe-path', 'Server data root escapes the user-data base');
  return root;
}

export interface VerifiedServerRoot {
  base: string;
  realBase: string;
  serversPath: string;
  root: string;
  realRoot: string;
  rootInfo: Stats;
}

function isPlainDirectory(info: Stats): boolean {
  return info.isDirectory() && !info.isSymbolicLink();
}

/** Validate the base directory on disk and return its canonical path. */
export async function verifyUserDataBase(userDataBase: string): Promise<string> {
  assertUserDataBase(userDataBase);
  try {
    const info = await lstatOrUndefined(userDataBase);
    if (!info || !isPlainDirectory(info))
      throw new ServerDataError(
        'invalid-base',
        'User-data base must be an existing directory and not a link',
      );
    return await realpath(userDataBase);
  } catch (error) {
    throw toServerDataError(error, 'Unable to inspect the user-data base');
  }
}

/**
 * Validate `<base>/servers/<id>` on disk: every component we own must be a real directory (Node
 * reports Windows junctions as symbolic links) and the canonical root must equal the canonical
 * base joined with the expected relative path, so links, junctions and mount tricks are refused.
 */
export async function verifyServerRoot(
  userDataBase: string,
  serverId: string,
): Promise<VerifiedServerRoot> {
  const root = resolveServerDataRoot(userDataBase, serverId);
  const realBase = await verifyUserDataBase(userDataBase);
  const serversPath = join(userDataBase, SERVERS_DIRECTORY);
  try {
    const serversInfo = await lstatOrUndefined(serversPath);
    if (!serversInfo)
      throw new ServerDataError('root-not-found', 'Server data root does not exist');
    if (!isPlainDirectory(serversInfo))
      throw new ServerDataError('unsafe-path', 'Servers directory is not a plain directory');
    const rootInfo = await lstatOrUndefined(root);
    if (!rootInfo) throw new ServerDataError('root-not-found', 'Server data root does not exist');
    if (!isPlainDirectory(rootInfo))
      throw new ServerDataError('unsafe-path', 'Server data root is not a plain directory');
    const realRoot = await realpath(root);
    if (realRoot !== join(realBase, SERVERS_DIRECTORY, serverId))
      throw new ServerDataError('unsafe-path', 'Server data root resolves outside its base');
    return { base: userDataBase, realBase, serversPath, root, realRoot, rootInfo };
  } catch (error) {
    throw toServerDataError(error, 'Unable to inspect the server data root');
  }
}
