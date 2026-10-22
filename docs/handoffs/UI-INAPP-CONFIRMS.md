# UI-INAPP-CONFIRMS

- Branch: fix/launcher-inapp-confirms (base 5bf526a); renderer only.
- Replaced `window.confirm` for logout (App.tsx) and registered-mod removal (pages/Mods.tsx, `ModsView`) with a new generic `components/ConfirmDialog.tsx` on the shared `Modal` (focus trap, Escape cancel, focus restore, autofocus on cancel).
- Logout confirm uses the normal (primary) button; mod removal uses `solid-danger`. Confirm is disabled while busy (logout) or while not ready/running/mod missing (remove), matching the row button. Commands run only on confirm; cancel/Escape do nothing.
- New Korean keys: `menu.logoutTitle`, `mods.removeConfirmTitle` (existing `menu.logoutConfirm`, `mods.removeConfirm`, `menu.logout`, `mods.remove`, `common.cancel` reused). English catalog is a partial override of Korean, so parity check is unchanged.
- Tests: `ConfirmDialog.test.ts` (static markup); `apps/launcher/scripts/renderer-functional-smoke.mjs` now records IPC commands and checks cancel/Escape/confirm for both dialogs at 760/1100 px.
- Main-process shutdown message box left untouched.
