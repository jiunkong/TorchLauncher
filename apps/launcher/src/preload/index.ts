import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';
import {
  type LauncherApi,
  type ProductState,
  productChannel,
  productStateChannel,
} from '../shared/product';

const api: LauncherApi = {
  getApplicationInfo: () => ipcRenderer.invoke(applicationInfoChannel),
  getState: () => ipcRenderer.invoke(productStateChannel),
  command: (command) => ipcRenderer.invoke(productChannel, command),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ProductState) => listener(state);
    ipcRenderer.on(productStateChannel, handler);
    return () => ipcRenderer.removeListener(productStateChannel, handler);
  },
};
contextBridge.exposeInMainWorld('torchlauncher', api);
