import { describe, expect, it } from 'vitest';
import { GameLogs } from './logs';

describe('bounded game logs', () => {
  it('redacts tokens and identities split across chunks and UTF-8 boundaries', () => {
    const logs = new GameLogs(['secret-token', 'TestPlayer', 'uuid-123', '12345']);
    const text = Buffer.from('한글 secret-token TestPlayer uuid-123 12345\n');
    for (const byte of text) logs.write('stdout', Uint8Array.of(byte));
    logs.write('stderr', Buffer.from('authorization: Bearer secret-unrelated\n'));
    logs.finish('stdout');
    logs.finish('stderr');
    const output = JSON.stringify(logs.snapshot());
    expect(output).toContain('한글');
    for (const secret of ['secret-token', 'TestPlayer', 'uuid-123', '12345', 'secret-unrelated'])
      expect(output).not.toContain(secret);
  });
  it('redacts regex characters literally and account case variations', () => {
    const logs = new GameLogs(['s.e[c]ret', 'TestPlayer']);
    logs.write('stdout', Buffer.from('s.e[c]ret tEsTpLaYeR\n'));
    expect(logs.snapshot().entries[0]?.text).toBe('[REDACTED] [REDACTED]');
  });
  it('discards an oversized raw line instead of leaking its token prefix', () => {
    const logs = new GameLogs(['secret-token'], { maxLineBytes: 8 });
    logs.write('stdout', Buffer.from('secret-'));
    logs.write('stdout', Buffer.from('token-and-more\nok\n'));
    expect(logs.snapshot()).toMatchObject({ discardedLines: 1, entries: [{ text: 'ok' }] });
    expect(JSON.stringify(logs.snapshot())).not.toContain('secret');
  });
  it('enforces byte and entry limits, isolates streams and copies snapshots', () => {
    const logs = new GameLogs([], { maxBytes: 12, maxEntries: 2 });
    logs.write('stdout', Buffer.from('1111\n2222\n3333\n'));
    logs.write('stderr', Buffer.from('4444'));
    logs.finish('stderr');
    expect(logs.snapshot()).toMatchObject({
      bytes: 8,
      droppedEntries: 2,
      entries: [{ text: '3333' }, { text: '4444', stream: 'stderr' }],
    });
    const first = logs.snapshot().entries[0];
    if (!first) throw new Error('Expected retained log entry');
    first.text = 'changed';
    expect(logs.snapshot().entries[0]?.text).toBe('3333');
  });
  it('removes ANSI and carriage-return controls before redaction', () => {
    const logs = new GameLogs(['secret']);
    logs.write('stdout', Buffer.from('sec\u001b[31mret\r\n'));
    expect(logs.snapshot().entries[0]?.text).toBe('[REDACTED]');
  });
});
