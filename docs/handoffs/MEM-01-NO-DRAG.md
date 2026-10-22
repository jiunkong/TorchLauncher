# MEM-01-NO-DRAG

Worker #1 implemented the user-requested removal of memory input dragging.

- Branch: `fix/memory-input-no-drag`
- Baseline: `fb5ca70`
- Scope: renderer settings UI, memory helpers/tests, launcher renderer styles and functional smoke.
- Changes: replaced the scrub input component with plain controlled numeric inputs, removed pointer capture/drag behavior and scrub helpers/tests, removed drag cursor/touch rules while retaining hidden native spinners, and deleted drag-specific smoke assertions. Direct fill/save, persisted settings, and failed-save smoke coverage remain.
- No backend, core, IPC, translations, dependencies, lockfile, or other pages were changed.

Validation (Node 24.21.0, pnpm 10.34.7):

- `pnpm exec vitest run apps/launcher/src/renderer/src/pages.test.ts apps/launcher/src/renderer/src/pages/memory.test.ts` — passed, 23 tests.
- `pnpm --filter @torchlauncher/launcher typecheck` — passed.
- `pnpm --filter @torchlauncher/launcher build` — passed.
- `node apps/launcher/scripts/renderer-functional-smoke.mjs` — passed; direct input/persistence and failed-save behavior exercised.
- Scoped Biome check on changed TS/JS files — passed. CSS check reported only pre-existing warnings in `styles.css` (no errors).
- `git diff --check` — passed.

Integrated status: pending coordinator review and merge. Full workspace `pnpm check` remains for #0 after integration.
