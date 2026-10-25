import type { Locale, LocalePreference } from '@torchlauncher/core/i18n';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { UpdateState } from '../../../shared/updates';
import type { useLauncherLocale } from '../i18n';
import { updateStatus } from './updateStatus';

export interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** `radio` items show a check mark and expose aria-checked. */
  checked?: boolean;
  radio?: boolean;
  onSelect(): void;
}
export type MenuRow = MenuEntry | { separator: true } | { caption: string; testId?: string };
export interface MenuDefinition {
  id: string;
  label: string;
  rows: MenuRow[];
}

const isEntry = (row: MenuRow): row is MenuEntry => 'id' in row;

/**
 * In-app menu bar (not the OS menu). Click or Arrow Down opens a menu, Left/Right move between
 * menus (also while one is open), Up/Down move between items, Enter/Space activate, Esc closes and
 * returns focus, and clicking outside closes. Disabled items stay focusable but never activate.
 */
export function MenuBar({ label, menus }: { label: string; menus: MenuDefinition[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const tops = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const baseId = useId();
  const active = menus.find((menu) => menu.id === open);
  const entries = active?.rows.filter(isEntry) ?? [];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  // Keyboard focus follows the highlighted item while a menu is open.
  useEffect(() => {
    if (open) items.current[focused]?.focus();
  }, [open, focused]);

  const openMenu = (id: string, index = 0) => {
    setFocused(index);
    setOpen(id);
  };
  const closeToTop = () => {
    const index = menus.findIndex((menu) => menu.id === open);
    setOpen(null);
    tops.current[Math.max(0, index)]?.focus();
  };
  const moveTop = (from: number, delta: number, keepOpen: boolean) => {
    const next = (from + delta + menus.length) % menus.length;
    const menu = menus[next];
    if (!menu) return;
    if (keepOpen) openMenu(menu.id);
    else tops.current[next]?.focus();
  };
  const activate = (entry: MenuEntry) => {
    if (entry.disabled) return;
    setOpen(null);
    tops.current[menus.findIndex((menu) => menu.id === active?.id)]?.focus();
    entry.onSelect();
  };

  const onTopKey = (event: KeyboardEvent, index: number, menu: MenuDefinition) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTop(index, event.key === 'ArrowRight' ? 1 : -1, open !== null);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const targetEntries = menu.rows.filter(isEntry).length;
      openMenu(menu.id, event.key === 'ArrowUp' ? Math.max(0, targetEntries - 1) : 0);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(null);
    }
  };
  const onItemKey = (event: KeyboardEvent, index: number) => {
    const topIndex = menus.findIndex((menu) => menu.id === open);
    const entry = entries[index];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocused((index + 1) % entries.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocused((index - 1 + entries.length) % entries.length);
        break;
      case 'Home':
        event.preventDefault();
        setFocused(0);
        break;
      case 'End':
        event.preventDefault();
        setFocused(entries.length - 1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        event.preventDefault();
        moveTop(topIndex, event.key === 'ArrowRight' ? 1 : -1, true);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (entry) activate(entry);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeToTop();
        break;
      case 'Tab':
        setOpen(null);
        break;
    }
  };

  let entryIndex = -1;
  return (
    <div className="menubar" ref={root} role="menubar" aria-label={label} data-testid="menubar">
      {menus.map((menu, index) => {
        const expanded = open === menu.id;
        return (
          <div className="mb-menu" key={menu.id}>
            <button
              type="button"
              ref={(element) => {
                tops.current[index] = element;
              }}
              className={`mb-top${expanded ? ' open' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? `${baseId}-${menu.id}` : undefined}
              data-testid={`menu-${menu.id}`}
              onClick={() => (expanded ? setOpen(null) : openMenu(menu.id))}
              onPointerEnter={() => {
                if (open && !expanded) openMenu(menu.id);
              }}
              onKeyDown={(event) => onTopKey(event, index, menu)}
            >
              {menu.label}
            </button>
            {expanded && (
              <div
                className="mb-panel"
                role="menu"
                id={`${baseId}-${menu.id}`}
                aria-label={menu.label}
              >
                {menu.rows.map((row) => {
                  if ('separator' in row)
                    return <hr key={`s${menu.rows.indexOf(row)}`} className="mb-sep" />;
                  if ('caption' in row)
                    return (
                      <div
                        key={`c${row.caption}`}
                        className="mb-cap"
                        role="presentation"
                        data-testid={row.testId}
                      >
                        {row.caption}
                      </div>
                    );
                  entryIndex += 1;
                  const at = entryIndex;
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: ARIA menu item with keyboard handling
                    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is only set for menuitemradio
                    <div
                      key={row.id}
                      ref={(element) => {
                        items.current[at] = element;
                      }}
                      className={`mb-item${row.disabled ? ' disabled' : ''}`}
                      role={row.radio ? 'menuitemradio' : 'menuitem'}
                      aria-checked={row.radio ? !!row.checked : undefined}
                      aria-disabled={row.disabled ? true : undefined}
                      tabIndex={at === focused ? 0 : -1}
                      data-testid={`menu-item-${row.id}`}
                      onClick={() => activate(row)}
                      onPointerEnter={() => setFocused(at)}
                      onKeyDown={(event) => onItemKey(event, at)}
                    >
                      <span className="mb-check" aria-hidden="true">
                        {row.radio && row.checked ? '✓' : ''}
                      </span>
                      <span className="mb-label">{row.label}</span>
                      {row.shortcut && <span className="mb-key">{row.shortcut}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type LocaleApi = ReturnType<typeof useLauncherLocale>;
export function buildLauncherMenus({
  version,
  locale,
  updates,
  onUpdateAction,
  t,
}: {
  version: string | null;
  locale: Pick<LocaleApi, 'preference' | 'setLocale' | 'useAutomaticLocale'>;
  updates: {
    state: UpdateState | null;
    pending: boolean;
  };
  onUpdateAction(request: { action: 'check' | 'download' }): void;
  t: LocaleApi['t'];
}): MenuDefinition[] {
  const choice: LocalePreference = locale.preference;
  const languageRows: MenuRow[] = [
    { caption: t('menubar.language') },
    { separator: true },
    {
      id: 'language-auto',
      label: t('menubar.system'),
      radio: true,
      checked: choice.mode === 'auto',
      onSelect: locale.useAutomaticLocale,
    },
    ...(['ko', 'en'] as Locale[]).map((value) => ({
      id: `language-${value}`,
      label: value === 'ko' ? '한국어' : 'English',
      radio: true,
      checked: choice.mode === 'explicit' && choice.locale === value,
      onSelect: () => locale.setLocale(value),
    })),
  ];
  const state = updates.state;
  const checking = updates.pending || !state || state.phase === 'checking';
  const downloading = updates.pending || state?.phase === 'downloading';
  const unsupported = state?.phase === 'error' && state.code === 'UNSUPPORTED_TARGET';
  const canDownload = state?.phase === 'available' && !updates.pending;
  const status = state ? updateStatus(t, state) : '';
  const helpRows: MenuRow[] = [
    { caption: t('help.version', { version: version ?? t('help.versionUnknown') }) },
    { separator: true },
    {
      id: 'check-updates',
      label: t('help.check'),
      disabled: checking || downloading || unsupported,
      onSelect: () => onUpdateAction({ action: 'check' }),
    },
    {
      id: 'download-update',
      label: t('help.update'),
      disabled: !canDownload,
      onSelect: () => onUpdateAction({ action: 'download' }),
    },
    ...(status
      ? [{ separator: true } as const, { caption: status, testId: 'update-menu-status' } as const]
      : []),
  ];
  return [
    { id: 'view', label: t('menubar.view'), rows: languageRows },
    { id: 'help', label: t('menubar.help'), rows: helpRows },
  ];
}

export function LauncherMenuBar(props: Parameters<typeof buildLauncherMenus>[0]) {
  return <MenuBar label={props.t('menubar.label')} menus={buildLauncherMenus(props)} />;
}
