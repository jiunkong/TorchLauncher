/** Renderer-safe update contract: no filesystem paths, release URLs or raw errors. */
export type UpdateErrorCode =
  | 'LAUNCHER_UNCONFIGURED'
  | 'LAUNCHER_OFFLINE'
  | 'LAUNCHER_NO_RELEASE'
  | 'LAUNCHER_NO_ASSET'
  | 'LAUNCHER_RELEASE_FAILED'
  | 'LAUNCHER_VERIFY'
  | 'INVALID'
  | 'IO'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TARGET'
  | 'NO_UPDATE'
  | 'UNAVAILABLE';
export type UpdateState =
  | { phase: 'idle' | 'checking' | 'current' | 'cancelled' }
  | { phase: 'available'; version: string; size: number }
  | { phase: 'downloading'; received: number }
  | { phase: 'downloaded'; version: string; size: number }
  | { phase: 'error'; code: UpdateErrorCode };
export type UpdateCommand = { action: 'check' | 'download' };
export const updateStateChannel = 'launcher:update-state';
export const updateCommandChannel = 'launcher:update-command';
export interface UpdateApi {
  getUpdateState(): Promise<UpdateState>;
  update(command: UpdateCommand): Promise<UpdateState>;
  onUpdate(listener: (state: UpdateState) => void): () => void;
}
export function parseUpdateCommand(value: unknown): UpdateCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid update request');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 1 ||
    !Object.hasOwn(data, 'action') ||
    (data.action !== 'check' && data.action !== 'download')
  )
    throw new Error('Invalid update request');
  return { action: data.action };
}
