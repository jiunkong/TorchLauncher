import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerDataError, throwIfAborted, toServerDataError } from './errors';
import { verifyServerRoot } from './paths';

export interface UsageLimits {
  /** Maximum number of entries (files, directories, links, others) below the root. */
  maxEntries: number;
  /** Maximum entry depth below the root (root children are depth 1). */
  maxDepth: number;
  /** Wall-clock budget for one traversal. */
  timeoutMs: number;
}

export const DEFAULT_USAGE_LIMITS: Readonly<UsageLimits> = Object.freeze({
  maxEntries: 1_000_000,
  maxDepth: 64,
  timeoutMs: 120_000,
});

export interface UsageProgress {
  entries: number;
  bytes: number;
}

export interface UsageOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UsageProgress) => void;
  limits?: Partial<UsageLimits>;
}

export interface UsageCounts {
  /** Sum of regular-file sizes; hard links inside the tree are counted once. */
  bytes: number;
  files: number;
  /** Directories below the root (the root itself is not counted). */
  directories: number;
  /** Symbolic links / junctions: reported but never followed nor sized. */
  links: number;
  /** Sockets, FIFOs, devices and other special entries (not sized). */
  others: number;
}

export type DirectoryUsage =
  | ({ status: 'complete' } & UsageCounts)
  /** No totals are reported: a partial sum must never be shown as the size. */
  | { status: 'limit-exceeded'; limit: 'entries' | 'depth' | 'time' };

export type ServerDataUsage = DirectoryUsage & { root: string };

const PROGRESS_INTERVAL = 256;

function resolveLimits(limits: Partial<UsageLimits> | undefined): UsageLimits {
  const merged = { ...DEFAULT_USAGE_LIMITS, ...limits };
  for (const value of Object.values(merged))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError('Usage limits must be positive integers');
  return merged;
}

class LimitReached {
  constructor(readonly limit: 'entries' | 'depth' | 'time') {}
}

/**
 * Bounded, link-safe directory measurement. Uses `lstat` for every entry, so symbolic links and
 * Windows junctions (reported by Node as symbolic links) are counted but never followed.
 * The caller must have validated `root` itself.
 */
export async function measureDirectory(
  root: string,
  options: UsageOptions = {},
): Promise<DirectoryUsage> {
  const limits = resolveLimits(options.limits);
  const deadline = Date.now() + limits.timeoutMs;
  const counts: UsageCounts = { bytes: 0, files: 0, directories: 0, links: 0, others: 0 };
  const seenInodes = new Set<string>();
  let entries = 0;
  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  try {
    while (stack.length > 0) {
      const current = stack.pop() as { path: string; depth: number };
      throwIfAborted(options.signal);
      let names: string[];
      try {
        names = await readdir(current.path);
      } catch (error) {
        // A subdirectory removed concurrently is simply gone.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && current.depth > 0) continue;
        throw error;
      }
      if (names.length > 0 && current.depth + 1 > limits.maxDepth) throw new LimitReached('depth');
      for (const name of names) {
        throwIfAborted(options.signal);
        if (Date.now() > deadline) throw new LimitReached('time');
        if (++entries > limits.maxEntries) throw new LimitReached('entries');
        const path = join(current.path, name);
        let info: Awaited<ReturnType<typeof lstat>>;
        try {
          info = await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (info.isSymbolicLink()) counts.links += 1;
        else if (info.isDirectory()) {
          counts.directories += 1;
          stack.push({ path, depth: current.depth + 1 });
        } else if (info.isFile()) {
          counts.files += 1;
          const key = `${info.dev}:${info.ino}`;
          if (info.nlink <= 1 || !seenInodes.has(key)) counts.bytes += info.size;
          if (info.nlink > 1) seenInodes.add(key);
        } else counts.others += 1;
        if (entries % PROGRESS_INTERVAL === 0)
          options.onProgress?.({ entries, bytes: counts.bytes });
      }
    }
  } catch (error) {
    if (error instanceof LimitReached) return { status: 'limit-exceeded', limit: error.limit };
    if (error instanceof ServerDataError) throw error;
    throw toServerDataError(error, 'Unable to measure server data');
  }
  options.onProgress?.({ entries, bytes: counts.bytes });
  return { status: 'complete', ...counts };
}

/** Measure `<base>/servers/<id>` after validating the root structure (marker not required). */
export async function getServerDataUsage(
  userDataBase: string,
  serverId: string,
  options: UsageOptions = {},
): Promise<ServerDataUsage> {
  const verified = await verifyServerRoot(userDataBase, serverId);
  const usage = await measureDirectory(verified.root, options);
  return { ...usage, root: verified.root };
}
