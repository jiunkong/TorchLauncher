/**
 * Unsaved-changes flow against the main process (no native dialogs): the renderer shows its own
 * modal and then repeats `new`/`open` with `discard: true`, or answers a window-close request
 * with `closeConfirm` / `closeCancel`.
 */
import type { StudioAction, StudioController } from '../hooks/useStudio';

export type SwitchAction = Extract<StudioAction, 'new' | 'open'>;

export function runConfirmedSwitch(studio: StudioController, action: SwitchAction) {
  return studio.run(action, { discard: true });
}

/** Main asks to close the window while the project has unsaved changes. */
export function onCloseRequest(handler: () => void): () => void {
  return window.torchlauncher.onCloseRequest(handler);
}

export const finishClose = (studio: StudioController) => studio.answerClose('closeConfirm');
export const cancelClose = (studio: StudioController) => studio.answerClose('closeCancel');

/**
 * Save-then-close. While a close request is outstanding main answers every other command with
 * BUSY, so the request is cancelled first, the project saved, and the window closed again (a
 * clean project closes without asking). STUDIO-MAIN could accept `save` during a close request
 * to make this a single step.
 */
export async function saveThenClose(studio: StudioController): Promise<boolean> {
  await studio.answerClose('closeCancel');
  if (!(await studio.run('save'))) return false;
  window.close();
  return true;
}
