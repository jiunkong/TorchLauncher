import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { expect, it } from 'vitest';
import { parseProductCommand } from '../../shared/product';
import { trustedProductSender } from './ipc';

it('rejects other windows, child frames and navigated/untrusted documents', () => {
  const mainFrame = { url: 'file:///application/index.html' };
  const contents = { mainFrame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  expect(trustedProductSender(event, window, mainFrame.url)).toBe(true);
  expect(
    trustedProductSender({ ...event, sender: {} } as IpcMainInvokeEvent, window, mainFrame.url),
  ).toBe(false);
  expect(
    trustedProductSender(
      { ...event, senderFrame: { url: mainFrame.url } } as IpcMainInvokeEvent,
      window,
      mainFrame.url,
    ),
  ).toBe(false);
  mainFrame.url = 'https://attacker.example';
  expect(trustedProductSender(event, window, 'file:///application/index.html')).toBe(false);
});
it('uses a closed IPC union with no absolute path/source URL/command injection slot', () => {
  for (const value of [
    null,
    { type: 'launch', root: '/outside' },
    { type: 'login', accessToken: 'secret' },
    { type: 'remove-mod', path: '/outside.jar' },
    { type: 'adopt-mod', path: 'mods/../bad.jar' },
    { type: 'launch', sourceUrl: 'https://elsewhere' },
    { type: 'recover', acceptUncertain: 'yes' },
    { type: 'set-packs', packs: new Array(257).fill('vanilla') },
  ])
    expect(() => parseProductCommand(value)).toThrow('invalid-request');
  expect(parseProductCommand({ type: 'delete', confirmation: 'a'.repeat(43) })).toEqual({
    type: 'delete',
    confirmation: 'a'.repeat(43),
  });
});
