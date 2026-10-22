import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';
import { type StudioApi, studioChannel } from '../shared/studio.js';

const api: StudioApi = {
  request: (command) => ipcRenderer.invoke(studioChannel, command),
  getApplicationInfo: () => ipcRenderer.invoke(applicationInfoChannel),
};

contextBridge.exposeInMainWorld('torchlauncher', api);
