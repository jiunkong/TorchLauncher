import { applicationInfoChannel, type DesktopApi } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';

const api: DesktopApi = {
  getApplicationInfo: () => ipcRenderer.invoke(applicationInfoChannel),
};

contextBridge.exposeInMainWorld('torchlauncher', api);
