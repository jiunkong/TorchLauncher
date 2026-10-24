# STUDIO-START-LINE-01

Worker: agent-1 (`launcher develop #1`)
Branch: `fix/studio-start-top-line`
Baseline: `9b61d66`
Scope: Studio renderer start-page CSS and its app-local functional smoke only.

## Cause and change

The `.page` container applies 28px top and bottom padding and 36px horizontal padding. The Studio menu bar is above the app shell, so on the start screen that top padding exposed a 28px dark strip between the menu bar and `.hero`. The native frame and menu bar were not the source.

The start page now removes the container padding so `.hero` starts exactly at the menu bar's bottom. The hero takes the original 28px vertical and 36px horizontal padding, preserving content gutters and vertical alignment. The language control offset was adjusted to keep its prior position. Other project pages retain the shared `.page` padding.

## Validation

- Node `v24.21.0`, Corepack pnpm `10.34.7`, WSL/Linux with `DISPLAY=:0`.
- `corepack pnpm exec biome check apps/admin/scripts/smoke-functional.mjs`: passed.
- `corepack pnpm --filter @torchlauncher/studio typecheck`: passed.
- `corepack pnpm --filter @torchlauncher/studio build`: passed after the final CSS change.
- `node apps/admin/scripts/smoke-functional.mjs`: passed; smoke measured menu/page/hero alignment, preserved 36px start-content gutters and the language control position at 760px and 1100px, then exercised Studio menus and project workflows.
- Inspected fresh Electron captures: `.cache/smoke/studio-start-760.png` and `.cache/smoke/studio-start-1100.png`. They are ignored local evidence, not tracked artifacts. Existing menu interaction capture remains `.cache/smoke/studio-menu-start.png`.
- Targeted Biome on the pre-existing Studio stylesheet reports the repository's current CSS warnings; no new warning pertains to the selectors added here. The smoke script has no Biome diagnostics.

## Status

Implemented and worker-validated, not integrated. No main menu/native window code changed. Coordinator should review the diff and run integrated Studio validation on `main`.
