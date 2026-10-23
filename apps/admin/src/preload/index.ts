import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';
import { type StudioApi, studioChannel, studioCloseChannel } from '../shared/studio.js';

const api: StudioApi = {
  request: (command) => ipcRenderer.invoke(studioChannel, command),
  onCloseRequest: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(studioCloseChannel, handler);
    return () => {
      ipcRenderer.removeListener(studioCloseChannel, handler);
    };
  },
  getApplicationInfo: () => ipcRenderer.invoke(applicationInfoChannel),
};

contextBridge.exposeInMainWorld('torchlauncher', api);
