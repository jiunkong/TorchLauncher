import { isTrustedRendererUrl } from '@torchlauncher/core/desktop';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { StudioReply } from '../shared/studio.js';
import type { StudioMainLocale } from './i18n.js';
import type { StudioService } from './studio.js';
export async function handleStudioRequest(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  contents: WebContents,
  rendererUrl: string,
  service: StudioService,
  input: unknown,
  setLanguage?: (locale: StudioMainLocale) => void,
): Promise<StudioReply> {
  if (
    event.sender !== contents ||
    event.senderFrame !== contents.mainFrame ||
    !event.senderFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  )
    return { ok: false, code: 'UNTRUSTED' };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    if (value.action === 'setLanguage') {
      if (
        Reflect.ownKeys(value).length !== 2 ||
        !Object.hasOwn(value, 'action') ||
        !Object.hasOwn(value, 'language') ||
        (value.language !== 'ko' && value.language !== 'en')
      )
        return { ok: false, code: 'INVALID' };
      setLanguage?.(value.language);
      return { ok: true, state: service.snapshot() };
    }
  }
  return service.request(input);
}
