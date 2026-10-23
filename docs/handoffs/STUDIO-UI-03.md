# STUDIO-UI-03

Worker agent-1, branch `fix/studio-close-flow`. Renderer only (`adapters/discard.ts`, `App.tsx`, functional smoke comment).
The close flow is now save (`run('save')`) then `closeConfirm`; the `closeCancel` + `window.close()` workaround (`saveThenClose`) is removed.
A failed or cancelled save keeps the close modal open; cancel still sends `closeCancel`; no native dialogs.
Validation: lint, typecheck, test, build, `scripts/smoke.mjs` and `smoke-functional.mjs` (close path: cancel, then save and close) - see commit report.
