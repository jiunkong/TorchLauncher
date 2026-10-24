import { describe, expect, it, vi } from 'vitest';
import { DEVICE_CODE_LINK_URL, DeviceCodePresenter } from './device-code';
import { HostAuthenticationError } from './errors';

function setup(open: (url: string) => Promise<void> | void = () => {}) {
  const copy = vi.fn();
  const openSpy = vi.fn(open);
  const presenter = new DeviceCodePresenter({ open: openSpy, copy });
  const seen: (string | null)[] = [];
  presenter.subscribe(() => seen.push(presenter.code));
  return { presenter, copy, open: openSpy, seen };
}

describe('DeviceCodePresenter', () => {
  it('publishes the code while waiting, opens the fixed link and clears on abort', async () => {
    const { presenter, open, seen } = setup();
    const controller = new AbortController();
    const shown = presenter.show('ABCD-1234', controller.signal);
    await vi.waitFor(() => expect(presenter.code).toBe('ABCD-1234'));
    expect(open).toHaveBeenCalledExactlyOnceWith(DEVICE_CODE_LINK_URL);
    controller.abort();
    await shown;
    expect(presenter.code).toBeNull();
    expect(seen).toEqual(['ABCD-1234', null]);
  });

  it('rejects malformed codes before publishing anything', async () => {
    const { presenter, open, seen } = setup();
    for (const code of ['', 'abc', 'A', 'ABCD 1234', 'ABCD-1234-ABCD-12345', '<b>XXXX</b>'])
      await expect(presenter.show(code, new AbortController().signal)).rejects.toBeInstanceOf(
        HostAuthenticationError,
      );
    expect(seen).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing for an already aborted signal', async () => {
    const { presenter, open, seen } = setup();
    const controller = new AbortController();
    controller.abort();
    await presenter.show('ABCD-1234', controller.signal);
    expect(seen).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('clears the code when opening the browser fails', async () => {
    const { presenter } = setup(() => {
      throw new Error('no browser');
    });
    await expect(presenter.show('ABCD-1234', new AbortController().signal)).rejects.toThrow(
      'no browser',
    );
    expect(presenter.code).toBeNull();
  });

  it('copies only while a code is waiting', async () => {
    const { presenter, copy } = setup();
    expect(presenter.copy()).toBe(false);
    const controller = new AbortController();
    const shown = presenter.show('ABCD-1234', controller.signal);
    await vi.waitFor(() => expect(presenter.code).not.toBeNull());
    expect(presenter.copy()).toBe(true);
    expect(copy).toHaveBeenCalledExactlyOnceWith('ABCD-1234');
    controller.abort();
    await shown;
    expect(presenter.copy()).toBe(false);
    expect(copy).toHaveBeenCalledOnce();
  });

  it('keeps a newer code when an older login ends later and survives faulty subscribers', async () => {
    const { presenter } = setup();
    presenter.subscribe(() => {
      throw new Error('boom');
    });
    const first = new AbortController();
    const second = new AbortController();
    const one = presenter.show('AAAA-1111', first.signal);
    await vi.waitFor(() => expect(presenter.code).toBe('AAAA-1111'));
    const two = presenter.show('BBBB-2222', second.signal);
    await vi.waitFor(() => expect(presenter.code).toBe('BBBB-2222'));
    first.abort();
    await one;
    expect(presenter.code).toBe('BBBB-2222');
    second.abort();
    await two;
    expect(presenter.code).toBeNull();
  });

  it('stops notifying unsubscribed listeners', async () => {
    const { presenter } = setup();
    const listener = vi.fn();
    const off = presenter.subscribe(listener);
    off();
    const controller = new AbortController();
    const shown = presenter.show('ABCD-1234', controller.signal);
    controller.abort();
    await shown;
    expect(listener).not.toHaveBeenCalled();
  });
});
