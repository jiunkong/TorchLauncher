import { isTrustedRendererUrl } from '@torchlauncher/core/desktop';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { productChannel, productStateChannel } from '../../shared/product';
import type { ProductService } from './service';

export function trustedProductSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow,
  rendererUrl: string,
): boolean {
  return (
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    !!event.senderFrame &&
    isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  );
}
export function bindProductIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  rendererUrl: string,
  service: ProductService,
): () => void {
  const check = (event: IpcMainInvokeEvent) => {
    if (!trustedProductSender(event, window, rendererUrl))
      throw new Error('Untrusted product request');
  };
  ipc.handle(productChannel, (event, command: unknown) => {
    check(event);
    return service.command(command);
  });
  ipc.handle(productStateChannel, (event, ...args: unknown[]) => {
    check(event);
    if (args.length) throw new Error('Invalid state request');
    return service.snapshot();
  });
  return () => {
    ipc.removeHandler(productChannel);
    ipc.removeHandler(productStateChannel);
  };
}
