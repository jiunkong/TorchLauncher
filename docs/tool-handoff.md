# Tool-independent continuation checkpoint

Updated: 2026-10-21. Read `AGENTS.md` before continuing. This checkpoint is maintained by #0.

## Claude continuation

The user is transferring subsequent work to Claude because the Codex usage budget is low.
Continue the #0 coordinator role under `AGENTS.md`; do not begin additional implementation or
repeat completed checks solely because the tool changed. The last verified main checkpoint before
this handoff update is `fc85ec2`, with no uncommitted changes. Inspect status and worktrees again.
Implementation workers are idle; no login or live validation is running on the coordinator's behalf.
The user's separately managed server may still be running; confirm its current state without changing it.

Update: the first Windows run failed with a module-resolution error (vanilla client jar not ignored); fixed in
`35f5734`, merged by `3a86683` (see `docs/handoffs/GAME-02-03-fix.md`). The user must rerun the same launch command
in the Windows clone after `git pull`; no Windows result for the fix exists yet. Worker #3's branch is
`fix/game-02-03-module-conflict`, idle. Claude subagents cannot be resumed after being stopped; start a new one.

The immediate next input is the user's Windows NeoForge gameplay test result. They have already
received the fresh-clone command below. If it has not been run, help resume that test; do not mark
GAME-02/03 complete until actual automatic server/world entry is confirmed. Read
`docs/handoffs/GAME-02-03.md` before diagnosing failures or assigning a worker a narrowly scoped fix.

```powershell
git clone D:\Projects\mclauncher D:\TorchLauncherWindowsSmoke
cd D:\TorchLauncherWindowsSmoke
pnpm install --frozen-lockfile

$sid = "44444444-4444-4444-8444-444444444444"
node scripts/game-smoke.mjs launch `
  --data-dir D:\TorchLauncherSmoke\auth `
  --game-dir "D:\TorchLauncherSmoke\games\$sid" `
  --loader neoforge --loader-version 21.1.264 `
  --source-file D:\Projects\mclauncher\.cache\game-smoke-validation\live-url.txt `
  --server-id $sid --server localhost:25565 `
  --duration-seconds 900
```

Use Node 24 and pnpm 10.34.7. If the Windows clone already exists, inspect it instead of cloning over it.
Initial downloads may take several minutes. After login and visible world entry, quit normally and
record the user's observation plus redacted result JSON. Do not request credentials or raw auth logs.

## Role and authorized scope

The current coordinator is user-designated #0. Product implementation belongs to workers; only #0
updates progress, reviews and integrates into main. Reader/sync are complete. The current authorized
task is GAME-02/03: 1.21.1 NeoForge installation/launch/direct connection first, then Fabric, including
the latest-sync launch gate. Do not start Studio or product UI work. Preserve generic game content paths.

Assigned worker (currently idle): #3, `.agents/worktrees/agent-3`, `feat/game-02-03-loaders`, prepared from the main
assignment commit. Read `docs/game-launch.md` and the latest assignment in `docs/work-distribution.md`.
Scope includes loaders/minecraft, narrow read-only sync launch guard, and a separate Electron game-smoke
runner; auth implementation and other shared files require coordination. A running user server is now
available in root `.testserver/`: Minecraft 1.21.1, NeoForge 21.1.264, port 25565, online mode enabled,
no whitelist/extra mods. Treat its data/process as read-only. #3 additionally owns the narrow `.gitignore`
and Biome exclusions for that local server. Do not accept EULAs. No real client connection is verified yet.

The matching 305-byte empty-content test pack is in ignored `.cache/game-smoke-validation/`, with
`manifest.json`, `reader-receipt.json` and `live-url.txt` (public URL, do not commit). Reader preflight
passed against actual Drive. Expected server ID is `44444444-4444-4444-8444-444444444444`.
This is separate from the completed sync v1/v2 fixture. Coordinator-tool localhost TCP did not connect;
verify the native user's localhost:25565 in the eventual Windows smoke. Do not infer the server is down.

Implementation `e763686`, lifecycle fixes `bc6ead4`, and final handoff `2fc3c2e` were merged by `541237a`.
Main `pnpm check` passed: 543 tests, 6 opt-in skips, all TypeScript/Biome and both app builds. Both official
Linux installs passed (NeoForge 21.1.264 / Fabric 0.16.14). This is not authenticated game/server evidence.
Standalone Electron/auth-worker bundle creation passed, but native Linux Electron install-only exited
without a harness result; GUI evidence remains unverified. Windows Ctrl+C now uses cooperative control
and Java reaping; nonzero exits/cancel fail with safe diagnostics. Native Windows launch is next.

#3 is awaiting the user's test result, not running an account login. Use a fresh Windows-native clone
outside the coordinator checkout to avoid replacing Linux node_modules. Exact commands are in
`docs/handoffs/GAME-02-03.md`; the original ignored source-file path must remain accessible from Windows.
Use separate external data/game roots, expected UUID `44444444-4444-4444-8444-444444444444`, NeoForge
21.1.264 and localhost:25565. Ask the user to confirm visible automatic world entry, then quit normally
and share only safe result JSON. Spawn/exit 0 alone does not count as a join. If a failure is reported,
resume #3 in a new fix branch with its explicit diagnostic and preserve server/user data.
Fabric's actual launch/join still needs a matching Fabric deployment/server after NeoForge validation.

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
