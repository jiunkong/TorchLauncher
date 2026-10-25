import type { StudioRequest } from '../../../shared/studio.js';

export const operationKeys = {
  new: 'op.new',
  open: 'op.open',
  save: 'op.save',
  saveAs: 'op.save',
  source: 'op.source',
  files: 'op.files',
  build: 'op.build',
  check: 'op.check',
  export: 'op.export',
  cancel: 'op.new',
  saving: 'op.save',
  opening: 'op.open',
  choosing: 'op.choosing',
  building: 'op.build',
  checking: 'op.check',
  exporting: 'op.export',
  work: 'op.work',
  rescan: 'op.rescan',
  exportCheck: 'op.check',
  // These open a file picker first; the service reports them as "choosing" until they finish.
  settingsImport: 'op.choosing',
  settingsImportOptions: 'op.settings',
  settingsPackAdd: 'op.choosing',
} as const;

export type OperationAction = keyof typeof operationKeys;
export type OperationLabelKey = (typeof operationKeys)[OperationAction];

/**
 * Busy-banner label for a request that is about to run. Only a test-result import reads
 * without a picker; a file-based import shows the picker label for its whole run, because the
 * service does not report the picker-to-read transition.
 */
export function operationLabelKey(request: StudioRequest): OperationLabelKey | null {
  if (request.action === 'settingsImportOptions')
    return request.source === 'file' ? 'op.choosing' : 'op.settings';
  if (!(request.action in operationKeys)) return null;
  return operationKeys[request.action as OperationAction];
}
