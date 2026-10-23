import { useState } from 'react';
import type { Policy3 } from '../components/ui';
import { samplePacks, sampleShaders } from './fixtures';

export type SettingsTab = 'keys' | 'options' | 'packs' | 'shaders';
export type KeyFilter = 'all' | 'base' | 'mod' | 'set';

/** Local, non-persistent state of the game-settings page (nothing is saved or deployed yet). */
export function useSettingsState() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('keys');
  const [policies, setPolicies] = useState<Readonly<Record<string, Policy3>>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<KeyFilter>('all');
  const [packOrder, setPackOrder] = useState(() => samplePacks.map((pack) => pack.id));
  const [shader, setShader] = useState(sampleShaders[0]?.id ?? '');
  const [shaderEnabled, setShaderEnabled] = useState(true);

  const policyOf = (id: string): Policy3 => policies[id] ?? 'none';
  const setPolicy = (ids: Iterable<string>, value: Policy3) =>
    setPolicies((current) => {
      const next = { ...current };
      for (const id of ids) {
        if (value === 'none') delete next[id];
        else next[id] = value;
      }
      return next;
    });
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const movePack = (id: string, delta: -1 | 1) =>
    setPackOrder((current) => {
      const from = current.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (item !== undefined) next.splice(to, 0, item);
      return next;
    });
  return {
    loaded,
    load: () => setLoaded(true),
    tab,
    setTab,
    policyOf,
    setPolicy,
    selected,
    toggle,
    setSelected,
    search,
    setSearch,
    filter,
    setFilter,
    packOrder,
    movePack,
    shader,
    setShader,
    shaderEnabled,
    setShaderEnabled,
  };
}
export type SettingsState = ReturnType<typeof useSettingsState>;

/** Rows are filtered by name/key text and by the chip filter. */
export function matchesKey(
  entry: { id: string; name: string | null; mod: boolean },
  query: string,
  filter: KeyFilter,
  policy: Policy3,
): boolean {
  if (filter === 'base' && entry.mod) return false;
  if (filter === 'mod' && !entry.mod) return false;
  if (filter === 'set' && policy === 'none') return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.name ?? ''} ${entry.id}`.toLowerCase().includes(needle);
}
