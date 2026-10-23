# STUDIO-UI-01 handoff

- Session: implementation worker (agent-1), task STUDIO-UI-01
- Branch / worktree: `feat/studio-ui-shell`, `.agents/worktrees/agent-1` (base main c5035df)
- Implementation commit: `517de3b` (handoff commit follows it)
- Scope touched: `apps/admin/src/renderer/**`, `apps/admin/scripts/smoke-functional.mjs`, and (coordinate, outside the exclusive scope) `scripts/smoke.mjs` admin case only. No change to main/shared/preload, packages, root configs, lockfile, dependencies, docs/progress.md.

## Implemented
- Shell: OS native frame, window title = project name; sidebar (project card, 개요/서버 정보/브랜딩/파일/게임 설정/배포/내보내기 with status tags, save state, 저장/새 프로젝트/열기/다른 이름), start screen when no project, Splash (same animation as launcher + STUDIO tag, reduced motion, waits for first state reply).
- Tokens: names/values from `studio.css` in `:root`. Fonts per the later user instruction: Pretendard Variable + Pixelify Sans (wordmark only) copied from the launcher with both OFL files into `assets/fonts/`; `--font/--font-mono/--font-pixel` copied from launcher. No network fonts.
- Pages: overview, server info (validation via catalog keys), branding (app name/icon/background via existing `brandingSelect/Remove/Name` commands through new `useStudio().branding`), files (select, bulk policy / exclude, change chips, options/resourcepacks/shaderpacks shown as managed in game settings), deploy (state, address card with check list), export (check list, blocked state, done state), game settings (layout + local state from `settings/fixtures.ts`: tabs, empty state, preset dialog, three-state control, bulk, search/filter, pack order, shader switch).
- All strings in the Studio catalog (ko+en, parity test). `useStudio` messages/validation moved to the catalog. Main-process result strings (Korean) are shown as received.
- Unsaved changes: in-app modal (Modal with focus trap/Esc) before new/open; seam in `adapters/discard.ts` (`runConfirmedSwitch`, `onCloseRequest`, `finishClose`) for the STUDIO-MAIN-01 renderer-confirmed command and close-request event. No window.confirm/alert/prompt anywhere (`noNativeDialogs.test.ts`, and the smoke overrides them to throw).

## Adapter layer (STUDIO-UI-02 swap points)
`adapters/insights.ts` (`Insights` is the page contract) derives from this session's runs (`StudioRun`) only: last build baseline (files+policy+game+branding signature), diff (added/modified policy/excluded), address check record (stale when serverId/game/url changed), export time. Not available from the API, shown as unknown/`—`/disabled:
- persisted last deployment (time, size, file name) across restarts; file sizes; content-level diff (only path/policy diffs);
- per-check results: only serverId+game pair is inferred from MISMATCH; files/range are inferred "ok" only when the whole check passed;
- ZIP export, chosen launcher/output path, "폴더 열기" (disabled), "소스 다시 읽기" (disabled), recent projects list, "프로젝트 닫기";
- game settings: everything (`settings/fixtures.ts`, labelled "예시 데이터"; folder pick / add pack / shader options buttons disabled).
- `options.txt`/pack files still deploy with their stored policy until STUDIO-MAIN excludes them.
- Export is gated in the UI on a passed address check in this session (mockup behavior); the main process still re-verifies.

## Validation (worktree, Linux/WSL2, DISPLAY=:0)
- `pnpm lint`: 0 errors, 34 warnings (CSS descending specificity / !important, same class as launcher CSS).
- `pnpm typecheck`, `pnpm build`: pass. `pnpm test`: 85 files passed, 4 skipped; 1173 passed, 9 skipped.
- `node scripts/smoke.mjs`: both apps pass (760/1100 px).
- `node apps/admin/scripts/smoke-functional.mjs`: passes. Covers splash, fonts (`document.fonts.load/check` Pretendard + Pixelify loaded from the bundle; build output contains both woff2), in-app unsaved dialog (Esc, cancel, save-then-open, 0 native boxes), all pages, deploy build + diff, export blocked, persistence, painted layout (`elementFromPoint`, no horizontal overflow) for every page at 760 and 1100 px, isolation. Screenshots in `.cache/smoke/` (not committed).
- Not run: Windows, packaged builds, real network address check/export (offline), `pnpm smoke` wrapper (equivalent commands run), CI.
- Environment notes: Linux has no keyring, so the functional smoke stubs `safeStorage` (test only); the pre-existing smoke already failed at build here for that reason. Smokes pass `--lang=ko` since the locale follows the OS language (English in this environment).

## Limitations / open
- Main still shows a native discard box when a dirty project is replaced after "저장 안 함", and on window close (main-owned, awaiting STUDIO-MAIN-01).
- Branding preview cannot show chosen images (state carries metadata only).
- The packaged app needs the font OFL notices in the package like the launcher (`font-licenses-NOTICE.txt`); electron-builder config is out of scope.
- `scripts/smoke.mjs` admin section was updated minimally (page list, start screen, `.first()` nav lookup, `--lang=ko`).

## STUDIO-UI-02 must wire
Real insights (last deployment, diff, per-check results, sizes), ZIP export + folder open + output path, game-settings service (preset load, packs, shaders, policy save/deploy), rescan, renderer-confirmed discard + close-request, then remove "예시 데이터" labels and the fixtures.
