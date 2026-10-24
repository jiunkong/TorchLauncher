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

    await dialogs.open('project');
    expect(showOpenDialog.mock.calls[0]?.[1]).toMatchObject({
      title: '프로젝트 폴더 열기',
      properties: ['openDirectory'],
    });

    await dialogs.open('projectparent');
    expect(showOpenDialog.mock.calls[1]?.[1]).toMatchObject({
      title: '프로젝트 폴더를 만들 위치 선택',
      properties: ['openDirectory', 'createDirectory'],
    });

    await dialogs.save('pack');
    expect(showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      title: 'torchpack 생성',
      defaultPath: 'server.torchpack',
      filters: [{ name: '배포 파일', extensions: ['torchpack'] }],
    });

    locale = 'en';
    await dialogs.open('project');
    expect(showOpenDialog.mock.calls[2]?.[1]).toMatchObject({
      title: 'Open project folder',
      properties: ['openDirectory'],
    });
    await dialogs.open('keybackup');
    expect(showOpenDialog.mock.calls[3]?.[1]).toMatchObject({
      title: 'Choose signing key backup file',
      filters: [{ name: 'Signing key backup', extensions: ['torchkey'] }],
    });
    await dialogs.open('mod');
    expect(showOpenDialog.mock.calls[4]?.[1]).toMatchObject({
      title: 'Choose a mod (.jar)',
      filters: [{ name: 'Java archive', extensions: ['jar'] }],
    });
  });
});
