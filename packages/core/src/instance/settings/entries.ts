import { OptionsDocument } from './options.js';
import { PropertiesDocument } from './properties.js';

/** What a Studio list row is: a vanilla keybind, a keybind added by a mod, or anything else. */
export type SettingEntryKind = 'keybind' | 'mod-keybind' | 'other';
export type SettingValueType = 'boolean' | 'number' | 'json' | 'text';

export interface SettingEntry {
  key: string;
  value: string;
  kind: SettingEntryKind;
  /**
   * Stable group id. Vanilla keybinds: movement, gameplay, inventory, multiplayer, miscellaneous,
   * creative. Mod keybinds: the first segment of the translation key (usually the mod id). Other
   * options.txt entries: sound, video, controls, chat, skin, resource-packs or general.
   */
  group: string;
  valueType: SettingValueType;
  /** Owned by the game or by a dedicated policy section; Studio should not offer it as a plain item. */
  reserved: boolean;
}

/** Vanilla (1.21.1) keybind names after `key_` with their category. */
const VANILLA_KEYBINDS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  const add = (group: string, names: readonly string[]) => {
    for (const name of names) map[`key.${name}`] = group;
  };
  add('movement', ['forward', 'left', 'back', 'right', 'jump', 'sneak', 'sprint']);
  add('gameplay', ['attack', 'use', 'pickItem']);
  add('inventory', [
    'drop',
    'inventory',
    'swapOffhand',
    ...Array.from({ length: 9 }, (_, i) => `hotbar.${i + 1}`),
  ]);
  add('multiplayer', ['chat', 'playerlist', 'command', 'socialInteractions']);
  add('miscellaneous', [
    'screenshot',
    'togglePerspective',
    'smoothCamera',
    'fullscreen',
    'spectatorOutlines',
    'advancements',
  ]);
  add('creative', ['saveToolbarActivator', 'loadToolbarActivator']);
  return map;
})();

const RESERVED_OPTIONS: ReadonlySet<string> = new Set([
  'version',
  'resourcePacks',
  'incompatibleResourcePacks',
]);

const OTHER_GROUPS: readonly (readonly [string, RegExp])[] = [
  [
    'sound',
    /^(soundCategory_|soundDevice$|directionalAudio$|showSubtitles$|musicToast$|musicFrequency$)/,
  ],
  ['skin', /^(modelPart_|mainHand$)/],
  ['chat', /^(chat|autoSuggestions$|narrator|highContrast|allowServerListing|onlyShowSecureChat)/],
  [
    'controls',
    /^(mouse|invertYMouse$|autoJump$|toggle|sensitivity$|touchscreen$|rawMouseInput$|discrete_mouse_scroll$|operatorItemsTab$|attackIndicator$)/,
  ],
  [
    'video',
    /^(renderDistance$|simulationDistance$|maxFps$|fullscreen|enableVsync$|graphics|guiScale$|gamma$|fov|particles$|renderClouds$|ao$|mipmapLevels$|biomeBlendRadius$|entity|bobView$|cloudRadius$|darknessEffectScale$|glint|screenEffectScale$|prioritizeChunkUpdates$|inactivityFpsLimit$|framerateLimit$|overrideWidth$|overrideHeight$)/,
  ],
];

function valueTypeOf(value: string): SettingValueType {
  if (value === 'true' || value === 'false') return 'boolean';
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return 'number';
  if (value.startsWith('[') || value.startsWith('{')) return 'json';
  return 'text';
}

/** Classify one options.txt key (pure; exported for Studio rows built from other sources). */
export function classifyOptionKey(key: string): Pick<SettingEntry, 'kind' | 'group' | 'reserved'> {
  if (key.startsWith('key_')) {
    const name = key.slice(4);
    const vanilla = VANILLA_KEYBINDS[name];
    if (vanilla !== undefined) return { kind: 'keybind', group: vanilla, reserved: false };
    const trimmed = name.startsWith('key.') ? name.slice(4) : name;
    return { kind: 'mod-keybind', group: trimmed.split('.')[0] || 'unknown', reserved: false };
  }
  const reserved = RESERVED_OPTIONS.has(key);
  if (reserved)
    return { kind: 'other', group: key === 'version' ? 'general' : 'resource-packs', reserved };
  const group = OTHER_GROUPS.find(([, pattern]) => pattern.test(key))?.[0] ?? 'general';
  return { kind: 'other', group, reserved };
}

function bytesOf(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

/**
 * Parse options.txt into typed rows in file order. Same strictness as the launcher: non-UTF-8,
 * NUL, duplicate keys or more than 1 MiB throw `SettingsError` (`invalid-options` /
 * `limit-exceeded`). Lines without a `key:` prefix (comments, blanks) are not entries.
 */
export function parseOptionsEntries(input: Uint8Array | string): SettingEntry[] {
  return OptionsDocument.parse(bytesOf(input))
    .entries()
    .map(([key, value]) => ({
      key,
      value,
      ...classifyOptionKey(key),
      valueType: valueTypeOf(value),
    }));
}

/**
 * Parse a `key=value` file (Iris `iris.properties`, `shaderpacks/<pack>.txt`, simple mod configs)
 * into typed rows in file order. Throws `invalid-config` for forms the policy cannot edit safely.
 */
export function parsePropertiesEntries(input: Uint8Array | string): SettingEntry[] {
  return PropertiesDocument.parse(bytesOf(input))
    .entries()
    .map(([key, value]) => ({
      key,
      value,
      kind: 'other' as const,
      group: 'general',
      valueType: valueTypeOf(value),
      reserved: false,
    }));
}

const KIND_ORDER: Record<SettingEntryKind, number> = { keybind: 0, 'mod-keybind': 1, other: 2 };
const VANILLA_GROUP_ORDER = [
  'movement',
  'gameplay',
  'inventory',
  'multiplayer',
  'miscellaneous',
  'creative',
];

/** Deterministic display order: kind, then group (vanilla categories in game order), then key. */
export function sortSettingEntries(entries: readonly SettingEntry[]): SettingEntry[] {
  const rank = (e: SettingEntry) => {
    const i = VANILLA_GROUP_ORDER.indexOf(e.group);
    return e.kind === 'keybind' && i >= 0 ? i : 0;
  };
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...entries].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      rank(a) - rank(b) ||
      cmp(a.group, b.group) ||
      cmp(a.key, b.key),
  );
}
