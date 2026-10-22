import type { BrowserWindow, IpcMain } from 'electron';
import { brandingChannel } from '../../shared/branding';
import { trustedProductSender } from '../product/ipc';
import type { BrandingService } from './service';

export function bindBrandingIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  rendererUrl: string,
  service: BrandingService,
): () => void {
  ipc.handle(brandingChannel, (event, ...args: unknown[]) => {
    if (!trustedProductSender(event, window, rendererUrl))
      throw new Error('Untrusted branding request');
    if (args.length) throw new Error('Invalid branding request');
    return service.snapshot();
  });
  return () => ipc.removeHandler(brandingChannel);
}
