# Tool-independent continuation checkpoint

Updated: 2026-10-21. Read `AGENTS.md` before continuing. This checkpoint is maintained by #0.

## Role and authorized scope

The current coordinator is user-designated #0. Product implementation belongs to workers; only #0
updates progress, reviews and integrates into main. Reader/sync are complete. The current authorized
task is GAME-02/03: 1.21.1 NeoForge installation/launch/direct connection first, then Fabric, including
the latest-sync launch gate. Do not start Studio or product UI work. Preserve generic game content paths.

Active worker: #3, `.agents/worktrees/agent-3`, `feat/game-02-03-loaders`, prepared from the main
assignment commit. Read `docs/game-launch.md` and the latest assignment in `docs/work-distribution.md`.
Scope includes loaders/minecraft, narrow read-only sync launch guard, and a separate Electron game-smoke
runner; auth implementation and other shared files require coordination. Server availability has been
asked asynchronously; do not assume a reply or start accepting EULAs. No real game connection is verified yet.

## Git and files

- Coordinator checkout: repository root, `main`. Inspect current status/log; documentation may be dirty.
- Reader: implementation `375e50e`, merged by `9c0dd04`. Integrated reader/writer tests: 58 passed;
  core TypeScript and scoped Biome passed. No public package export was added.
- Sync worker: `.agents/worktrees/agent-2`, branch `feat/sync-01-engine`, baseline `f66aee0`.
  Implementation `88c8af3` was merged by `c79b95b`; live evidence `adff59c` was merged by `0f3ce6c`.
  Worker changes are committed and integrated. Inspect current status before assuming either checkout is clean.
- Exclusive worker scope: `packages/core/src/instance/sync/**`, `docs/handoffs/SYNC-01.md`.
  Existing code imports the reader and shared maintenance lock. Shared exports/dependencies need #0 coordination.

## Specifications and review

Read `docs/synchronization.md`, `docs/deployment-format.md`, and the FMT-03 handoff.
Sync stages and verifies changed files, records ledger/journal/backups, then applies or rolls back.
Initial-only settings and unowned files must be preserved. Recovery must not claim an external file
as its own merely because its bytes match a staged file. Source reset/cancellation must be rechecked
before commit. Unicode disk spelling must resolve to the actual existing name, while rejecting aliases.
These review fixes were implemented and covered by regression tests before integration.
Local limits include 10,000 tracked entries; document all operational limits in the final handoff.
Stale-lock recovery remains GAME-05; never steal a lock based only on an old PID.

## Validation evidence and next work

- Worker scoped Biome, core TypeScript and 32 sync tests passed. Main full `pnpm check` also passed:
  518 tests, 4 opt-in tests skipped, all workspace TypeScript/lint and both application builds.
- Real Drive v1 sync succeeded: 5 files downloaded. Same-reader repeat downloaded 0 files,
  reused 4 and preserved 1, with no additional network ranges.
- Receipt: worker `packages/core/src/instance/sync/fixtures/sync-live-v1.json`.
- The first v2 wait timed out and the worker hit a usage limit. Work was resumed; these were tool/workflow
  interruptions, not product failures. A fresh live run passed after the user confirmed v2 replacement.
- V2: old reader rejected with `source-changed`; reset read the exact 136648-byte v2 container.
  Downloaded 2, reused 2, preserved 1, deleted 1. Two HTTP 206 payload ranges transferred 4140 bytes.
  Local personal settings stayed modified; the omitted owned file was removed.
  Safe evidence: worker/main `sync/fixtures/sync-live-v2.json`. Live test exited successfully.
- No live test is waiting and there is no pending upload request. Old arm/nonce files must not be signaled.
  Drive currently serves **v2**. Replaying the two-phase harness requires coordinating a v1 upload first;
  do not rerun it against the current v2 URL and mistake an expected-v1 mismatch for a regression.
- The reader→sync task is complete. GAME-02/03 is now explicitly authorized above; product UI/IPC,
  user-mod registry, mixed-setting editing, stale-lock recovery and native OS validation remain separate.
  Read the tracker and obtain a new assignment before starting another feature.

## Local artifacts and commands

Ignored coordinator directory `.cache/sync-validation/` contains `sync-v1.torchpack` (140736 bytes),
`sync-v2.torchpack` (136648 bytes), `manifest.json`, source fixtures and reader preflight receipt.
The files are synthetic and not playable mods/worlds. Public URL is an environment input; obtain it
from ignored `live-url.txt` if present or ask the user. Do not commit it or signed download URLs/cookies.
The artifacts are local and must be copied/regenerated when moving to another machine.

Use Node 24 and pnpm 10.34.7. In the worker checkout:

```sh
pnpm --filter @torchlauncher/core typecheck
pnpm exec biome check packages/core/src/instance/sync
pnpm exec vitest run packages/core/src/instance/sync
```

Live opt-in inputs: `TORCHLAUNCHER_SYNC_LIVE_URL` and `TORCHLAUNCHER_SYNC_LIVE_MANIFEST` (absolute
path to the coordinator manifest). Test: `packages/core/src/instance/sync/live-validation.test.ts`.
It uses temporary arm/nonce confirmation files and waits up to 30 minutes. Only rerun when new changes
or unresolved concerns justify it and v1/v2 uploads have been coordinated. Inspect the fresh arm file
only after starting a new run; never use old PIDs/nonces. Keep communicating while waiting and do not
block the coordinator on the whole timeout. No login or Google account connection is needed.

In this WSL environment a working pnpm is under `/tmp/torchlauncher-tools/node_modules/.bin`;
verify it exists before use. Preserve Windows-installed dependencies in other worktrees; use a separate
validation checkout when necessary. Check running processes using current evidence, not this document's old PIDs.
