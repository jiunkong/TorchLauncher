import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { StudioService } from './fixtures/signing.js';
import { handleStudioRequest } from './ipc.js';

describe('Studio IPC trust boundary', () => {
  it('accepts only an exact supported language command from the trusted main frame', async () => {
    const service = new StudioService({ open: vi.fn(), save: vi.fn() });
    const frame = { url: 'file:///studio/index.html' };
    const contents = { mainFrame: frame } as unknown as WebContents;
    const setLanguage = vi.fn();
    const invoke = (sender: unknown, senderFrame: unknown, input: unknown) =>
      handleStudioRequest(
        { sender, senderFrame } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
        contents,
        frame.url,
        service,
        input,
        setLanguage,
      );
    expect((await invoke(contents, frame, { action: 'setLanguage', language: 'ko' })).ok).toBe(
      true,
    );
    expect(setLanguage).toHaveBeenCalledExactlyOnceWith('ko');
    expect(await invoke(contents, frame, { action: 'setLanguage', language: 'fr' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(
      await invoke(contents, frame, { action: 'setLanguage', language: 'en', extra: true }),
    ).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await invoke(contents, frame, { action: 'setLanguage' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await invoke({}, frame, { action: 'setLanguage', language: 'en' })).toMatchObject({
      ok: false,
      code: 'UNTRUSTED',
    });
    expect(setLanguage).toHaveBeenCalledOnce();
  });

  it('rejects other windows, subframes and navigated renderers before native dialogs', async () => {
    const dialogs = { open: vi.fn(), save: vi.fn() };
    const service = new StudioService(dialogs);
    const frame = { url: 'file:///studio/index.html' };
    const contents = { mainFrame: frame } as unknown as WebContents;
    const invoke = (sender: unknown, senderFrame: unknown) =>
      handleStudioRequest(
        { sender, senderFrame } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
        contents,
        'file:///studio/index.html',
        service,
        { action: 'open' },
      );
    expect(await invoke({}, frame)).toEqual({ ok: false, code: 'UNTRUSTED' });
    expect(await invoke(contents, { ...frame })).toEqual({ ok: false, code: 'UNTRUSTED' });
    frame.url = 'https://example.org/evil';
    expect(await invoke(contents, frame)).toEqual({ ok: false, code: 'UNTRUSTED' });
    expect(dialogs.open).not.toHaveBeenCalled();
    frame.url = 'file:///studio/index.html';
    dialogs.open.mockResolvedValueOnce(null);
    expect(await invoke(contents, frame)).toEqual({ ok: false, code: 'CANCELLED' });
    expect(dialogs.open).toHaveBeenCalledOnce();
  });
});
