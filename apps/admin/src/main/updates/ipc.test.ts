import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { type UpdateState, updateCommandChannel, updateStateChannel } from '../../shared/updates';
import { bindUpdateIpc } from './ipc';
import type { UpdateService } from './service';

it('restricts update IPC to trusted main frame and exact arguments, removes handlers/subscription', async () => {
  const frame = { url: 'file:///app/index.html' };
  const contents = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
  let destroyed = false;
  const window = {
    webContents: contents,
    isDestroyed: () => destroyed,
  } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const handle = vi.fn();
  const removeHandler = vi.fn();
  const unsubscribe = vi.fn();
  let publish: (state: UpdateState) => void = () => {};
  const state = { phase: 'idle' } as const;
  const command = vi.fn(async () => state);
  const service = {
    snapshot: () => state,
    command,
    subscribe: (listener: typeof publish) => {
      publish = listener;
      return unsubscribe;
    },
  } as unknown as UpdateService;
  const unbind = bindUpdateIpc(
    { handle, removeHandler } as unknown as IpcMain,
    window,
    frame.url,
    service,
  );
  const invoke = (channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const handler = handle.mock.calls.find(([name]) => name === channel)?.[1];
    if (!handler) throw new Error('missing handler');
    return handler(event, ...args);
  };
  expect(invoke(updateStateChannel, event)).toEqual(state);
  await expect(invoke(updateCommandChannel, event, { action: 'check' })).resolves.toEqual(state);
  expect(command).toHaveBeenCalledWith({ action: 'check' });
  for (const args of [
    [],
    [undefined],
    [{ action: 'install' }],
    [{ action: 'check', [Symbol('extra')]: true }],
    [Object.create({ action: 'check' })],
    [{ action: 'download', path: '/secret' }],
    [{ action: 'check', repository: 'evil/repo' }],
    [{ action: 'check' }, undefined],
    [[]],
    [{ action: 'check', url: 'https://evil.invalid' }],
  ]) {
    expect(() => invoke(updateCommandChannel, event, ...args)).toThrow('Invalid update request');
  }
  expect(() => invoke(updateStateChannel, event, undefined)).toThrow('Invalid');
  for (const bad of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: frame.url } },
    { ...event, senderFrame: null },
  ])
    expect(() => invoke(updateStateChannel, bad as IpcMainInvokeEvent)).toThrow('Untrusted');
  frame.url = 'https://evil.invalid';
  expect(() => invoke(updateCommandChannel, event, { action: 'check' })).toThrow('Untrusted');
  frame.url = 'file:///app/index.html';
  publish({ phase: 'downloading', received: 10 });
  expect(contents.send).toHaveBeenCalledWith(updateStateChannel, {
    phase: 'downloading',
    received: 10,
  });
  destroyed = true;
  publish(state);
  expect(contents.send).toHaveBeenCalledTimes(1);
  unbind();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(removeHandler.mock.calls).toEqual([[updateStateChannel], [updateCommandChannel]]);
});
