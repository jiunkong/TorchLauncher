import { describe, expect, it } from 'vitest';
import { studioTranslations } from '../i18n/catalog';
import { operationLabelKey } from './operations';

describe('operation labels', () => {
  it('shows the picker label while a pack add waits for the file picker', () => {
    expect(operationLabelKey({ action: 'settingsPackAdd', kind: 'mod' })).toBe('op.choosing');
    expect(operationLabelKey({ action: 'settingsPackAdd', kind: 'shaderpack' })).toBe(
      'op.choosing',
    );
    expect(studioTranslations.en['op.choosing']).toBe('Waiting for a selection…');
  });
  it('shows the picker label for file-based imports and the reading label for test results', () => {
    expect(operationLabelKey({ action: 'settingsImport', source: 'folder' })).toBe('op.choosing');
    expect(operationLabelKey({ action: 'settingsImportOptions', source: 'file' })).toBe(
      'op.choosing',
    );
    expect(operationLabelKey({ action: 'settingsImportOptions', source: 'test' })).toBe(
      'op.settings',
    );
  });
  it('keeps other commands on their own labels and ignores non-operations', () => {
    expect(operationLabelKey({ action: 'save' })).toBe('op.save');
    expect(operationLabelKey({ action: 'state' })).toBeNull();
  });
});
