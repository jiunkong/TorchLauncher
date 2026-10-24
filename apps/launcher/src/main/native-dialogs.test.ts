import { describe, expect, it, vi } from 'vitest';
import { createLauncherNativeDialogs } from './native-dialogs.js';

describe('Launcher native dialogs', () => {
  it('translates injected dialogs using the current locale', async () => {
    const showOpenDialog = vi
      .fn()
      .mockResolvedValue({ canceled: false, filePaths: ['/mods/a.jar'] });
    const showMessageBox = vi.fn().mockResolvedValue(undefined);
    const native = { showOpenDialog, showMessageBox };
    let locale: 'ko' | 'en' = 'ko';
    const dialogs = createLauncherNativeDialogs(native, () => locale);
    await expect(dialogs.chooseMod()).resolves.toBe('/mods/a.jar');
    expect(showOpenDialog.mock.calls[0]?.[0]).toMatchObject({
      title: '사용자 모드 추가',
      filters: [{ name: 'Minecraft 모드', extensions: ['jar'] }],
    });
    locale = 'en';
    await dialogs.showShutdownFailure();
    expect(showMessageBox.mock.calls[0]?.[0]).toEqual({
      type: 'error',
      message: 'The game did not stop cleanly. Close the launcher again in a moment.',
      buttons: ['OK'],
    });
  });
});
