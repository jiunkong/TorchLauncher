import { ReleaseFailure } from '../../../../../packages/core/src/releases/index';
import type { UpdateCommand, UpdateState } from '../../shared/updates';
import { createLauncherUpdater, type UpdateOptions } from './index';

/** Owns network-operation lifetime; construction and snapshot never contact GitHub. */
export function createUpdateService(options: Omit<UpdateOptions, 'publish'>) {
  const listeners = new Set<(state: UpdateState) => void>();
  let unavailable: UpdateState = { phase: 'error', code: 'UNSUPPORTED_TARGET' };
  let updater: ReturnType<typeof createLauncherUpdater> | undefined;
  try {
    updater = createLauncherUpdater({
      ...options,
      publish: (state) => {
        for (const listener of listeners) {
          try {
            listener({ ...state });
          } catch {
            /* Window teardown must not fail network cleanup. */
          }
        }
      },
    });
  } catch (error) {
    unavailable = {
      phase: 'error',
      code: error instanceof ReleaseFailure ? error.code : 'UNAVAILABLE',
    };
  }
  let operation: Promise<UpdateState> | undefined;
  let closed = false;
  const snapshot = (): UpdateState => updater?.snapshot() ?? { ...unavailable };
  return {
    snapshot,
    subscribe(listener: (state: UpdateState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    command(command: UpdateCommand): Promise<UpdateState> {
      if (closed || !updater || operation) return Promise.resolve(snapshot());
      if (command.action === 'download' && snapshot().phase !== 'available')
        return Promise.resolve(snapshot());
      const backend = updater;
      const pending = (async () => {
        try {
          if (command.action === 'check') await backend.check();
          else await backend.download(); // Artifact paths never leave the host.
        } catch {
          /* Backend already records safe error/cancellation state. */
        }
        return snapshot();
      })();
      operation = pending;
      void pending.then(() => {
        if (operation === pending) operation = undefined;
      });
      return pending;
    },
    async close() {
      closed = true;
      updater?.cancel();
      await operation;
      listeners.clear();
    },
  };
}
export type UpdateService = ReturnType<typeof createUpdateService>;
