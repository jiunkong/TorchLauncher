import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';
import { type StudioApi, studioChannel, studioCloseChannel } from '../shared/studio.js';
import { type UpdateState, updateCommandChannel, updateStateChannel } from '../shared/updates';

const api: StudioApi = {
  getUpdateState: () => ipcRenderer.invoke(updateStateChannel),
  update: (command) => ipcRenderer.invoke(updateCommandChannel, command),
  onUpdate: (listener) => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on(updateStateChannel, handler);
    return () => ipcRenderer.removeListener(updateStateChannel, handler);
  },
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
