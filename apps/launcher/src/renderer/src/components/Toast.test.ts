import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastController, type ToastMessage } from './Toast';

describe('toast controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const seen: (ToastMessage | null)[] = [];
    return { seen, controller: createToastController((toast) => seen.push(toast)) };
  };

  it('dismisses success after 2.5 s and failure after 4 s', () => {
    const { seen, controller } = setup();
    controller.show('success', 'ok');
    vi.advanceTimersByTime(2499);
    expect(seen.at(-1)?.text).toBe('ok');
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBeNull();
    controller.show('error', 'bad');
    vi.advanceTimersByTime(3999);
    expect(seen.at(-1)?.kind).toBe('error');
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBeNull();
  });

  it('replaces the previous toast and restarts the timer', () => {
    const { seen, controller } = setup();
    controller.show('error', 'first');
    vi.advanceTimersByTime(3000);
    controller.show('success', 'second');
    vi.advanceTimersByTime(2000);
    expect(seen.at(-1)?.text).toBe('second');
    vi.advanceTimersByTime(500);
    expect(seen.at(-1)).toBeNull();
    expect(seen.filter((t) => t === null)).toHaveLength(1);
  });

  it('clears the pending timer on dispose', () => {
    const { seen, controller } = setup();
    controller.show('success', 'ok');
    controller.dispose();
    vi.advanceTimersByTime(10000);
    expect(seen.at(-1)?.text).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });
});
