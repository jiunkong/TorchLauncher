import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { handleStudioRequest } from './ipc.js';
import { StudioService } from './studio.js';

describe('Studio IPC trust boundary', () => {
  it('rejects other windows, subframes and navigated renderers before native dialogs', async () => {
    const dialogs = { open: vi.fn(), save: vi.fn(), discard: vi.fn() };
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
