import { GameLogs } from '../minecraft/logs.js';
import type { ModInfo } from './metadata.js';

export type CompatibilityCategory =
  | 'loader-resolution'
  | 'mixin'
  | 'class-loading'
  | 'out-of-memory'
  | 'java-version'
  | 'crash'
  | 'unclassified';
export interface CompatibilityProblem {
  severity: 'error' | 'warning' | 'info';
  category: CompatibilityCategory;
  modIds?: string[];
  files?: string[];
  summary: { code: string; parameters: Record<string, string | number> };
  evidence: { source: 'log' | 'crash-report'; line: number; text: string }[];
}
export interface CompatibilityReport {
  /** no-problems-found only means no known pattern was found; it never guarantees compatibility. */
  status: 'problems' | 'no-problems-found' | 'incomplete';
  truncated: boolean;
  items: CompatibilityProblem[];
}
export interface AnalyzeGameLogInput {
  loader: 'fabric' | 'neoforge';
  minecraftVersion: string;
  text?: string;
  lines?: readonly string[];
  exit?: { code: number | null; signal: string | null } | null;
  crashReport?: string;
  mods?: readonly ModInfo[];
  /** Pass authenticated names/tokens, as with GameLogs, before any output is displayed. */
  secretsToHide?: string[];
}
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINE = 8 * 1024;
const MAX_LINES = 65536;

