import { validPackId } from './policy.js';
import { SETTINGS_LIMITS, SettingsError } from './types.js';

interface Line {
  text: string;
  eol: string;
  /** Present for `key:value` lines. */
  key?: string;
}

/** Line-preserving model of options.txt. Unknown lines, order, BOM and line endings survive edits. */
export class OptionsDocument {
  private constructor(
    private readonly lines: Line[],
    private readonly bom: string,
    private newline: string,
  ) {}

  static empty(): OptionsDocument {
    return new OptionsDocument([], '', '\n');
  }

  static parse(bytes: Uint8Array): OptionsDocument {
    if (bytes.byteLength > SETTINGS_LIMITS.optionsBytes)
      throw new SettingsError('limit-exceeded', 'options.txt is too large');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (cause) {
      throw new SettingsError('invalid-options', 'options.txt is not UTF-8', { cause });
    }
    if (text.includes('\0')) throw new SettingsError('invalid-options', 'options.txt contains NUL');
    const bom = text.startsWith('﻿') ? '﻿' : '';
    const body = text.slice(bom.length);
    const lines: Line[] = [];
    const seen = new Set<string>();
    let newline = '';
    for (const match of body.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
      const [, content = '', eol = ''] = match;
      if (content === '' && eol === '') break;
      if (!newline && eol) newline = eol;
      const colon = content.indexOf(':');
      const line: Line = { text: content, eol };
      if (colon > 0) {
        const key = content.slice(0, colon);
        if (seen.has(key))
          throw new SettingsError('invalid-options', `duplicate options.txt key: ${key}`);
        seen.add(key);
        line.key = key;
      }
      lines.push(line);
    }
    return new OptionsDocument(lines, bom, newline || '\n');
  }

  get(key: string): string | undefined {
    const line = this.lines.find((l) => l.key === key);
    return line?.key === undefined ? undefined : line.text.slice(key.length + 1);
  }

  /** Key/value pairs in file order. */
  entries(): [string, string][] {
    const out: [string, string][] = [];
    for (const line of this.lines)
      if (line.key !== undefined) out.push([line.key, line.text.slice(line.key.length + 1)]);
    return out;
  }

  /** Returns true when the document changed. */
  set(key: string, value: string): boolean {
    const line = this.lines.find((l) => l.key === key);
    if (line) {
      if (line.text.slice(key.length + 1) === value) return false;
      line.text = `${key}:${value}`;
      return true;
    }
    const last = this.lines.at(-1);
    if (last && last.eol === '') last.eol = this.newline;
    this.lines.push({ text: `${key}:${value}`, eol: this.newline, key });
    return true;
  }

  serialize(): Uint8Array {
    const text = this.bom + this.lines.map((l) => l.text + l.eol).join('');
    return new TextEncoder().encode(text);
  }
}

/**
 * Active list assumed when options.txt has no resourcePacks entry: `[]` (wiki default; a real
 * 1.21.1 client writes `resourcePacks:[]`, the built-in vanilla pack is implicit). Profiles own
 * the per-version value; this export is kept for compatibility.
 */
export const DEFAULT_PACKS: readonly string[] = [];

export function readPackList(doc: OptionsDocument): string[] | undefined {
  const raw = doc.get('resourcePacks');
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new SettingsError('invalid-options', 'resourcePacks is not valid JSON', { cause });
  }
  if (!Array.isArray(value) || value.length > SETTINGS_LIMITS.packsPerList)
    throw new SettingsError('invalid-options', 'resourcePacks must be a bounded array');
  const out: string[] = [];
  for (const id of value) {
    if (!validPackId(id)) throw new SettingsError('invalid-options', 'invalid resource pack id');
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function writePackList(doc: OptionsDocument, packs: readonly string[]): boolean {
  return doc.set('resourcePacks', JSON.stringify(packs));
}

export interface PackMerge {
  packs: string[];
  added: string[];
  reordered: boolean;
}

/**
 * Required packs stay in the operator's relative order. Existing required packs keep their slots
 * (swapped into order if needed), user packs never move relative to each other, and missing
 * required packs are inserted after their operator-order predecessor (or before their successor,
 * or at the end when none is present).
 */
export function mergeRequiredPacks(
  current: readonly string[],
  required: readonly string[],
): PackMerge {
  const result = [...current];
  const req = new Set(required);
  const slots: number[] = [];
  result.forEach((id, index) => {
    if (req.has(id)) slots.push(index);
  });
  const presentInOrder = required.filter((id) => result.includes(id));
  const currentOrder = slots.map((index) => result[index] as string);
  const reordered = presentInOrder.some((id, index) => id !== currentOrder[index]);
  if (reordered)
    for (const [index, slot] of slots.entries()) result[slot] = presentInOrder[index] as string;
  const added: string[] = [];
  required.forEach((id, index) => {
    if (result.includes(id)) return;
    const before = required
      .slice(0, index)
      .filter((p) => result.includes(p))
      .at(-1);
    const after = required.slice(index + 1).find((p) => result.includes(p));
    if (before !== undefined) result.splice(result.indexOf(before) + 1, 0, id);
    else if (after !== undefined) result.splice(result.indexOf(after), 0, id);
    else result.push(id);
    added.push(id);
  });
  return { packs: result, added, reordered };
}
