import type { BrowserWindow, IpcMain } from 'electron';
import { parseUpdateCommand, updateCommandChannel, updateStateChannel } from '../../shared/updates';
import { trustedProductSender } from '../product/ipc';
import type { UpdateService } from './service';
export function bindUpdateIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  rendererUrl: string,
  service: UpdateService,
): () => void {
  const trusted = (event: Parameters<typeof trustedProductSender>[0]) => {
    if (!trustedProductSender(event, window, rendererUrl))
      throw new Error('Untrusted update request');
  };
  ipc.handle(updateStateChannel, (event, ...args: unknown[]) => {
    trusted(event);
    if (args.length) throw new Error('Invalid update request');
    return service.snapshot();
  });
  ipc.handle(updateCommandChannel, (event, ...args: unknown[]) => {
    trusted(event);
    if (args.length !== 1) throw new Error('Invalid update request');
    return service.command(parseUpdateCommand(args[0]));
  });
  const unsubscribe = service.subscribe((state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(updateStateChannel, state);
  });
  return () => {
    unsubscribe();
    ipc.removeHandler(updateStateChannel);
    ipc.removeHandler(updateCommandChannel);
  };
}
