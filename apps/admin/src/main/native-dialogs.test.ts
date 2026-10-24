import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createStudioNativeDialogs } from './native-dialogs.js';

describe('Studio native dialogs', () => {
  it('uses the active locale for injected save and open dialogs', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] });
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true });
    const native = { showOpenDialog, showSaveDialog };
    const window = {} as BrowserWindow;
    let locale: 'ko' | 'en' = 'ko';
    const dialogs = createStudioNativeDialogs(native, window, () => locale);

    await dialogs.save('project');
    expect(showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      title: '프로젝트 저장',
      defaultPath: 'server-project.torchproj',
      filters: [{ name: 'TorchLauncher Studio 파일', extensions: ['torchproj'] }],
    });

    locale = 'en';
    await dialogs.save('project');
    expect(showSaveDialog.mock.calls[1]?.[1]).toMatchObject({
      title: 'Save project',
      defaultPath: 'server-project.torchproj',
      filters: [{ name: 'TorchLauncher Studio file', extensions: ['torchproj'] }],
    });
    await dialogs.open('keybackup');
    expect(showOpenDialog.mock.calls[0]?.[1]).toMatchObject({
      title: 'Choose signing key backup file',
      filters: [{ name: 'Signing key backup', extensions: ['torchkey'] }],
    });
  });
});
