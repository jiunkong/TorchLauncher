# LAUNCHER-UI-L1 handoff

- Session: `launcher develop #1`
- Branch/worktree: `feat/launcher-ui-shell` / `.agents/worktrees/agent-1`
- Baseline: `185b99c`
- Commit: reported in the completion message.
- Scope: design tokens, app shell with collapsible menu, start animation, home and its states, game-stop confirmation (spec: `docs/launcher-ui.md`, stage L1).

## Changed files

- `apps/launcher/src/renderer/src/`: `styles.css` (rewritten on the design tokens), `App.tsx` (shell), `main.tsx` (locale provider), `pages/Home.tsx`, `pages/Pages.tsx` (home branch and status probe removed), `components/{Menu,Splash,StopDialog,LegacyPage,ActivityProgressBar,Icons}.tsx`, `home.ts`, `splash.ts`, `labels.ts` (existing failure/operation/outcome text moved unchanged out of `App.tsx`), `activity.ts` (+`activityKnown`, `stepChips`), `hooks/{useElapsed,useSeenSteps,useReducedMotion,useTranslator}.ts`, `i18n/catalog.ts` (new keys), `fixtures.ts`, tests `home.test.ts`, `splash.test.ts`, `shell.test.ts`, `activity.test.ts`.
- Assets: `renderer/src/assets/torch.png` (copy of `assets/branding/icon.png`), `renderer/src/assets/fonts/pixelify-sans-latin-700-normal.woff2` and `PixelifySans-OFL.txt`; `third-party/pixelify-sans/{LICENSE,README.md}`.
- `apps/launcher/src/main/index.ts`: only `backgroundColor` (`#0e0b0c`).
- `apps/launcher/scripts/renderer-functional-smoke.mjs`, `scripts/smoke.mjs` (launcher part only: splash wait, new menu/page names, version text).

## Behavior

- Shell: OS window frame kept. Menu starts closed (64px rail, icon buttons with `aria-label`, hamburger `aria-expanded`); open is 232px with server name (placeholder torch icon until L3), items, account avatar/nickname/logout. Focus moves to the new toggle after open/close. Items: 플레이, 내 모드, 설정, 로그. The 로그 item shows the old troubleshooting content unchanged.
- Existing mods/settings/log pages stay mounted (hidden on home) in `LegacyPage`, restyled with tokens only, so loaded lists and the resource-pack draft survive navigation as before. Their error alert, operation bar (cancel; stop now goes through the confirmation) and outcome line remain on those pages.
- Home: `.scene.fallback` background, one status line, server name (h1), `Minecraft 1.21.1`, button. Server address is not shown anywhere in the renderer UI. States: login, installing (panel with current activity, completed count, progress bar, step chips, button "설치하는 중…" plus 취소), running ("게임 실행 중 · 경과", red 게임 종료 -> modal), error (amber panel with the existing `failureMessage` text, 다시 시도, 로그 보기 link). `flow.ts` primary-action selection, serialization and cancel/stop semantics are unchanged.
- Progress: a ratio is drawn only when `activity.completed` and `activity.total` are both measured (`activityKnown`, same rule as before), otherwise the indeterminate bar. Step chips: `now` = current component group; `done` only for groups this renderer saw working earlier in the same operation (reset when the operation ends). No order or totals are inferred.
- Elapsed time is measured by the renderer from when it first observed `running` (the contract has no start time), so it restarts if the renderer reloads.
- `no_session` with no account is the login state, not an error panel (the startup restore reports it on a fresh install). Other errors show as before.
- Home status: one `status` query when home first becomes usable after the splash, as before (no polling).

## Splash "ready" criterion

`appReady`: the first product state (or the failure of `getState`) has arrived and `state.operation !== 'refresh'` (the startup session restore started from `ready-to-show` is not running). Minimum 2200ms (900ms with `prefers-reduced-motion`, which also removes all motion: static logo + bar). If not ready, the torch stays lit with a waiting bar sheen; when ready, flash/fade (~0.8s), then home. Safety cap 15s so a stuck refresh cannot block the UI forever (home then shows the real operation). A connection failure is ready immediately and appears on home. Race: if the first `getState` runs before the restore begins, the 2.2s minimum covers the usual restore time; `no_session` is not shown as an error. `<App splashMinimumMs={0}>` skips the wait for tests; smoke waits for `[data-testid=splash]` to detach (about 3s) and the shell is `inert` until then.

## Differences from the design

