# GAME-ACTIVITY-01 — Structured installation activity

Worker: #4 (`install_activity`). Task: GAME-ACTIVITY-01. Branch: `feat/install-activity`.
Worktree: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-4`.
Initial baseline: `2b7186c`; final validation baseline: `424b787` (coordinator merge of
GAME-PERF-01 `ee4ef86`). Updated this worker from main with fast-forward, preserving all assigned edits.

## Implementation

- `ProductState.activity` is nullable structured metadata: component, phase, optional safe relative path,
  active work count and nullable completed/total counts. Existing `progress` stays compatible.
- Minecraft activity maps metadata, game, Java, library, asset and logging categories without changing
  checking/downloading/staging/publishing semantics. Loader installation reports installing with unknown counts.
- Synchronization uses a separate optional awaited `onFileActivity` callback, with started/completed events
  for staging and applying. Started staging runs before `reader.stageFile`; completed runs after digest
  verification. Signal checks bracket callbacks. Callback failure/cancellation follows existing rollback.
  Existing `onProgress` call sites, values and after-file semantics are preserved.
- Launch gate forwards `onSynchronizationActivity` and `onSynchronizationProgress`. Host state maps paths
  under mods/, resourcepacks/, config/, options.txt and the settings policy to server-mod, resource-pack,
  server-config; arbitrary remaining files become server-file, with no extension restriction.
- SyncCounts are planning counts, so activity completed/total remain null throughout sync. No synthetic
  percentage or 100% indication is introduced. Stage transitions and operation finalizers clear activity.
- Mapping copies only explicit metadata fields and omits unsafe/absolute/URL display paths. No URL,
  auth token, error text, privileged absolute path, or user-facing label is added to activity.

## Validation

Environment: WSL/Linux x64, Node `v24.21.0`, pnpm `10.34.7` from
`/tmp/torchlauncher-tools/node_modules/.bin` (temporary tool path must be checked before resuming).

- `pnpm exec vitest run packages/core/src/instance/sync packages/core/src/loaders/launch-gate.test.ts apps/launcher/src/main/product`:
  11 files passed, 1 opt-in live file skipped; 82 tests passed, 1 skipped.
- Scoped Biome for the 10 changed TypeScript files: passed.
- `git diff --check`: passed.
- `pnpm typecheck`: passed for core and both apps (main/preload and renderer TypeScript), after updating
  the worker to `424b787`.
- Scoped tests and Biome above rerun successfully against that final baseline.

Tests cover awaited before/after ordering, cancellation before bytes are requested, callback failures
at all staging/applying boundaries rolling back without initializing ownership, unchanged legacy progress
order, gate forwarding/failure preventing spawn, cached/download phase mapping, unknown totals, category
mapping for arbitrary extensions, unsafe path/private field omission, loader activity and service resets
at transitions and after success/failure/cancellation.

## Remaining / continuation

Implementation is not integrated; #0 owns review, merge and integration verification. No renderer, main
entry, preload, manifest, server or authentication actions were changed. Future UI must render unknown
totals as indeterminate. No native Windows, Electron smoke, live installation, login or server join was
performed for this metadata-only change. No running worker process or pending user action.

Next: #0 reviews this commit, integrates it and runs the final full workspace check. Worker implementation
and validation are complete; do not merge this worker branch into main or start follow-up work.
The implementation commit includes this report; obtain its ID with `git log -1` on `feat/install-activity`.
