# GAME-PERF-01 — Bounded base Minecraft/Java installation

- Session: `launcher develop #3` / `install_parallel`.
- Branch/worktree: `perf/game-install-parallel` / `.agents/worktrees/agent-3`.
- Baseline: `de8418b`. Implementation commit: see Git history for this handoff's commit.
- Exclusive scope: `minecraft/installer.ts`, internal `install-pool.ts`, matching tests, this handoff.
- Implemented and locally tested; coordinator integration and native Windows verification pending.

## Behavior

Base client, libraries, assets, logging and Java runtime files now share a bounded pool instead of
awaiting each file serially. Default concurrency is 6; optional `InstallOptions.concurrency` accepts
integers 1–16 and rejects invalid values before acquiring a lease. A 128 MiB sum of declared sizes
limits simultaneous buffered file work; a larger file runs alone. The budget covers cache checks and
copies too, conservatively. It limits expected bytes rather than total process RSS: transport overhead
and buffers allocated inside an injected adapter remain adapter responsibilities. Only admitted jobs
create task promises; thousands of asset entries do not create thousands of live download promises.

Runtime directories are safely prepared before concurrent file writes. Runtime links are created only
after every file task drains. Java remains one staged tree, and all game/Java/metadata staging finishes
before publication. Staged game replacements are collected by plan index so publication/journal order
stays stable despite file completion order. Hash/length validation, path checks, cached reinstall/Java
copy reuse, completion events, commit rollback and crash recovery formats remain unchanged.

First failure (including progress/activity callbacks) stops admission, aborts the pool child signal and
waits for every started task before installer staging cleanup or server lease release. A sibling that
ignores cancellation delays cleanup until it settles. The first error is retained instead of being
replaced by a sibling abort. External cancellation propagates the caller's abort reason. No completion
progress can occur after pool rejection/install return. Existing published files survive failed staging.

## Activity interface for GAME-ACTIVITY-01

`installer.ts` exports optional `InstallOptions.onActivity` and `InstallActivity`:

```ts
{
  phase: 'planning' | 'checking' | 'downloading' | 'staging' | 'publishing';
  component: 'metadata' | 'game' | 'java' | 'library' | 'asset' | 'logging';
  path?: string;
  active: number;
  completed: number;
  total: number | null;
}
```

Planning reports metadata with null total. Each admitted job reports checking and its real active-job
count; cache misses report downloading before transport, cached Java files report staging before copy.
Paths are canonical installation-relative paths; URLs are never included. Publishing reports metadata,
zero active jobs and the final file count before the transaction commit. Callback failure still prevents
publication; no callback runs after successful commit. The existing `onProgress` shape and one event per
completed file remain intact. Apps, IPC, loader gate, exports and download contracts were not modified.

## Local validation (Linux/WSL, Node 24, pnpm 10.34.7)

- `pnpm exec vitest run packages/core/src/minecraft`: 113 passed / 3 skipped, 9 files passed / 1 skipped.
  Existing real-network tests remain skipped. Includes installer rollback and recovery/kill coverage.
- After replacing test-only `Promise.withResolvers` (not available in the repository's configured TS
  library), targeted installer/pool tests passed again: 45 tests / 2 files. This was a test compilation
  issue; no compiler settings or runtime implementation were changed.
- `pnpm --filter @torchlauncher/core typecheck`: passed after the test helper correction.
- Scoped Biome and `git diff --check`: passed.

New deterministic gate-based tests prove default overlap across game and Java, active-task bounds,
byte-budget admission including oversized files, first-error preservation, external cancellation,
progress/activity exceptions and drain-before-staging/lease cleanup while an adapter ignores abort.
Activity tests cover all components, phases, bounded counts, canonical paths/no URLs, cached Java staging,
no false downloading events on cache hits, and callback failures before publication. Existing cache repair,
personal-file preservation, hash rejection, symlink containment, publication rollback and recovery tests pass.

A temporary synthetic six-file fixture with a fixed 40 ms delay per artifact also completed at concurrency
1 and 6; no speed threshold or benchmark file was retained. This is a local latency exercise, not a real
Minecraft download speed measurement. No live install, user server, Windows clone, credentials or user
running process was touched. Full integrated `pnpm check` belongs to #0; native Windows execution and real
network throughput for the new pool were not measured here.

## Resume / integration

No pending user action or worker process. Commit this assigned scope, report the commit to #0 and
GAME-ACTIVITY-01, then await review. #0 owns merge/completion and integrated verification. The app worker
can consume `InstallActivity` directly from `minecraft/installer`; no new top-level export is required.
