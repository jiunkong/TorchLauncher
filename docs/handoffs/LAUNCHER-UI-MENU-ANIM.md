# LAUNCHER-UI-MENU-ANIM handoff

- Session: `launcher develop #2`
- Branch/worktree: `feat/launcher-menu-animation` / `.agents/worktrees/agent-2`
- Baseline: `6d41486`
- Commit: reported in the completion message.

## Changed files

`apps/launcher/src/renderer/src/{components/Menu.tsx,styles.css,shell.test.ts}`, `apps/launcher/scripts/renderer-functional-smoke.mjs`, this document.

## Implementation

- `Menu` is now one `<aside class="menu" data-testid="menu" data-open>` for both states (the old `.rail` / `.side-open` DOM swap is gone). One toggle button persists, so focus stays on it without the old refocus effect; `aria-expanded` and the label (`메뉴 열기/닫기`) follow `open` immediately.
- Width: 64px <-> 232px. Open: 220ms `cubic-bezier(0.2, 0.7, 0.2, 1)` (ease-out); close: 200ms `ease-in-out`. Icons sit at fixed left offsets (nav padding 10px, 44px item boxes) and never move; the toggle slides to the right edge (translateX 168px, same timing) and its menu/collapse icons crossfade (120ms, outgoing icon lingers 60ms).
- Labels (`.fade`: item names, server name and torch icon, account name, logout): open = opacity/translateX(-6px -> 0) 140ms after a 100ms delay, `visibility` visible at 100ms; close = 80ms fade-out first, `visibility: hidden` after 80ms. Hidden labels are also `inert` (immediately), item labels are `aria-hidden` while buttons keep `aria-label` in both states; `title` only when collapsed.
- Home: `.menu` and `.content` use `contain: layout paint` / `overflow: hidden`; `.page-scroll` gets `scrollbar-gutter: stable` so scrollbars do not flicker during the width change.
- Reduced motion: the existing global `prefers-reduced-motion` rule (`transition: none !important`) makes the change instant; the visibility delays vanish with it.
- Rapid toggling: state is plain React `open`; CSS reacts to `data-open`, transitions retarget from the current value, so the end state always equals `aria-expanded`.

## Validation

- `pnpm check` exit 0 (863 tests passed, both builds). `node scripts/smoke.mjs` and `node apps/launcher/scripts/renderer-functional-smoke.mjs` pass.
- shell tests updated (single container, `data-open`, inert hidden labels, equal button count in both states). A CSS-text unit test was not possible (Vitest does not process CSS), so the CSS is covered by the functional smoke: mid-transition width strictly between 64 and 232 after 100ms, 5 rapid clicks end with `data-open`/`aria-expanded` true, one more click returns to false with focus on the toggle, and hidden `.side-name` computes `visibility: hidden` after the transition.
- Screenshots (ignored): `.cache/smoke/launcher-menu-opening.png`, `launcher-menu-closing-mid.png`. Playwright captures arrived at the start/end of the transition (screenshot latency exceeds 200ms), so a true intermediate frame was not visually inspected; the frames seen showed no icon jump or background flicker. In the first opening capture the toggle icon was blank mid-crossfade; fixed afterwards with the 60ms linger, not re-captured.
- `pnpm install --frozen-lockfile` was run in this worktree (no manifest/lockfile change).

## Not verified

Windows native, actual perceived smoothness at 60fps/GPU, long server names/ellipsis during the animation, a real mid-frame visual check.
