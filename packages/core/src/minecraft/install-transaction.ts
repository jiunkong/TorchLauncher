import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { secureDirectory } from './filesystem';

/** Installation transaction directory (staging, backups, journal) inside a server root. */
export const INSTALL_LOCK_DIRECTORY = '.torchlauncher-install-lock';
export const INSTALL_JOURNAL_FILE = 'journal.json';
export interface InstallOperation {
  /** Absolute path inside the server root. */
  target: string;
  /** Absolute path directly inside `<lock>/staging`. */
  staged: string;
  /** Absolute path directly inside `<lock>/backups`; present when the target existed. */
  backup?: string;
}
export interface InstallJournal {
  version: 1;
  root: string;
  operations: InstallOperation[];
}
export class InstallRollbackError extends AggregateError {
  readonly lock: string;
  constructor(errors: unknown[], lock: string) {
    super(errors, `Install rollback failed; preserve recovery files at ${lock}`);
    this.name = 'InstallRollbackError';
    this.lock = lock;
  }
}
export interface PublishHooks {
  /** Test boundary invoked after each rename of the commit phase. */
  afterRename?: (index: number, step: 'backup' | 'publish') => void | Promise<void>;
}

/** Persist intent before the first rename so an interrupted process leaves recoverable paths. */
export async function writeInstallJournal(
  lock: string,
  root: string,
  operations: InstallOperation[],
): Promise<void> {
  const journal: InstallJournal = { version: 1, root, operations };
  await writeFile(join(lock, INSTALL_JOURNAL_FILE), JSON.stringify(journal), { flag: 'wx' });
}

/**
 * Publish operations in order: move an existing target to its backup, then move staged into place.
 * On failure, roll back in reverse. Throws `InstallRollbackError` when rollback itself fails; the
 * caller must then retain the lock directory for `recoverServerEnvironment`.
 */
export async function publishInstallOperations(
  lock: string,
  operations: InstallOperation[],
  hooks: PublishHooks = {},
): Promise<void> {
  const published: InstallOperation[] = [];
  try {
    for (const [index, operation] of operations.entries()) {
      // Caller serializes all mutations; recheck parent directories at each rename boundary.
      await secureDirectory(dirname(operation.target));
      if (operation.backup) {
        await rename(operation.target, operation.backup);
        await hooks.afterRename?.(index, 'backup');
      }
      published.push(operation);
      await rename(operation.staged, operation.target);
      await hooks.afterRename?.(index, 'publish');
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const operation of published.reverse()) {
      try {
        await rm(operation.target, { recursive: true, force: true });
        if (operation.backup) await rename(operation.backup, operation.target);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length) throw new InstallRollbackError([error, ...failures], lock);
    throw error;
  }
}
