import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { brandingChannel } from '../../shared/branding';
import { bindBrandingIpc } from './ipc';
import type { BrandingService } from './service';

it('accepts only trusted main-frame no-argument snapshots and unbinds the handler', () => {
  const frame = { url: 'file:///application/index.html' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const handle = vi.fn();
  const removeHandler = vi.fn();
  const snapshot = { revision: 1, appName: 'TorchLauncher', icon: null, background: null };
  const service = { snapshot: () => snapshot } as BrandingService;
  const unbind = bindBrandingIpc(
    { handle, removeHandler } as unknown as IpcMain,
    window,
    frame.url,
    service,
  );
  expect(handle.mock.calls[0]?.[0]).toBe(brandingChannel);
  const invoke = handle.mock.calls[0]?.[1] as (
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ) => unknown;
  expect(invoke(event)).toBe(snapshot);
  for (const arg of [undefined, 'icon', { path: '/outside' }, { url: 'https://example.invalid' }])
    expect(() => invoke(event, arg)).toThrow('Invalid branding request');
  expect(() => invoke({ ...event, sender: {} } as IpcMainInvokeEvent)).toThrow('Untrusted');
  expect(() => invoke({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent)).toThrow(
    'Untrusted',
  );
  frame.url = 'https://example.invalid';
  expect(() => invoke(event)).toThrow('Untrusted');
  unbind();
  expect(removeHandler).toHaveBeenCalledWith(brandingChannel);
});
