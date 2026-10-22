# UI-BASE handoff

- Worker: #1 (`launcher develop #1`)
- Branch/worktree: `feat/ui-base-shells` / `.agents/worktrees/agent-1`
- Baseline: `c920ff3`
- Scope: app-local renderer foundations for launcher and Studio, plus Electron smoke coverage.

Each app now has a typed local page selector in `App.tsx`, a `pages/Pages.tsx` module for page content, a `components/EmptyState.tsx` module for unavailable actions/panels, and a `hooks/useApplicationInfo.ts` hook retaining the existing application-info bridge/footer. The apps remain independent. Their dark amber CSS tokens and responsive shell are app-local. Launcher represents one fixed server environment and does not imply account, settings, connection, or saved-state results before those features are connected.

`scripts/smoke.mjs` navigates every page at 760px, checks the active navigation marker, verifies visible product actions stay disabled, preserves existing bridge/isolation checks, and captures `.cache/smoke/launcher.png` and `.cache/smoke/admin.png`.

Validation: scoped Biome passed. Launcher renderer TypeScript passed. Studio typecheck and build passed. Launcher full typecheck/build and GUI smoke could not be completed in this worker checkout because `prismarine-auth` is absent from its dependencies; no manifest or lockfile changes were in scope. #0 can run integrated validation where dependencies are available.
