import { isTrustedRendererUrl } from '@torchlauncher/core/desktop';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { StudioReply } from '../shared/studio.js';
import type { StudioService } from './studio.js';
export async function handleStudioRequest(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  contents: WebContents,
  rendererUrl: string,
  service: StudioService,
  input: unknown,
): Promise<StudioReply> {
  if (
    event.sender !== contents ||
    event.senderFrame !== contents.mainFrame ||
    !event.senderFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  )
    return { ok: false, code: 'UNTRUSTED' };
  return service.request(input);
}
