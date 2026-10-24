/**
 * Unsaved-changes flow against the main process (no native dialogs): the renderer shows its own
 * modal and then repeats `new`/`open` with `discard: true`, or answers a window-close request
 * with `closeConfirm` / `closeCancel`.
 */
import type { StudioAction, StudioController } from '../hooks/useStudio';

export type SwitchAction = Extract<StudioAction, 'new' | 'open'>;

export function runConfirmedSwitch(studio: StudioController, action: SwitchAction, name?: string) {
  return studio.run(action, name === undefined ? { discard: true } : { discard: true, name });
}

/** Main asks to close the window while the project has unsaved changes. */
export function onCloseRequest(handler: () => void): () => void {
  return window.torchlauncher.onCloseRequest(handler);
}

export const finishClose = (studio: StudioController) => studio.answerClose('closeConfirm');
export const cancelClose = (studio: StudioController) => studio.answerClose('closeCancel');
