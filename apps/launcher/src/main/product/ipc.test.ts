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
    { type: 'set-close-on-launch', value: 'true' },
    { type: 'set-close-on-launch', value: true, path: '/outside' },
    { type: 'set-close-on-launch' },
    { type: 'set-game-memory', maxMemoryMiB: '2048' },
    { type: 'set-game-memory', maxMemoryMiB: 2048, initialMemoryMiB: 1024, extra: true },
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

it('accepts only the boolean personal setting command', () => {
  expect(parseProductCommand({ type: 'set-close-on-launch', value: true })).toEqual({
    type: 'set-close-on-launch',
    value: true,
  });
});
it('accepts only integer MiB game memory settings', () => {
  expect(parseProductCommand({ type: 'set-game-memory', maxMemoryMiB: 4096 })).toEqual({
    type: 'set-game-memory',
    maxMemoryMiB: 4096,
  });
  expect(
    parseProductCommand({ type: 'set-game-memory', maxMemoryMiB: 4096, initialMemoryMiB: 1024 }),
  ).toEqual({ type: 'set-game-memory', maxMemoryMiB: 4096, initialMemoryMiB: 1024 });
  expect(() => parseProductCommand({ type: 'set-game-memory', maxMemoryMiB: 512.5 })).toThrow(
    'invalid-request',
  );
});

it('limits log opening to no arguments and unregistered removal to exact mods paths', () => {
  expect(parseProductCommand({ type: 'open-logs' })).toEqual({ type: 'open-logs' });
  expect(
    parseProductCommand({ type: 'remove-unregistered', path: 'mods/nested/readme.txt' }),
  ).toEqual({ type: 'remove-unregistered', path: 'mods/nested/readme.txt' });
  for (const path of [
    '/tmp/file',
    'mods/../file',
    'mods/./file',
    'mods/file:stream',
    'mods/file\\bad',
    'mods/folder/',
    'mods/file.',
    'mods/ trailing ',
    'mods/‮file',
    'mods//file',
    'other/file',
  ]) {
    expect(() => parseProductCommand({ type: 'remove-unregistered', path })).toThrow(
      'invalid-request',
    );
  }
  for (const extra of [{ path: '/tmp' }, { url: 'https://example.org' }, { command: 'sh' }])
    expect(() => parseProductCommand({ type: 'open-logs', ...extra })).toThrow('invalid-request');
  expect(() =>
    parseProductCommand({ type: 'remove-unregistered', path: 'mods/a.txt', force: true }),
  ).toThrow('invalid-request');
});
