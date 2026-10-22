export interface PackItem {
  id: string;
  required: boolean;
}

/**
 * Display order of the active packs. Server-required packs keep their current positions; only the
 * user's packs are reordered, following `draft` (a user-pack order) where it still applies.
 * Packs that disappeared from `current` are dropped from the draft and new ones are appended.
 */
export function arrangePacks(
  current: readonly PackItem[],
  draft: readonly string[] | null,
): PackItem[] {
  if (draft === null) return [...current];
  const users = new Map(current.filter((pack) => !pack.required).map((pack) => [pack.id, pack]));
  const ordered: PackItem[] = [];
  for (const id of draft) {
    const pack = users.get(id);
    if (pack) {
      ordered.push(pack);
      users.delete(id);
    }
  }
  ordered.push(...users.values());
  let next = 0;
  return current.map((pack) => (pack.required ? pack : (ordered[next++] ?? pack)));
}

/** Swaps the user pack at `index` with the neighbouring user pack in `direction`; others stay put. */
export function movePack(packs: readonly PackItem[], index: number, direction: -1 | 1): PackItem[] {
  const result = [...packs];
  const moving = result[index];
  if (!moving || moving.required) return result;
  let target = index + direction;
  while (result[target]?.required) target += direction;
  const other = result[target];
  if (!other) return result;
  result[index] = other;
  result[target] = moving;
  return result;
}

export const packIds = (packs: readonly PackItem[]) => packs.map((pack) => pack.id);

/** Whether a user pack has a user-pack neighbour in `direction`. */
export function canMove(packs: readonly PackItem[], index: number, direction: -1 | 1): boolean {
  if (packs[index]?.required !== false) return false;
  for (let at = index + direction; at >= 0 && at < packs.length; at += direction)
    if (packs[at]?.required === false) return true;
  return false;
}
