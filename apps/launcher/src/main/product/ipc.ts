import { isTrustedRendererUrl } from '@torchlauncher/core/desktop';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  copyServerDataPathChannel,
  parseProductCommand,
  productChannel,
  productStateChannel,
} from '../../shared/product';
import type { LauncherMainLocale } from '../i18n';
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
  copyText?: (text: string) => void | Promise<void>,
  setLanguage?: (locale: LauncherMainLocale) => void,
): () => void {
  const check = (event: IpcMainInvokeEvent) => {
    if (!trustedProductSender(event, window, rendererUrl))
      throw new Error('Untrusted product request');
  };
  ipc.handle(productChannel, (event, command: unknown) => {
    check(event);
    if (command && typeof command === 'object' && !Array.isArray(command)) {
      const value = command as Record<string, unknown>;
      if (value.type === 'set-language') {
        const parsed = parseProductCommand(command);
        if (parsed.type !== 'set-language') throw new Error('Invalid language command');
        setLanguage?.(parsed.language);
        return { ok: true, state: service.snapshot() };
      }
    }
    return service.command(command);
  });
  ipc.handle(productStateChannel, (event, ...args: unknown[]) => {
    check(event);
    if (args.length) throw new Error('Invalid state request');
    return service.snapshot();
  });
  ipc.handle(copyServerDataPathChannel, async (event, ...args: unknown[]) => {
    check(event);
    if (args.length) throw new Error('Invalid path copy request');
    try {
      const path = service.snapshot().serverDataRoot;
      if (!copyText || typeof path !== 'string' || !path) return false;
      await copyText(path);
      return true;
    } catch {
      return false;
    }
  });
  return () => {
    ipc.removeHandler(productChannel);
    ipc.removeHandler(productStateChannel);
    ipc.removeHandler(copyServerDataPathChannel);
  };
}
