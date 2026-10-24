import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import {
  copyServerDataPathChannel,
  parseProductCommand,
  productChannel,
} from '../../shared/product';
import { bindProductIpc, trustedProductSender } from './ipc';
import type { ProductService } from './service';

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
it('validates the exact language command and updates locale only for a trusted frame', async () => {
  expect(parseProductCommand({ type: 'set-language', language: 'ko' })).toEqual({
    type: 'set-language',
    language: 'ko',
  });
  for (const invalid of [
    { type: 'set-language', language: 'fr' },
    { type: 'set-language', language: 'en', extra: true },
    { type: 'set-language' },
  ])
    expect(() => parseProductCommand(invalid)).toThrow('invalid-request');

  const frame = { url: 'file:///application/index.html' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const handle = vi.fn();
  const setLanguage = vi.fn();
  const service = { snapshot: () => ({}) } as ProductService;
  bindProductIpc(
    { handle, removeHandler: vi.fn() } as unknown as IpcMain,
    window,
    frame.url,
    service,
    undefined,
    setLanguage,
  );
  const invoke = handle.mock.calls.find(([channel]) => channel === productChannel)?.[1] as (
    event: IpcMainInvokeEvent,
    command: unknown,
  ) => unknown;
  expect(
    invoke({ sender: contents, senderFrame: frame } as IpcMainInvokeEvent, {
      type: 'set-language',
      language: 'en',
    }),
  ).toMatchObject({ ok: true });
  expect(setLanguage).toHaveBeenCalledExactlyOnceWith('en');
  expect(() =>
    invoke({ sender: {}, senderFrame: frame } as IpcMainInvokeEvent, {
      type: 'set-language',
      language: 'ko',
    }),
  ).toThrow('Untrusted');
  expect(setLanguage).toHaveBeenCalledOnce();
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

it('accepts the login code copy command only without arguments', () => {
  expect(parseProductCommand({ type: 'copy-login-code' })).toEqual({ type: 'copy-login-code' });
  for (const extra of [{ code: 'ABCD-1234' }, { text: 'x' }, { path: '/tmp' }])
    expect(() => parseProductCommand({ type: 'copy-login-code', ...extra })).toThrow(
      'invalid-request',
    );
});

it('copies only the current main-process data root through trusted no-argument IPC', async () => {
  const frame = { url: 'file:///application/index.html' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const handle = vi.fn();
  const removeHandler = vi.fn();
  const copy = vi.fn();
  let root: string | null = [
    'C:',
    'Users',
    '긴 사용자 이름',
    ...Array(12).fill('긴 서버 폴더'),
  ].join(String.fromCharCode(92));
  const service = { snapshot: () => ({ serverDataRoot: root }) } as ProductService;
  const unbind = bindProductIpc(
    { handle, removeHandler } as unknown as IpcMain,
    window,
    frame.url,
    service,
    copy,
  );
  const invoke = handle.mock.calls.find(
    ([channel]) => channel === copyServerDataPathChannel,
  )?.[1] as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<boolean>;
  await expect(invoke(event)).resolves.toBe(true);
  expect(copy).toHaveBeenCalledExactlyOnceWith(root);
  root = '/new/current/server/root';
  await expect(invoke(event)).resolves.toBe(true);
  expect(copy).toHaveBeenLastCalledWith(root);
  const count = copy.mock.calls.length;
  for (const value of [
    undefined,
    '/arbitrary/path',
    { path: '/outside' },
    { text: 'arbitrary clipboard text' },
  ])
    await expect(invoke(event, value)).rejects.toThrow('Invalid path copy request');
  await expect(invoke({ ...event, sender: {} } as IpcMainInvokeEvent)).rejects.toThrow('Untrusted');
  await expect(
    invoke({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent),
  ).rejects.toThrow('Untrusted');
  frame.url = 'https://example.invalid';
  await expect(invoke(event)).rejects.toThrow('Untrusted');
  frame.url = 'file:///application/index.html';
  root = null;
  await expect(invoke(event)).resolves.toBe(false);
  expect(copy).toHaveBeenCalledTimes(count);
  root = '/safe/root';
  copy.mockRejectedValue(new Error('private backend failure'));
  await expect(invoke(event)).resolves.toBe(false);
  unbind();
  expect(removeHandler).toHaveBeenCalledWith(copyServerDataPathChannel);
});
it('reports a missing main copy backend without attempting any clipboard operation', async () => {
  const frame = { url: 'file:///application/index.html' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const handle = vi.fn();
  bindProductIpc({ handle, removeHandler: vi.fn() } as unknown as IpcMain, window, frame.url, {
    snapshot: () => ({ serverDataRoot: '/root' }),
  } as ProductService);
  const invoke = handle.mock.calls.find(([channel]) => channel === copyServerDataPathChannel)?.[1];
  await expect(invoke({ sender: contents, senderFrame: frame })).resolves.toBe(false);
});
