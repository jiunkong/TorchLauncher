import { useState } from 'react';
import type { SettingPolicyChoice } from '../../../shared/studio.js';

export type SettingsTab = 'keys' | 'options' | 'config' | 'packs' | 'shaders';
export type KeyFilter = 'all' | 'base' | 'mod' | 'set';

/** View state of the game-settings page (selection, tab, search); the data lives in the project. */
export function useSettingsState() {
  const [tab, setTab] = useState<SettingsTab>('keys');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<KeyFilter>('all');
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return { tab, setTab, selected, setSelected, toggle, search, setSearch, filter, setFilter };
}
export type SettingsState = ReturnType<typeof useSettingsState>;

/** Rows are filtered by key text and by the chip filter. */
export function matchesKey(
  entry: { id: string; mod: boolean },
  query: string,
  filter: KeyFilter,
  policy: SettingPolicyChoice,
): boolean {
  if (filter === 'base' && entry.mod) return false;
  if (filter === 'mod' && !entry.mod) return false;
  if (filter === 'set' && policy === 'none') return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return entry.id.toLowerCase().includes(needle);
}

/** Display name of an options.txt key: `key_key.jump` -> `key.jump`. */
export function optionLabel(key: string): string {
  return key.startsWith('key_') ? key.slice(4) : key;
}
