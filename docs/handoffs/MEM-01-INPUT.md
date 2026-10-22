# MEM-01 renderer input follow-up

- Worker: `launcher develop #1`
- Branch/worktree: `feat/mem-01-scrub-input` / `.agents/worktrees/agent-1`
- Baseline: `f1b3286`
- Integration: worker branch only; #0 owns review and integration.

## Changes

- Kept the existing controlled GB inputs, validation, explicit Save action, and failed-save draft retention. Added horizontal pointer scrubbing to both memory inputs at 256 MiB per 20 px, with a 4 px movement threshold, symmetric directional rounding, legal-bound clamping, and the current Xmx cap for Xms. An empty Xms draft begins at 256 MiB only after a drag; ordinary blank input remains allowed. Scrubbing is disabled while saving or when an individual input has no valid min/max range; overall validation blocks saves on unsupported RAM. Pointer cancel restores the original draft; click, keyboard entry, and direct number entry remain available.
- Removed the max-memory recommendation sentence and memory-specific “saved” status. Kept the initial-memory Java-default explanation and the separate resource-pack save feedback.
- Removed the recent-result display from Play/Home. The `home.recentResult` translation remains in use by the Settings page frame; outcome labels, error panels, progress, and recovery details remain available.
- Added unit coverage for scrub step direction and bounds, a Play/Home rendering assertion, and Electron functional smoke coverage for pointer behavior, draft-only changes, cancellation, and Play/Home result visibility.

## Validation

Environment: Node `v24.21.0`, pnpm `10.34.7`.

- `pnpm --filter @torchlauncher/launcher typecheck` — passed.
- `pnpm exec vitest run apps/launcher/src/renderer/src/pages.test.ts apps/launcher/src/renderer/src/pages/memory.test.ts` — 2 files, 24 tests passed.
- `pnpm --filter @torchlauncher/launcher build` — passed.
- `node apps/launcher/scripts/renderer-functional-smoke.mjs` — passed.
- Scoped `pnpm exec biome check ...` on the changed renderer/smoke files — no errors; `styles.css` reports its 8 existing warnings (`!important` and selector specificity).
- `git diff --check` — passed.

No backend, core, IPC, manifest, dependency, or lockfile changes. Full workspace checks and integration remain with #0.
