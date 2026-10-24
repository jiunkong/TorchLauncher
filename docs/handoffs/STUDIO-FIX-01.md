# STUDIO-FIX-01

Worker agent-1, branch `fix/studio-sidebar-splash`. Studio renderer and the functional smoke (plus one launcher smoke assertion).

1. Splash badge: `.splash .studio-tag` used `letter-spacing: .5em` with `padding-left: calc(14px + .5em)` and only 4px on the right. Letter-spacing also trails the last letter, so the visible left gap was 14px+.5em vs 4px+.5em on the right (only the "S" looked indented). Now `padding: 4px 10px 4px calc(10px + .5em)` (left = right + trailing spacing). The smoke measures the text range and asserts left/right visible gaps differ by < 1.5px. (The launcher has no such badge.)
2. Scrollbars: one global rule in `styles.css` (`*` scrollbar-width thin, scrollbar-color, plus `::-webkit-scrollbar` thin transparent track and subtle thumb); covers sidebar, page, logs and modals. The smoke checks `getComputedStyle(.side).scrollbarWidth === 'thin'` and `overflow-y: auto`.
3. Sidebar footer rebuilt: row 1 save-state (ellipsis, no wrap) + `저장` button; row 2 grid of `새 프로젝트` / `열기` / `다른 이름` (full "다른 이름으로 저장" kept as aria-label/title; at <= 960px the grid is 2 columns with the third spanning); the language control is full width with equal-width nowrap segments (compact labels `Auto` / `한국어` / `English`, aria-label `Language / 언어`; start screen keeps `자동 · Auto`); the version line is its own nowrap line. `.btn` is `white-space: nowrap`. Smoke asserts at 760x560 and 900x600: no horizontal overflow of the sidebar or document, no clipped footer label (scrollWidth <= clientWidth), thin scrollbar; and the existing 1100x800 no-scroll fit still passes.
Launcher: the language card was checked at 760 px (fits, one line) and is unchanged.

Screenshots (`.cache/smoke/`, not committed): `studio-sidebar-footer-760x560.png`, `studio-sidebar-footer-900x600.png`, `studio-sidebar-footer-1100x800.png`, `studio-splash-badge.png`.
Validation (WSL2, DISPLAY=:0, corepack pnpm wrapper): pnpm check, pnpm build, node scripts/smoke.mjs, Studio functional smoke, launcher renderer smoke all pass. Not run on Windows (real Windows scrollbar rendering).
