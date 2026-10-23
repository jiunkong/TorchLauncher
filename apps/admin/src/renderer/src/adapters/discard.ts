/**
 * Seam for the unsaved-changes flow. The confirmation itself is an in-app modal (no native
 * dialogs). Today the main process still asks natively when a dirty project is replaced or the
 * window closes; STUDIO-MAIN-01 replaces that with a renderer-confirmed command and a
 * close-request event. STUDIO-UI-02 then changes only this file:
 *  - `runConfirmedSwitch`: send the new command that says "the user already confirmed discarding".
 *  - `onCloseRequest`: subscribe to the main-process close request.
 *  - `finishClose`: tell main the user chose to close (after saving or discarding).
 */
import type { StudioAction, StudioController } from '../hooks/useStudio';

export type SwitchAction = Extract<StudioAction, 'new' | 'open'>;

export function runConfirmedSwitch(studio: StudioController, action: SwitchAction) {
  return studio.run(action);
}

/** No close-request event exists yet: returns an unsubscribe no-op. */
export function onCloseRequest(_handler: () => void): () => void {
  return () => {};
}

/** Placeholder until the close-confirmation command exists. */
export async function finishClose(): Promise<void> {}
