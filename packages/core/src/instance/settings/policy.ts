import { collisionKey } from '../sync/safety.js';
import {
  type ConfigFilePolicy,
  SETTINGS_LIMITS,
  SettingsError,
  type SettingsPolicy,
} from './types.js';

type Json = string | number | boolean | null | Json[] | Map<string, Json>;

function bad(message: string): never {
  throw new SettingsError('invalid-policy', message);
}

/** Strict JSON parser: rejects duplicate object keys, trailing data and excessive depth. */
export function parseStrictJson(text: string): Json {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i] as string)) i++;
  };
  const value = (depth: number): Json => {
    if (depth > SETTINGS_LIMITS.jsonDepth) bad('nesting too deep');
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const map = new Map<string, Json>();
      ws();
      if (text[i] === '}') {
        i++;
        return map;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') bad('expected object key');
        const key = string();
        if (map.has(key)) bad(`duplicate key: ${key}`);
        ws();
        if (text[i++] !== ':') bad('expected ":"');
        map.set(key, value(depth + 1));
        ws();
        const next = text[i++];
        if (next === '}') return map;
        if (next !== ',') bad('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const list: Json[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return list;
      }
      for (;;) {
        list.push(value(depth + 1));
        ws();
        const next = text[i++];
        if (next === ']') return list;
        if (next !== ',') bad('expected "," or "]"');
      }
    }
    if (c === '"') return string();
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (!number) bad('unexpected token');
    i += number[0].length;
    return Number(number[0]);
  };
  const string = (): string => {
    i++;
    let out = '';
    for (;;) {
      const c = text[i++];
      if (c === undefined) bad('unterminated string');
      if (c === '"') return out;
      if (c.charCodeAt(0) < 0x20) bad('control character in string');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (e !== undefined && e in simple) out += simple[e];
      else if (e === 'u') {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad('bad unicode escape');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
      } else bad('bad escape');
    }
  };
  const result = value(0);
  ws();
  if (i !== text.length) bad('trailing data');
  return result;
}

const KEY = /^[A-Za-z0-9_.-]{1,128}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose.
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validOptionKey(key: string): boolean {
  return KEY.test(key);
}
export function validOptionValue(value: string): boolean {
  return value.length <= SETTINGS_LIMITS.valueLength && !CONTROL.test(value);
}
export function validPackId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= SETTINGS_LIMITS.packIdLength &&
    !CONTROL.test(id)
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose.
const CONFIG_SEGMENT_FORBIDDEN = /[\u0000-\u001f\u007f\\:*?"<>|]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// Printable ASCII only: java.util.Properties readers decode ISO-8859-1, so other characters would be
// corrupted. Backslash starts escapes, and padding is trimmed by the reader.
const CONFIG_VALUE = /^[\x20-\x7e]*$/;

/**
 * Game-directory-relative files a version 2 policy may edit: `config/**` (up to 5 segments) or
 * `shaderpacks/<name>` (direct child), always `.properties` or `.txt`.
 */
export function validConfigPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.length > SETTINGS_LIMITS.configPathLength || path !== path.normalize('NFC'))
    return false;
  const parts = path.split('/');
  const root = parts[0];
  if (root === 'config') {
    if (parts.length < 2 || parts.length > SETTINGS_LIMITS.configPathSegments) return false;
  } else if (root === 'shaderpacks') {
    if (parts.length !== 2) return false;
  } else return false;
  for (const part of parts) {
    if (
      part.length === 0 ||
      part.length > SETTINGS_LIMITS.configSegmentLength ||
      CONFIG_SEGMENT_FORBIDDEN.test(part) ||
      part === '.' ||
      part === '..' ||
      part.startsWith('.') ||
      part !== part.trim() ||
      part.endsWith('.') ||
      WINDOWS_RESERVED.test(part)
    )
      return false;
  }
  const name = parts[parts.length - 1] as string;
  return (name.endsWith('.properties') || name.endsWith('.txt')) && name.length > 4;
}

export function validConfigKey(key: string): boolean {
  return validOptionKey(key);
}
export function validConfigValue(value: string): boolean {
  return (
    value.length <= SETTINGS_LIMITS.valueLength &&
    CONFIG_VALUE.test(value) &&
    !value.includes('\\') &&
    value === value.trim()
  );
}

