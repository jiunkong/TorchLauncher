import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { contextBridge, ipcRenderer } from 'electron';
import { type BrandingSnapshot, brandingChangedChannel, brandingChannel } from '../shared/branding';
import {
  copyServerDataPathChannel,
  type LauncherApi,
  type ProductState,
  productChannel,
  productStateChannel,
} from '../shared/product';
import { type UpdateState, updateCommandChannel, updateStateChannel } from '../shared/updates';

const api: LauncherApi = {
  getUpdateState: () => ipcRenderer.invoke(updateStateChannel),
  update: (command) => ipcRenderer.invoke(updateCommandChannel, command),
  onUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on(updateStateChannel, handler);
    return () => ipcRenderer.removeListener(updateStateChannel, handler);
  },
  getApplicationInfo: () => ipcRenderer.invoke(applicationInfoChannel),
  getBranding: () => ipcRenderer.invoke(brandingChannel),
  onBranding: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: BrandingSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(brandingChangedChannel, handler);
    return () => ipcRenderer.removeListener(brandingChangedChannel, handler);
  },
  getState: () => ipcRenderer.invoke(productStateChannel),
  copyServerDataPath: () => ipcRenderer.invoke(copyServerDataPathChannel),
  command: (command) => ipcRenderer.invoke(productChannel, command),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ProductState) => listener(state);
    ipcRenderer.on(productStateChannel, handler);
    return () => ipcRenderer.removeListener(productStateChannel, handler);
  },
};
contextBridge.exposeInMainWorld('torchlauncher', api);
