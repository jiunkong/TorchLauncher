# STUDIO-SMOKE-01

Worker agent-1, branch `fix/root-smoke-nav`; only `scripts/smoke.mjs` (Studio section and cleanup) changed. No renderer bug found.
Root cause of the reported hang: `node scripts/smoke.mjs` does not build, so it ran against a stale `apps/admin/out` without the new nav (waiting for the 모드 설정 button). The hang then came from cleanup: the failing run left a new project with unsaved changes, and `app.close()` triggers the in-app close dialog, which nobody answers, so the close (and the real error) never returned.
Fix: page list updated to the six split entries from #0's edit; cleanup now races `app.close()` against 5 s, then kills the process, and `rm` retries, so a failing step reports its error promptly (verified with a deliberately wrong label).
Results: fresh build then `node scripts/smoke.mjs` passes (both apps); `smoke-functional.mjs` passes; `pnpm check` exit 0 (96 files / 1394 tests passed).
Note: run `pnpm build` (or `pnpm smoke`) before the root smoke script.