function expectMap(value: Json | undefined, name: string): Map<string, Json> {
  if (!(value instanceof Map)) bad(`${name} must be an object`);
  return value;
}
function exactKeys(map: Map<string, Json>, allowed: readonly string[], name: string): void {
  for (const key of map.keys()) if (!allowed.includes(key)) bad(`unknown field in ${name}: ${key}`);
}
function pairs(value: Json | undefined, name: string): [string, string][] {
  if (value === undefined) return [];
  const map = expectMap(value, name);
  if (map.size > SETTINGS_LIMITS.keysPerMap) bad(`${name} has too many keys`);
  const out: [string, string][] = [];
  for (const [key, v] of map) {
    if (!validOptionKey(key)) bad(`invalid option key in ${name}: ${key}`);
    if (key === 'resourcePacks') bad(`${name}.resourcePacks must use the resourcePacks section`);
    if (typeof v !== 'string' || !validOptionValue(v)) bad(`invalid value for ${name}.${key}`);
    out.push([key, v]);
  }
  return out;
}
function configPairs(value: Json | undefined, name: string): [string, string][] {
  if (value === undefined) return [];
  const map = expectMap(value, name);
  if (map.size > SETTINGS_LIMITS.keysPerMap) bad(`${name} has too many keys`);
  const out: [string, string][] = [];
  for (const [key, v] of map) {
    if (!validConfigKey(key)) bad(`invalid key in ${name}: ${key}`);
    if (typeof v !== 'string' || !validConfigValue(v)) bad(`invalid value for ${name}.${key}`);
    out.push([key, v]);
  }
  return out;
}
function configFiles(value: Json | undefined): ConfigFilePolicy[] {
  if (value === undefined) return [];
  const map = expectMap(value, 'configFiles');
  if (map.size > SETTINGS_LIMITS.configFiles) bad('configFiles has too many files');
  const seen = new Set<string>();
  const out: ConfigFilePolicy[] = [];
  for (const [path, entry] of map) {
    if (!validConfigPath(path)) bad(`invalid config file path: ${path}`);
    const folded = collisionKey(path);
    if (seen.has(folded)) bad(`config file path collision: ${path}`);
    seen.add(folded);
    const name = `configFiles[${path}]`;
    const fields = expectMap(entry, name);
    exactKeys(fields, ['format', 'required', 'initial'], name);
    if (fields.has('format') && fields.get('format') !== 'properties')
      bad(`${name}.format must be "properties"`);
    const required = configPairs(fields.get('required'), `${name}.required`);
    const initial = configPairs(fields.get('initial'), `${name}.initial`);
    const requiredKeys = new Set(required.map(([key]) => key));
    for (const [key] of initial) if (requiredKeys.has(key)) bad(`key conflict in ${name}: ${key}`);
    out.push({ path, required, initial });
  }
  return out;
}
function packs(value: Json | undefined, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(`${name} must be an array`);
  if (value.length > SETTINGS_LIMITS.packsPerList) bad(`${name} has too many packs`);
  const seen = new Set<string>();
  for (const id of value) {
    if (!validPackId(id)) bad(`invalid pack id in ${name}`);
    if (seen.has(id)) bad(`duplicate pack in ${name}: ${id}`);
    seen.add(id);
  }
  return value as string[];
}

export function parseSettingsPolicy(bytes: Uint8Array): SettingsPolicy {
  if (bytes.byteLength > SETTINGS_LIMITS.policyBytes)
    throw new SettingsError('limit-exceeded', 'settings policy is too large');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (cause) {
    throw new SettingsError('invalid-policy', 'settings policy is not UTF-8', { cause });
  }
  const root = expectMap(parseStrictJson(text), 'policy');
  const version = root.get('version');
  if (version !== 1 && version !== 2) bad('unsupported version');
  // Version 1 stays exactly as before: `configFiles` is an unknown field there.
  exactKeys(
    root,
    version === 2
      ? ['version', 'file', 'required', 'initial', 'resourcePacks', 'configFiles']
      : ['version', 'file', 'required', 'initial', 'resourcePacks'],
    'policy',
  );
  if (root.get('file') !== 'options.txt') bad('file must be "options.txt"');
  const required = pairs(root.get('required'), 'required');
  const initial = pairs(root.get('initial'), 'initial');
  const requiredKeys = new Set(required.map(([key]) => key));
  for (const [key] of initial) if (requiredKeys.has(key)) bad(`key conflict: ${key}`);
  let rp: { required: string[]; initial: string[] } = { required: [], initial: [] };
  if (root.has('resourcePacks')) {
    const map = expectMap(root.get('resourcePacks'), 'resourcePacks');
    exactKeys(map, ['required', 'initial'], 'resourcePacks');
    rp = {
      required: packs(map.get('required'), 'resourcePacks.required'),
      initial: packs(map.get('initial'), 'resourcePacks.initial'),
    };
  }
  return {
    version,
    file: 'options.txt',
    required,
    initial,
    resourcePacks: rp,
    configFiles: configFiles(root.get('configFiles')),
  };
}