/** Bounded heuristic analysis; does not execute log text or infer that a mod pack is compatible. */
export function analyzeGameLog(input: AnalyzeGameLogInput): CompatibilityReport {
  const items: CompatibilityProblem[] = [];
  let truncated = false;
  let consumed = 0;
  let lineCount = 0;
  let started = false;
  let meaningful = 0;
  if (
    (input.secretsToHide?.length ?? 0) > 256 ||
    input.secretsToHide?.some((secret) => secret.length > MAX_LINE)
  )
    throw new Error('Too many or oversized secrets');
  const identities = new Set<string>();
  const knownMods = input.mods?.slice(0, 1000) ?? [];
  const cleaner = new GameLogs([], {
    maxEntries: 1,
    maxBytes: 65536,
    maxLineBytes: 65536,
  });
  const identityCleaner = new GameLogs(input.secretsToHide ?? [], {
    maxEntries: 1,
    maxBytes: 65536,
    maxLineBytes: 65536,
  });
  const add = (item: CompatibilityProblem) => {
    if (items.length === 200) truncated = true;
    else items.push(item);
  };
  const scan = (raw: string, line: number, source: 'log' | 'crash-report') => {
    if (consumed >= MAX_BYTES || lineCount >= MAX_LINES) {
      truncated = true;
      return false;
    }
    lineCount++;
    // Bound the byte-count operation too. Never expose a partial oversized line/secret.
    const bounded = raw.slice(0, Math.min(MAX_LINE + 1, MAX_BYTES - consumed + 1));
    const size = Buffer.byteLength(bounded);
    if (raw.length > bounded.length || size > MAX_LINE || size + consumed > MAX_BYTES) {
      truncated = true;
      consumed += Math.min(size + 1, MAX_BYTES - consumed);
      return true;
    }
    consumed += size + 1;
    // Strip controls before redaction, so embedded controls cannot split token keys or identities.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Untrusted terminal output.
    const plain = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    cleaner.write('stdout', Buffer.from(`${plain}\n`));
    let text = cleaner.snapshot().entries[0]?.text ?? '';
    // Redact token fields BEFORE identities: a name such as "access_token" must not hide a key.
    text = text.replace(/(--(?:accessToken|refreshToken)(?:=|\s+))\S+/gi, '$1[REDACTED]');
    identityCleaner.write('stdout', Buffer.from(`${text}\n`));
    text = identityCleaner.snapshot().entries[0]?.text ?? '';
    const identity = /Setting user:\s*(\S+)/i.exec(text)?.[1];
    if (identity && identities.size < 256) identities.add(identity);
    for (const name of identities) text = text.replaceAll(name, '[REDACTED]');
    text = text
      .replace(/(Setting user:\s*)\S+/gi, '$1[REDACTED]')
      .replace(/(--username(?:=|\s+))\S+/gi, '$1[REDACTED]')
      .replace(/((?:\/home\/|\/Users\/|[A-Z]:\\Users\\))[^/\\\s]+/gi, '$1[REDACTED]');
    const lower = text.toLowerCase();
    if (text.trim()) meaningful++;
    if (
      lower.includes('loading minecraft') ||
      lower.includes('modlauncher running') ||
      lower.includes('launching target') ||
      lower.includes('setting user:')
    )
      started = true;
    let category: CompatibilityCategory | undefined;
    let code = '';
    const fabric = ['mod resolution failed', 'incompatible mod set', 'could not find required mod'];
    const neo = [
      'missing or unsupported mandatory dependencies',
      'failed to load mods',
      'duplicate mods',
    ];
    if ((input.loader === 'fabric' ? fabric : neo).some((pattern) => lower.includes(pattern))) {
      category = 'loader-resolution';
      code = 'loader-resolution-failed';
    }
    if (
      lower.includes('requires') &&
      (lower.includes('missing') || lower.includes('version') || lower.includes('not installed'))
    ) {
      category = 'loader-resolution';
      code = 'dependency-mismatch';
    }
    if (lower.includes('duplicate mod')) {
      category = 'loader-resolution';
      code = 'duplicate-mod';
    }
    if (
      lower.includes('invalid dist') ||
      (lower.includes('environment') &&
        (lower.includes('incompatible') ||
          lower.includes('server-only') ||
          lower.includes('client-only') ||
          lower.includes('invalid dist')))
    ) {
      category = 'loader-resolution';
      code = 'environment-mismatch';
    }
    if (
      lower.includes('mixin apply failed') ||
      lower.includes('mixin application failed') ||
      lower.includes('mixintransformererror')
    ) {
      category = 'mixin';
      code = 'mixin-failed';
    }
    if (lower.includes('classnotfoundexception') || lower.includes('noclassdeffounderror')) {
      category = 'class-loading';
      code = 'class-loading-failed';
    }
    if (lower.includes('outofmemoryerror')) {
      category = 'out-of-memory';
      code = 'out-of-memory';
    }
    if (
      lower.includes('unsupportedclassversionerror') ||
      lower.includes('compiled by a more recent version of the java runtime')
    ) {
      category = 'java-version';
      code = 'java-version-mismatch';
    }
    if (
      lower.includes('minecraft crash report') ||
      lower.includes('this crash report has been saved to')
    ) {
      category = 'crash';
      code = 'game-crashed';
    }
    if (
      !category &&
      (lower.includes('exception') ||
        lower.includes(' error') ||
        lower.startsWith('error') ||
        lower.includes('/error]') ||
        lower.includes('fatal'))
    ) {
      category = 'unclassified';
      code = 'unknown-error';
    }
    if (category && items.length === 200) {
      truncated = true;
      return false;
    }
    if (category) {
      const modIds: string[] = [];
      const files: string[] = [];
      const words = new Set(text.split(/[^a-z0-9_.-]+/i));
      for (const jar of knownMods) {
        for (const mod of jar.mods.slice(0, 256)) {
          if (/^[a-z0-9_.-]{1,64}$/i.test(mod.id) && words.has(mod.id)) modIds.push(mod.id);
        }
        // Only return a caller's file name if it appears in already sanitized evidence.
        if (
          jar.file &&
          jar.file.length <= 255 &&
          !jar.file.includes('/') &&
          !jar.file.includes('\\') &&
          text.includes(jar.file)
        )
          files.push(jar.file);
      }
      add({
        severity: 'error',
        category,
        summary: { code, parameters: {} },
        evidence: [{ source, line, text: text.slice(0, 400) }],
        ...(modIds.length ? { modIds: [...new Set(modIds)] } : {}),
        ...(files.length ? { files: [...new Set(files)] } : {}),
      });
    }
    return true;
  };
  const scanText = (text: string, source: 'log' | 'crash-report') => {
    let offset = 0;
    let line = 1;
    while (offset < text.length) {
      // Searching only a bounded prefix avoids scanning a single multi-gigabyte line.
      const window = text.slice(offset, offset + MAX_LINE + 1);
      const newline = window.indexOf('\n');
      if (newline < 0 && window.length > MAX_LINE) {
        truncated = true;
        break;
      }
      const raw = newline < 0 ? window : window.slice(0, newline);
      if (!scan(raw, line++, source)) break;
      offset += raw.length + (newline < 0 ? 0 : 1);
    }
  };
  if (input.text !== undefined && input.lines !== undefined)
    throw new Error('Choose text or lines');
  if (input.text !== undefined) scanText(input.text, 'log');
  else if (input.lines) {
    for (let i = 0; i < input.lines.length; i++)
      if (!scan(input.lines[i] ?? '', i + 1, 'log')) break;
  }
  if (input.crashReport) {
    scanText(input.crashReport, 'crash-report');
    add({
      severity: 'error',
      category: 'crash',
      summary: { code: 'crash-report-present', parameters: {} },
      evidence: [],
    });
  }
  if (
    input.exit &&
    ((input.exit.code !== null && input.exit.code !== 0) || input.exit.signal !== null)
  ) {
    add({
      severity: 'error',
      category: 'crash',
      summary: { code: 'abnormal-exit', parameters: { code: input.exit.code ?? -1 } },
      evidence: [],
    });
  }
  return {
    status: items.length
      ? 'problems'
      : truncated ||
          !started ||
          meaningful < 2 ||
          input.exit?.code !== 0 ||
          input.exit.signal !== null
        ? 'incomplete'
        : 'no-problems-found',
    truncated,
    items,
  };
}
