# PATH-01 — Settings server data location ellipsis

- Worker: #1, `settings_path`
- Branch/worktree: `fix/settings-path-ellipsis`, `agent-1`
- Baseline: `2725d1d`
- Scope: Settings location markup/style and existing Electron renderer functional smoke only.

The Settings server data location now stays on one line with an ellipsis when it exceeds the row width. The label keeps its space, the span retains the complete selectable text, and its native `title` contains the complete path. The CSS selector is scoped to this Settings row; deletion confirmation paths retain their existing wrapping styles. No state value, backend, clipboard button, or IPC behavior changed.

The existing Electron smoke injects a synthetic Windows-style `serverDataRoot` into renderer state and checks 760px and 1100px viewports. It verifies clipping, a single-line span, no card/window overflow, unchanged full `textContent`, and an exact full-path `title`; it restores the original renderer state afterward. The physical data root is unchanged.

## Validation

- `CI=true pnpm exec vitest run apps/launcher/src/renderer/src/pages.test.ts` — passed, 21 tests.
- `pnpm --filter @torchlauncher/launcher typecheck` — passed.
- `pnpm --filter @torchlauncher/launcher build` — passed.
- `PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" node apps/launcher/scripts/renderer-functional-smoke.mjs` — passed, including both synthetic path widths.
- `pnpm exec biome check apps/launcher/src/renderer/src/pages/Settings.tsx apps/launcher/src/renderer/src/styles.css apps/launcher/scripts/renderer-functional-smoke.mjs` — passed with 8 existing CSS warnings and no errors.
- `git diff --check` — passed.

Actual Windows-native UI confirmation remains pending; this checks a Windows-style path inside the existing Linux/WSLg Electron smoke.
