import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  parseServerConfig,
  SERVER_CONFIG_FILENAME,
  type ServerConfig,
} from '../../../../../packages/core/src/server-config/index';

export function serverConfigPath(options: {
  packaged: boolean;
  appPath: string;
  executable: string;
  environment: NodeJS.ProcessEnv;
}): string {
  const env = options.environment;
  if (env.TORCH_SERVER_CONFIG) return resolve(env.TORCH_SERVER_CONFIG);
  const directory = options.packaged
    ? (env.PORTABLE_EXECUTABLE_DIR ??
      (env.APPIMAGE ? dirname(env.APPIMAGE) : dirname(options.executable)))
    : options.appPath;
  return join(directory, SERVER_CONFIG_FILENAME);
}
/** Never follows a config link, reads unbounded bytes, or reports raw JSON/URL to the renderer. */
export async function readServerConfig(path: string): Promise<ServerConfig> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16384)
    throw new Error('configuration-unavailable');
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const current = await file.stat();
    if (
      !current.isFile() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.size !== before.size
    )
      throw new Error('configuration-unavailable');
    const bytes = Buffer.alloc(16385);
    let size = 0;
    while (size < bytes.length) {
      const next = await file.read(bytes, size, bytes.length - size, size);
      if (!next.bytesRead) break;
      size += next.bytesRead;
    }
    const after = await file.stat();
    if (
      size > 16384 ||
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.nlink !== 1
    )
      throw new Error('configuration-unavailable');
    return parseServerConfig(
      JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(0, size))),
    );
  } finally {
    await file.close();
  }
}
