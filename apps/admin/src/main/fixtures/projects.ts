import { rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/**
 * Creates a new project folder at exactly `dir` through the real `new` command: the parent picker
 * is mocked to return `dirname(dir)` and the project name is `basename(dir)`. A leftover empty
 * directory at `dir` (from a temp helper) is removed first because New never writes into an
 * existing folder.
 */
export async function createProjectAt(
  service: { request(command: unknown): Promise<unknown> },
  dialogs: { open: { mockResolvedValueOnce(value: string[]): unknown } },
  dir: string,
  extra: { discard?: boolean } = { discard: true },
): Promise<unknown> {
  await rm(dir, { recursive: true, force: true });
  dialogs.open.mockResolvedValueOnce([dirname(dir)]);
  return service.request({ action: 'new', name: basename(dir), ...extra });
}