- Wordmark uses Pixelify Sans 700 (latin) bundled; body uses the system stack (design used Noto Sans KR from Google Fonts). Silkscreen is not used.
- Splash is one-shot (the design files loop for demonstration); the bar fills to ~86% over the minimum time then jumps to 100% on finish, as in SplashSlow. This bar is decorative, not install progress.
- Home shows no sample hills/stars background (L3). The version line shows `Minecraft 1.21.1` only: `ProductState` carries no loader/version, so "Fabric 0.19.5" cannot be shown (request below). The status line text for unqueried/checking/failed is new wording from the existing home strings ("서버 상태를 아직 확인하지 않았습니다" etc.).
- Error panel title is a generic "작업을 완료하지 못했습니다" (the design's example title was cause specific; the cause is the existing `failureMessage` text). Configuration/unsupported cases show the same amber panel with the existing messages and a disabled button.
- The existing "최근 결과" line (game exit outcome) is kept as a small line under the panel; not in the design.
- Dialog: focus starts on 취소, Escape cancels, Tab is trapped; closes automatically if the game exits.
- English dictionary values for the new keys are temporarily the Korean text (per spec); parity test passes.
- Korean text spacing in my screenshots looked wide because this WSL environment has no Korean font; check on Windows.
- Window `minWidth` 760 unchanged; layout was checked at 760 and 1100.

## Fonts

No network use at run time. `npm pack @fontsource/pixelify-sans@5.3.0` was used once to obtain the latin 700 woff2 (no dependency added); OFL text is beside the font and in `third-party/pixelify-sans/`. The license notice is not yet emitted into the packaged app (see requests).

## Validation (WSL Linux, Electron under WSLg)

- `pnpm install --frozen-lockfile` (CI=true) was needed in this worktree for typecheck; lockfile/manifests unchanged.
- `pnpm exec vitest run apps/launcher`: 22 files, 161 tests passed (new: home states, menu a11y attributes, stop dialog, splash readiness/phases, step chips). Full `pnpm test`: 61 files passed, 4 skipped; 859 tests passed, 9 skipped.
- `pnpm typecheck`, `pnpm build` passed. `biome check apps packages scripts third-party`: 0 errors, 8 warnings (CSS specificity/`!important` for reduced motion and `[hidden]`).
- `pnpm check` as a whole fails at `pnpm lint` on the baseline: `biome check .` reports ~170 errors in `docs/design/launcher/*.dc.html` and format issues in the three design CSS files (not touched by this work; I reverted an accidental `--write` of them). Needs a decision by #0 (e.g. biome ignore for `docs/design`), which is a root config change. The remaining stages of `pnpm check` (typecheck, test, build) were run separately and passed.
- `node apps/launcher/scripts/renderer-functional-smoke.mjs` passed (splash, menu open/close attributes, no address shown, home failure panel, mods/packs reads, close-on-launch persistence, draft kept across navigation).
- `node scripts/smoke.mjs` passed for both apps (launcher navigation by rail labels, 760/1100 layout, isolation).
- Screenshots in ignored `.cache/smoke/l1-*.png` (home default/login/install/running/error at 760 and 1100, menu open, stop dialog, splash) made with a throwaway Electron harness outside the repo that injects fake product states; compared with the design and matched except the differences above. The stop dialog, Escape cancel and stop command were exercised in that harness.

## Not verified

Windows native run and packaging, real Microsoft login, real server status/sync/install progress, real game launch/stop, `prefers-reduced-motion` visual check, Korean font rendering. Elapsed time and step chips were only exercised with injected states.

## Requests to #0

1. Contract: add game description to `ProductState` (e.g. `game: { minecraftVersion, loader, loaderVersion }`) so the home can show "Minecraft 1.21.1 · Fabric 0.19.5"; optionally a game start timestamp for accurate elapsed time.
2. Root config: biome ignore (or fix) for `docs/design/**` so `pnpm check` passes; emit `third-party/pixelify-sans/LICENSE` into the packaged launcher like the prismarine notice (`electron.vite.config.ts` plugin / builder config).
3. L2 main-process work should also remove the `no_session` special case once session restore stops reporting it as an error.

## For L2 to replace

`pages/Pages.tsx` (mods, settings, log/troubleshooting content: account session card, recovery card, manual status refresh, native `window.confirm` dialogs, inline Korean text), `components/LegacyPage.tsx` (temporary shell/operation bar/error alert), `components/EmptyState.tsx` (unused `Panel` helper), the `.page-panel`/`.data-list`/`.deletion-preview` legacy CSS, and the inline Korean text in `labels.ts`/`activity.ts` (move to dictionary keys).
