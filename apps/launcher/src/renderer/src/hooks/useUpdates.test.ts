import { afterEach, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../../shared/updates';

const hooks = vi.hoisted(() => ({
  effect: undefined as undefined | (() => () => void),
  setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const set = vi.fn();
    hooks.setters.push(set);
    return [initial, set];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => {
    hooks.effect = effect;
  },
  useCallback: (callback: unknown) => callback,
}));

import { useUpdates } from './useUpdates';

afterEach(() => {
  vi.unstubAllGlobals();
  hooks.setters = [];
  hooks.effect = undefined;
});
it('keeps old StrictMode effect snapshots from overwriting newer events and unsubscribes', async () => {
  const pending: ((state: UpdateState) => void)[] = [];
  const listeners = new Set<(state: UpdateState) => void>();
  const unsubscribe = vi.fn();
  const getUpdateState = vi.fn(() => new Promise<UpdateState>((resolve) => pending.push(resolve)));
  vi.stubGlobal('window', {
    torchlauncher: {
      getUpdateState,
      onUpdate: (listener: (state: UpdateState) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
    },
  });
  useUpdates();
  const effect = hooks.effect;
  if (!effect) throw new Error('missing effect');
  const firstCleanup = effect();
  firstCleanup();
  const cleanup = effect();
  for (const listener of listeners) listener({ phase: 'current' });
  for (const resolve of pending) resolve({ phase: 'idle' });
  await Promise.resolve();
  expect(hooks.setters[0]?.mock.calls).toEqual([[{ phase: 'current' }]]);
  cleanup();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(listeners.size).toBe(0);
});
it('guards duplicate button actions and handles rejected bridge requests safely', async () => {
  let reject!: (error: Error) => void;
  const update = vi.fn(
    () =>
      new Promise<UpdateState>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  vi.stubGlobal('window', {
    torchlauncher: {
      update,
      getUpdateState: async () => ({ phase: 'idle' }),
      onUpdate: () => () => {},
    },
  });
  const hook = useUpdates();
  const cleanup = hooks.effect?.();
  await Promise.resolve();
  const pending = hook.command({ action: 'check' });
  await hook.command({ action: 'check' });
  expect(update).toHaveBeenCalledOnce();
  reject(new Error('/private/path'));
  await expect(pending).resolves.toBeUndefined();
  expect(hooks.setters[0]).toHaveBeenLastCalledWith({ phase: 'error', code: 'UNAVAILABLE' });
  expect(hooks.setters[1]?.mock.calls).toEqual([[true], [false]]);
  cleanup?.();
});
