import type { LocalePreference } from '@torchlauncher/core/i18n';
import { createTranslator } from '@torchlauncher/core/i18n';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../../shared/updates';
import { launcherTranslations } from '../i18n/catalog';
import { buildLauncherMenus, type MenuEntry } from './MenuBar';

const t = createTranslator(launcherTranslations, 'en');
function entry(rows: ReturnType<typeof buildLauncherMenus>[number]['rows'], id: string) {
  const result = rows.find((row): row is MenuEntry => 'id' in row && row.id === id);
  if (!result) throw new Error(`Missing menu entry: ${id}`);
  return result;
}

function menus(preference: LocalePreference, state: UpdateState | null, pending = false) {
  const setLocale = vi.fn();
  const useAutomaticLocale = vi.fn();
  const onUpdateAction = vi.fn();
  const result = buildLauncherMenus({
    version: '1.2.3',
    locale: { preference, setLocale, useAutomaticLocale },
    updates: { state, pending },
    onUpdateAction,
    t,
  });
  return { result, setLocale, useAutomaticLocale, onUpdateAction };
}

describe('launcher menu definitions', () => {
  it('places language radio choices under View and applies explicit/system preferences', () => {
    const { result, setLocale, useAutomaticLocale } = menus(
      { mode: 'explicit', locale: 'en' },
      { phase: 'idle' },
    );
    const view = result[0];
    expect(view?.id).toBe('view');
    expect(view?.label).toBe('View');
    expect(entry(view?.rows ?? [], 'language-auto').radio).toBe(true);
    expect(entry(view?.rows ?? [], 'language-en').checked).toBe(true);
    expect(entry(view?.rows ?? [], 'language-ko').checked).toBe(false);
    entry(view?.rows ?? [], 'language-ko').onSelect();
    entry(view?.rows ?? [], 'language-auto').onSelect();
    expect(setLocale).toHaveBeenCalledWith('ko');
    expect(useAutomaticLocale).toHaveBeenCalledOnce();
  });

  it('shows version and only enables update after a newer release is available', () => {
    const { result, onUpdateAction } = menus(
      { mode: 'auto' },
      { phase: 'available', version: '1.3.0', size: 1024 },
    );
    const help = result[1];
    expect(help?.id).toBe('help');
    expect(help?.rows[0]).toMatchObject({ caption: 'Current version 1.2.3' });
    expect(entry(help?.rows ?? [], 'check-updates').disabled).toBe(false);
    expect(entry(help?.rows ?? [], 'download-update').disabled).toBe(false);
    entry(help?.rows ?? [], 'check-updates').onSelect();
    entry(help?.rows ?? [], 'download-update').onSelect();
    expect(onUpdateAction.mock.calls).toEqual([[{ action: 'check' }], [{ action: 'download' }]]);
    expect(
      entry(menus({ mode: 'auto' }, { phase: 'idle' }).result[1]?.rows ?? [], 'download-update')
        .disabled,
    ).toBe(true);
  });

  it('disables duplicate, initial, active, and unsupported update checks', () => {
    expect(
      entry(menus({ mode: 'auto' }, null).result[1]?.rows ?? [], 'check-updates').disabled,
    ).toBe(true);
    expect(
      entry(menus({ mode: 'auto' }, { phase: 'idle' }, true).result[1]?.rows ?? [], 'check-updates')
        .disabled,
    ).toBe(true);
    expect(
      entry(
        menus({ mode: 'auto' }, { phase: 'downloading', received: 2 }).result[1]?.rows ?? [],
        'check-updates',
      ).disabled,
    ).toBe(true);
    expect(
      entry(
        menus({ mode: 'auto' }, { phase: 'error', code: 'UNSUPPORTED_TARGET' }).result[1]?.rows ??
          [],
        'check-updates',
      ).disabled,
    ).toBe(true);
  });
});
