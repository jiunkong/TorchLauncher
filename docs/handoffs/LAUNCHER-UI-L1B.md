# LAUNCHER-UI-L1B handoff

- Session: `launcher develop #1`
- Branch/worktree: `feat/launcher-ui-l1b` / `.agents/worktrees/agent-1`
- Baseline: `6e830f2`
- Commit: reported in the completion message.
- Scope: bundled Korean font, game info and start time in `ProductState`, font license notices, no-drag/no-select behavior.

## Changed files

- Fonts: `apps/launcher/src/renderer/src/assets/fonts/{PretendardVariable.woff2,Pretendard-OFL.txt}`, `third-party/pretendard/{LICENSE,README.md}`, `styles.css` (`@font-face`, stack).
- Contract: `apps/launcher/src/shared/product.ts`; `apps/launcher/src/main/product/service.ts`.
- Renderer: `home.ts` (`gameParts`, `runningElapsed`), `App.tsx`, `pages/Home.tsx`, `main.tsx`, new `dragGuard.ts`, `components/{Menu,Splash,LegacyPage}.tsx` (draggable=false, `.selectable`), tests `home.test.ts`, `dragGuard.test.ts`, `main/product/launch.test.ts`.
- Build: `apps/launcher/electron.vite.config.ts` (emits `font-licenses-NOTICE.txt` next to the prismarine notice).

## Font

Pretendard Variable from npm `pretendard@1.3.9` (`dist/web/variable/woff2/PretendardVariable.woff2`, 2,057,688 bytes, unmodified; under the 4 MB limit so no subset). OFL 1.1 beside the font and in `third-party/pretendard/`. Obtained once with `npm pack` in a temp folder; no manifest/lockfile change, no run-time network. Stack: `'Pretendard Variable', 'Segoe UI', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif`; `font-display: swap`, weight range 45 920. Wordmark stays Pixelify Sans. CSP (`default-src 'self'`) already permits the font; no CSP change. Loaded in the built app (`document.fonts` reports Pretendard Variable loaded, `check` true) and Korean text rendered with it in a screenshot (`.cache/smoke/l1b-home-korean-menu.png`, ignored).

## Contract change

`ProductState.game?: { minecraftVersion; loader: 'fabric'|'neoforge'; loaderVersion }` and `runningSince?: number` (epoch ms, only while `running`). `game` is set in the launch `prepare` step from the verified deployment index (the server config file has no game fields), so it appears once a launch has read the index; before that the home shows `Minecraft 1.21.1` as before (not persisted across restarts). `runningSince` is set when the game process starts and removed on every exit/detach path. No address or other sensitive data added. The state is main-to-renderer only; the renderer validates display values (`gameParts` drops malformed versions and unknown loaders). Home shows `Minecraft 1.21.1 · Fabric 0.19.5`; elapsed uses `runningSince` if present, else the previous renderer-observed fallback.

## No select / no drag

- `body { user-select: none }`; exceptions: `input`, `textarea`, `code`, `pre`, `.game-log`, and `.selectable` (and children), applied to the error alert (`LegacyPage`) and the home warning panel (failure cause).
- `img, a, svg { -webkit-user-drag: none }`; the torch images have `draggable={false}`.
- `dragGuard.ts` (installed in `main.tsx` on `document`) cancels `dragover`, `drop`, `dragstart` globally; there is no intended drop target. Keyboard focus and screen readers are unaffected (no tabindex/ARIA change). Verified in the built app: body `user-select` none, `drop` default prevented, image `draggable` false. Unit test covers the guard.

## Packaging notice

`pnpm --filter @torchlauncher/launcher package:dir` (Linux) succeeded; the asar contains `/out/main/font-licenses-NOTICE.txt` (Pretendard and Pixelify Sans OFL text), `/out/main/prismarine-auth-NOTICE.txt` and the Pretendard woff2.

## Validation

See the completion message for the final `pnpm check` result. Run: `pnpm exec vitest run apps/launcher` (23 files, 164 tests), `pnpm typecheck`, `pnpm exec biome check apps/launcher third-party`, `node scripts/smoke.mjs`, `node apps/launcher/scripts/renderer-functional-smoke.mjs`.

## Not verified

Windows native run/packaging, loader name and elapsed display with a real launched game (only unit-tested; `prepare` is mocked out in service tests), `game` for NeoForge on a real deployment, text-drag behavior with a real OS drag.

## Requests to #0

1. Consider showing game info before first launch (needs a cached index or an index read at startup; not done here).
2. Drop the `launcher-ui.md` note that the version line lacks the loader.
