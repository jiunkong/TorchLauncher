# LAUNCH-EXIT-01 — optional launcher exit after game starts

- Worker/session: #3 `close_on_launch`; coordinator #0 retains integration ownership.
- Worktree: `.agents/worktrees/agent-3`; branch `feat/launcher-close-on-game-start`.
- Baseline: `2c1fcbe`; implementation commit: `5a7e0c3`.
- Implemented and locally validated; not integrated. No user action or running process remains.

## Behavior and boundaries

Personal `closeOnLaunch` defaults to false. Settings contains one checkbox and explanation. A strict
app-local boolean IPC setter saves `launcher-preferences.json` in Electron userData, outside server
and authentication directories. Writes use an exclusive temporary file, sync, close and atomic rename;
all owned temporary files are cleaned on write/sync failure. Reads are bounded and links/hard links,
non-files and oversized files are rejected. Save failure preserves the last acknowledged UI value.
Corrupt/unreadable saved settings fall back to false with visible actionable text; unrelated commands
still work and an explicit checkbox change can replace a corrupt regular file. Unsafe entries remain
rejected. Preference saves and launch share Operations serialization; setting changes while running
are rejected as busy. Existing trusted renderer/main IPC checks remain in place.

Only enabled launches use detached spawn with ignored stdio. Before handoff core explicitly writes and
re-reads the v2 lease, proves same known host and owner start identity, verifies real child PID/start
again, and checks abort/closed/stopping state. Then it synchronously unrefs the child and removes the
host abort listener. Readonly `RunningGame.detached` lets close/cancel skip managed stop even in the
microtask gap before service clears its game reference. `finished` still denotes real child exit;
it is never resolved as synthetic success. Lease release remains attached to actual child close.
Detached mode intentionally has no piped game logs; default false preserves the old piped/managed
spawn, logs, cancellation and shutdown lifecycle.

Service returns from managed game waiting only after successful handoff. It clears its game reference,
settles Operations, closes the gate, and invokes main's `app.quit()` callback. Authentication/sync/start
failure never invokes autoquit. Handoff failure stops/reaps and retains the launcher; if cleanup itself
fails the game reference remains available for shutdown retry. Pre-handoff close/cancel stops the child;
post-handoff close cannot kill it or await its eventual game exit.

A reopened launcher verifies its existing root path and matching server marker before common ensure
runs narrow stale game-lock recovery. Only a v2 game record with known owner/child identities,
verified dead owner and child on this host, no install/sync/mod recovery artifacts, and exact owner-text
CAS is reclaimed. Alive/unknown/foreign/invalid state remains locked. No automatic journal repair,
lock schema change, new dependencies or root manifest/export changes. Ordinary management can resume
after a detached game exits; a live detached child blocks management/launch writes/deletion through
existing locks. The narrow helper also deliberately refuses unidentified child records even when the
legacy general recovery assessment could otherwise consider an absent PID stale.

## Validation (Linux x64 / WSL, Node 24.21.0, pnpm 10.34.7)

Use `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH"` for pnpm in this environment.

- `pnpm exec vitest run apps/launcher/src/main/product packages/core/src/minecraft/process.test.ts packages/core/src/minecraft/recovery`:
  **14 files passed, 96 tests passed, 2 skipped**. Covers old managed lifecycle, settings persistence,
  malformed IPC, failed saves, injected writeFile/sync errors with no leftover temp files, explicit corrupt
  settings repair, noquit on auth/sync/spawn/handoff failure, cancellation/close races, the post-core-handoff
  close gap, and management blocked by live child vs resumed after dead game lease.
- Subsequently added one corrupt-settings managed-launch regression and reran its affected file together
  with the real-host subprocess suite:
  `pnpm exec vitest run apps/launcher/src/main/product/launch-exit.test.ts packages/core/src/minecraft/recovery/detach.test.ts`:
  **2 files, 12 tests passed**. This is overlapping incremental evidence, not 108 distinct tests.
- Real-host tests execute production process.ts through Node type transformation using only a temporary
  account-free Node child. For both natural host exit (exit code 0) and host SIGKILL, child remains alive;
  inspection is held-live, maintenance acquisition/recovery fail, exact lease remains. After killing that
  fixture child, inspection is stale-verified, narrow reclaim succeeds, and a new lease can be acquired.
- `pnpm --filter @torchlauncher/core typecheck`: passed.
- `pnpm --filter @torchlauncher/launcher typecheck`: passed, including final added regression.
- Scoped Biome of changed product/process/recovery/UI files and app smoke: passed.
- `pnpm --filter @torchlauncher/launcher build`: passed.
- `node apps/launcher/scripts/renderer-functional-smoke.mjs`: passed on actual Electron/WSLg with temporary
  userData and local status fixture. Verifies checkbox default false, clicks through real IPC, confirms
  true on disk, and existing mod/pack reads and draft preservation. Screenshot inspected:
  ignored `.cache/smoke/launcher-close-on-launch.png` in this worktree.
- `git diff --check`: passed before implementation commit.

One initial smoke attempt used Playwright `check()`, whose synchronous checked-state assertion ran
before this intentionally acknowledged-after-save controlled checkbox update. It was replaced with
click + asynchronous acknowledged-state wait; final smoke passed. This was test timing, not a claim
of product failure. No user server, Windows clone, account, or real game process was touched.

## Coordinator next steps

Review implementation and this handoff, merge through #0, then run integrated `pnpm check` on main.
The worktree is clean after handoff commit; no local test/build/app process is running. Screenshot is
ignored and environment-specific. No worker merge/progress edit was performed.

### Native Windows account-free validation after integration

In the user's existing Windows validation clone, first preserve dirty work and update to the integrated
commit through the coordinator's normal process. With Node 24 and pnpm 10.34.7:

```powershell
pnpm exec vitest run apps/launcher/src/main/product packages/core/src/minecraft/process.test.ts packages/core/src/minecraft/recovery/detach.test.ts packages/core/src/minecraft/recovery/recovery.test.ts
pnpm --filter @torchlauncher/launcher build
node apps/launcher/scripts/renderer-functional-smoke.mjs
```

The detach tests need no login/download/server. They assert real Node host exit and real child survival
on Windows, and clean only their own temporary fixture processes/data. Windows process identity probes
can be slower; real-host tests have a 60-second timeout. The renderer smoke also uses temporary userData
and a synthetic fixed server; it does not authenticate. It proves preference wiring, not actual-game
survival or Electron autoquit during a game.

Optional user-led actual UI verification, only after main is review/build ready: enable Settings →
게임 실행 후 런처 종료; start the already configured game through the normal UI. Confirm the launcher
Electron process actually exits (Task Manager/process inspection, not merely window disappearance)
while Java/game continues. Reopen the launcher while the game is alive and confirm another launch or
server mutation is blocked. Exit the game normally, reopen and confirm launch/management resumes.
Disable the setting and verify the launcher stays with the managed game. Record Windows/actual-game
results separately. Current evidence is Linux account-free subprocess and Electron UI only; it does
not assert authenticated world connection or native Windows feature completion.
