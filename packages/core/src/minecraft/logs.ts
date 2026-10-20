import { StringDecoder } from 'node:string_decoder';

export interface GameLogEntry {
  stream: 'stdout' | 'stderr';
  text: string;
}
export interface GameLogSnapshot {
  entries: GameLogEntry[];
  bytes: number;
  droppedEntries: number;
  discardedLines: number;
}
export interface GameLogLimits {
  maxBytes?: number;
  maxEntries?: number;
  maxLineBytes?: number;
}
/** Never emits partial raw lines: a split secret stays buffered, and oversized lines are discarded. */
export class GameLogs {
  private readonly entries: GameLogEntry[] = [];
  private bytes = 0;
  private droppedEntries = 0;
  private discardedLines = 0;
  private readonly limits: Required<GameLogLimits>;
  private readonly secretPattern: RegExp | undefined;
  private readonly states = {
    stdout: { decoder: new StringDecoder('utf8'), pending: '', discarding: false },
    stderr: { decoder: new StringDecoder('utf8'), pending: '', discarding: false },
  };
  constructor(secretsToHide: string[], limits: GameLogLimits = {}) {
    this.limits = {
      maxBytes: limits.maxBytes ?? 256 * 1024,
      maxEntries: limits.maxEntries ?? 512,
      maxLineBytes: limits.maxLineBytes ?? 16 * 1024,
    };
    for (const [key, value] of Object.entries(this.limits)) {
      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > (key === 'maxEntries' ? 10000 : 1024 * 1024)
      )
        throw new Error('Invalid game log limits');
    }
    const secrets = [...new Set(secretsToHide.filter(Boolean))].sort((a, b) => b.length - a.length);
    this.secretPattern = secrets.length
      ? new RegExp(
          secrets.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
          'gi',
        )
      : undefined;
  }
  write(stream: 'stdout' | 'stderr', bytes: Uint8Array): void {
    this.consume(
      stream,
      this.states[stream].decoder.write(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      ),
    );
  }
  finish(stream: 'stdout' | 'stderr'): void {
    this.consume(stream, this.states[stream].decoder.end());
    const state = this.states[stream];
    if (!state.discarding && state.pending) this.record(stream, state.pending);
    state.pending = '';
    state.discarding = false;
  }
  snapshot(): GameLogSnapshot {
    return {
      entries: this.entries.map((entry) => ({ ...entry })),
      bytes: this.bytes,
      droppedEntries: this.droppedEntries,
      discardedLines: this.discardedLines,
    };
  }
  private consume(stream: 'stdout' | 'stderr', text: string): void {
    const state = this.states[stream];
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      const end = newline < 0 ? text.length : newline;
      if (!state.discarding) {
        const piece = text.slice(offset, end);
        if (
          Buffer.byteLength(state.pending) + Buffer.byteLength(piece) >
          this.limits.maxLineBytes
        ) {
          state.pending = '';
          state.discarding = true;
          this.discardedLines++;
        } else state.pending += piece;
      }
      if (newline < 0) break;
      if (!state.discarding) this.record(stream, state.pending);
      state.pending = '';
      state.discarding = false;
      offset = newline + 1;
    }
  }
  private record(stream: 'stdout' | 'stderr', raw: string): void {
    // Remove terminal controls before matching identities; UI consumers receive plain text.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal escapes from child output.
    let text = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
    if (this.secretPattern) text = text.replace(this.secretPattern, '[REDACTED]');
    text = text.replace(
      /((?:access[_-]?token|refresh[_-]?token|authorization)["']?\s*[:=]\s*)(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
      '$1[REDACTED]',
    );
    const bytes = Buffer.byteLength(text);
    if (bytes > this.limits.maxBytes) {
      this.discardedLines++;
      return;
    }
    while (
      this.entries.length >= this.limits.maxEntries ||
      this.bytes + bytes > this.limits.maxBytes
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= Buffer.byteLength(removed.text);
      this.droppedEntries++;
    }
    this.entries.push({ stream, text });
    this.bytes += bytes;
  }
}
