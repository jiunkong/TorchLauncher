# UI-PROD-01-L launcher handoff

- Worker: #4 (`ui_prod_launcher`)
- Branch/worktree: `feat/ui-prod-launcher-flow` / `.agents/worktrees/agent-4`
- Baseline: `01041c5`
- Scope: `apps/launcher/src/renderer/**`, app-local launcher functional smoke, this handoff.
- Commit: reported in worker completion message after commit creation.

## Implemented

- Launcher home now presents the preconfigured server, account, and one primary login-or-play action. It does not expose server selection, creation, or address editing. Server status is checked once after restore/idle when there is no existing error or deletion confirmation; manual status refresh remains in troubleshooting. No polling was added.
- Structured activity uses Korean component/phase labels for game, Java, libraries, assets, loader, server mods, packs, server config, and other server files. Counts are shown only when measured; unknown totals use an indeterminate progress element and parallel work is described by active count. Operation errors and game process outcomes use user-facing text.
- Session refresh/logout, recovery, server status refresh, and diagnostic logs live under troubleshooting. Busy operations expose cancel; running games expose stop. Synchronous renderer command guarding prevents duplicate operations while preserving cancel/stop.
- Mods and resource packs load on entering their pages after the main process is idle, with unqueried/loading/empty/failed states. Pack drafts survive unrelated state events, save failures retain the draft, and explicit reload confirms before discarding edits. Existing deletion confirmation and mod-delete confirmation remain.
- Added renderer decision/activity tests and an app-local Electron functional smoke using a temporary profile, real empty mod/pack reads, a local-only status failure, and resource-pack draft preservation across that state event. The smoke adds no product test backdoor.

## Validation

- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" pnpm exec biome check apps/launcher/src/renderer/src apps/launcher/scripts/renderer-functional-smoke.mjs` — passed.
- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" pnpm --filter @torchlauncher/launcher typecheck` — passed.
- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" pnpm exec vitest run apps/launcher/src/renderer/src/activity.test.ts apps/launcher/src/renderer/src/flow.test.ts` — 8 passed.
- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" pnpm --filter @torchlauncher/launcher build` — passed.
- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" node apps/launcher/scripts/renderer-functional-smoke.mjs` — passed; app reads empty mods/packs, receives unavailable status from `127.0.0.1:1`, and preserves an edited pack draft.

The shared `scripts/smoke.mjs` remains owned by the Studio worker. Its launcher expectations should accept the enabled logged-out login action, the `문제 해결` navigation label, and the status snapshot (`unknown`, `online`, or `unavailable`) because the home performs a one-shot status query. Live login and game launch were not run.
