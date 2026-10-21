# Tool-independent continuation checkpoint

Updated: 2026-10-21. Read `AGENTS.md` before continuing. This checkpoint is maintained by #0.

## Role and authorized scope

The current coordinator is user-designated #0. Product implementation belongs to workers; only #0
updates progress, reviews and integrates into main. The authorized task is FMT-03 reader followed by
SYNC-01 synchronization. Do not start loaders, Studio or UI work. Preserve generic arbitrary game
content paths; keybinding presets are a separate convenience feature.

## Git and files

- Coordinator checkout: repository root, `main`. Inspect current status/log; documentation may be dirty.
- Reader: implementation `375e50e`, merged by `9c0dd04`. Integrated reader/writer tests: 58 passed;
  core TypeScript and scoped Biome passed. No public package export was added.
- Sync worker: `.agents/worktrees/agent-2`, branch `feat/sync-01-engine`, baseline `f66aee0`.
  Product changes are currently **untracked** under `packages/core/src/instance/sync/`; preserve them.
  They are not committed or integrated. Never run `git clean` or replace this worktree.
- Exclusive worker scope: `packages/core/src/instance/sync/**`, `docs/handoffs/SYNC-01.md`.
  Existing code imports the reader and shared maintenance lock. Shared exports/dependencies need #0 coordination.

## Specifications and review

Read `docs/synchronization.md`, `docs/deployment-format.md`, and the FMT-03 handoff.
Sync stages and verifies changed files, records ledger/journal/backups, then applies or rolls back.
Initial-only settings and unowned files must be preserved. Recovery must not claim an external file
as its own merely because its bytes match a staged file. Source reset/cancellation must be rechecked
before commit. Unicode disk spelling must resolve to the actual existing name, while rejecting aliases.
These review fixes have been drafted; verify the current code and regression tests before approving.
Local limits include 10,000 tracked entries; document all operational limits in the final handoff.
Stale-lock recovery remains GAME-05; never steal a lock based only on an old PID.

## Validation evidence and unfinished work

- Worker reported scoped Biome, core TypeScript and 30 sync tests passed. Verify output/current code;
  this is not evidence of a completed main integration.
- Real Drive v1 sync succeeded: 5 files downloaded. Same-reader repeat downloaded 0 files,
  reused 4 and preserved 1, with no additional network ranges.
- Receipt: worker `packages/core/src/instance/sync/fixtures/sync-live-v1.json`.
- Live test then waited for v2 confirmation and timed out. The worker also hit a tool usage limit.
  Neither event proves a sync product failure. The previous test process/nonce is expired; do not signal it.
- v2 update, retained-reader behavior, two-file-only payload download, owned-file deletion and personal
  settings preservation still require real Drive verification. User has **not** been asked to replace v1 yet.
- Next: resume worker review/tests, rerun v1 live setup, confirm it is waiting, request v2 replacement,
  complete live validation, commit/handoff, then #0 reviews/merges and runs integrated checks.

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
It uses temporary arm/nonce confirmation files and waits up to 30 minutes. Inspect the fresh arm file
only after starting a new run. Keep communicating while waiting; do not block the coordinator on the
entire test timeout. No login or Google account connection is needed.

In this WSL environment a working pnpm is under `/tmp/torchlauncher-tools/node_modules/.bin`;
verify it exists before use. Preserve Windows-installed dependencies in other worktrees; use a separate
validation checkout when necessary. Check running processes using current evidence, not this document's old PIDs.
