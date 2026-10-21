import { AuthenticationError } from '@torchlauncher/core/auth';
import { describe, expect, it } from 'vitest';
import { type GameExit, GameStartError } from '../../../../../packages/core/src/minecraft/process';
import { safeFailure, safeGameExit } from './outcome';

const result = (reason: GameExit['reason'], code: number | null): GameExit => ({
  reason,
  code,
  signal: null,
  logs: { entries: [], bytes: 0, droppedEntries: 0, discardedLines: 0 },
});
it('fails crashes and cancellation while distinguishing controlled duration stop', () => {
  expect(safeGameExit(result('exited', 1), false).ok).toBe(false);
  expect(safeGameExit(result('stopped', 1), true).ok).toBe(false);
  expect(safeGameExit(result('cancelled', 0), false)).toMatchObject({
    ok: false,
    completion: 'cancelled',
  });
  expect(safeGameExit(result('stopped', null), true)).toMatchObject({
    ok: true,
    completion: 'duration_elapsed',
  });
  expect(safeGameExit(result('exited', 0), false).ok).toBe(true);
  expect(safeGameExit(result('stopped', null), false).ok).toBe(false);
});
it('reports only known typed code/stage/status and suppresses raw causes and fields', () => {
  expect(safeFailure(new GameStartError('ESYNCGUARD'), 'final-guard', false)).toMatchObject({
    code: 'ESYNCGUARD',
    phase: 'final-guard',
  });
  expect(
    safeFailure(new AuthenticationError('http_failed', 'minecraft', 403), 'authentication', false),
  ).toMatchObject({ code: 'http_failed', stage: 'minecraft', status: 403 });
  const secret = 'private-token-url';
  expect(JSON.stringify(safeFailure(new Error(secret), 'authentication', false))).not.toContain(
    secret,
  );
  const forged = new AuthenticationError(secret as never, secret as never, 99999);
  const output = JSON.stringify(safeFailure(forged, secret, false));
  expect(output).not.toContain(secret);
  expect(output).not.toContain('99999');
});

describe('fatal log classification', () => {
  it('reports a fixed code for module resolution failures without log text', () => {
    const logs = {
      entries: [
        {
          stream: 'stderr' as const,
          text: 'Exception in thread "main" java.lang.module.ResolutionException: Modules a and b export package x',
        },
      ],
      bytes: 1,
      droppedEntries: 0,
      discardedLines: 0,
    };
    const result = safeGameExit({ reason: 'exited', code: 1, signal: null, logs }, false);
    expect(result).toMatchObject({ ok: false, exitCode: 1, code: 'module_resolution_failed' });
    expect(JSON.stringify(result)).not.toContain('Modules a');
  });
});
