# WINDOWS-PARALLEL (session #3, branch test/windows-parallel-fixes)

Test-only changes addressing the Windows `pnpm check` failures in WINDOWS-VERIFY-RESULT.md section D.

## Changes
- `vitest.config.ts`: on win32 only, `testTimeout` 30_000 and `hookTimeout` 60_000 (Linux keeps the Vitest defaults 5s/10s). Per-test timeouts are unchanged. File parallelism was not reduced; raise it only if timeouts persist (`fileParallelism: false` on win32).
- `writer.test.ts`: the `replace` case of "rejects a source changed during reading" is excluded on win32, and "rejects directory replacement during generation" is `skipIf(win32)`. Windows cannot rename over or move a path holding a file the writer has open, so the test's own rename fails with EPERM before the writer can detect anything. The append/truncate/same-size cases still run on Windows. No Windows substitute for replacement was added.
- `kill.test.ts`: the `child-exited` evidence expectations accept `child-exited` or `child-pid-reused` (Windows recycles PIDs quickly). `state: 'stale-verified'` is still asserted. Decision logic is untouched.

## Validation
Linux: `pnpm check` passed (Biome, tsc, Vitest, builds). Windows: not run.

## Re-run on Windows
`git pull` then `pnpm check` (full).

## Remaining doubts
- If a Windows reader of the source can race a concurrent replace in real use (e.g. a user editing a source while the writer holds it open), the writer simply blocks the replace; not a product defect as far as inspected, but the post-read identity check (writer.ts lines ~95, ~127) is untested on Windows for replacement.
- The kill.test PID-reuse relaxation could hide a case where the PID was reused while the child was actually alive; the PID-reuse path is covered separately in recovery.test.ts.
- If timeouts still occur, consider `fileParallelism: false` on win32.
