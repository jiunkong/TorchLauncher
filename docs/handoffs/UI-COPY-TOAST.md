# UI-COPY-TOAST handoff

- Session: worker (agent-1), branch `fix/launcher-copy-toast`, base 66ef4d0.
- Task: icon-only server-data-path copy button plus transient bottom toast (renderer only).
- Changes: `components/Toast.tsx` (controller, hook, view; success role=status 2.5 s, failure role=alert 4 s, replace-on-new, timers cleared on unmount), `CopyIcon`, Settings copy button (aria-label/title `settings.copyPath`, disabled while copying), inline result paragraph removed, `settings.copyingPath` removed (unused), toast CSS (pointer-events none, reduced-motion safe), branding-smoke assertions updated.
- Success is reported only when `copyServerDataPath` resolves true; false, rejection, or missing API shows the failure toast.
- Validation: launcher typecheck pass; vitest renderer 85 pass (+ Toast.test.ts, fake timers); Biome: 0 errors, 8 pre-existing CSS warnings; `branding-smoke.mjs` pass (toast text/role, no overlap with path, toast click-through over delete button); `scripts/smoke.mjs` pass. Screenshots (ignored): `apps/launcher/.cache/ui-feedback/settings-{760,1100}.png`.
- Limitations: at 760px the toast visually overlaps the delete button edge but ignores pointer events; no unit test of the React hook itself (node test environment, no DOM); toast text is not announced-tested with a real screen reader.
