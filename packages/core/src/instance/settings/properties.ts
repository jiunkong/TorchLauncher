import { SETTINGS_LIMITS, SettingsError } from './types.js';

interface Line {
  text: string;
  eol: string;
  /** Present for `key=value` lines. */
  key?: string;
}

function invalid(message: string, cause?: unknown): never {
  throw new SettingsError('invalid-config', message, cause === undefined ? undefined : { cause });
}

/**
 * Line-preserving model of a Java-style `key=value` file (Iris `iris.properties`, shader pack
 * option files). Comments, blank lines, order, BOM and line endings survive edits. The parser is
 * deliberately stricter than `java.util.Properties`: forms it cannot edit safely (continuation
 * lines, `:`/space separators, padded keys, duplicate keys) are rejected so nothing is modified.
 */
export class PropertiesDocument {
  private constructor(
    private readonly lines: Line[],
    private readonly bom: string,
    private newline: string,
  ) {}

  static empty(): PropertiesDocument {
    return new PropertiesDocument([], '', '\n');
  }

  static parse(bytes: Uint8Array): PropertiesDocument {
    if (bytes.byteLength > SETTINGS_LIMITS.configBytes)
      throw new SettingsError('limit-exceeded', 'config file is too large');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (cause) {
      return invalid('config file is not UTF-8', cause);
    }
    if (text.includes('\0')) return invalid('config file contains NUL');
    const bom = text.startsWith('﻿') ? '﻿' : '';
    const body = text.slice(bom.length);
    const lines: Line[] = [];
    const seen = new Set<string>();
    let newline = '';
    for (const match of body.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
      const [, content = '', eol = ''] = match;
      if (content === '' && eol === '') break;
      if (!newline && eol) newline = eol;
      const line: Line = { text: content, eol };
      const trimmed = content.trim();
      if (trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('!')) {
        if (/(^|[^\\])(\\\\)*\\$/.test(content))
          return invalid('continuation lines are not supported');
        const equals = content.indexOf('=');
        if (equals <= 0) return invalid('line without "=" separator');
        const key = content.slice(0, equals);
        if (key !== key.trim() || /[\s:\\]/.test(key))
          return invalid(`unsupported key form: ${key}`);
        if (seen.has(key)) return invalid(`duplicate key: ${key}`);
        seen.add(key);
        line.key = key;
      }
      lines.push(line);
    }
    return new PropertiesDocument(lines, bom, newline || '\n');
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
      line.text = `${key}=${value}`;
      return true;
    }
    const last = this.lines.at(-1);
    if (last && last.eol === '') last.eol = this.newline;
    this.lines.push({ text: `${key}=${value}`, eol: this.newline, key });
    return true;
  }

  serialize(): Uint8Array {
    const text = this.bom + this.lines.map((l) => l.text + l.eol).join('');
    return new TextEncoder().encode(text);
  }
}
