# STUDIO-UI-02 handoff

- Worker agent-1, branch `feat/studio-ui-wire` (from main with STUDIO-MAIN-01 and STUDIO-MAIN-02 merged). Commits: `git log --oneline main..feat/studio-ui-wire`. Not merged.
- Scope: `apps/admin/src/renderer/**`, `apps/admin/scripts/smoke-functional.mjs`, this file.

## Wired to the real API (fixtures removed)
- Files: `state.files` (sizes, added/modified/removed chips, excluded and missing rows, managed rows), bulk and per-file `filesPolicy` (always / first install only / exclude), source rescan, add files.
- Deploy: `state.deploy` status and reasons, last build (file name, time, count, size), `revealPack`; address card from `state.urlCheck` (serverId, game with remote game, file list count, range, same-deployment) with stale handling.
- Export: `state.export.checks` with per-reason text, blocked state, `exportCheck` on page open, ZIP export through `export`, done screen from `export.done`, `revealExport`.
- Game settings: `settingsImport` (folder / options.txt via the native pickers in the preset dialog), options tabs (key bindings with vanilla/mod filter, sound/video), mod config files (`settingsConfigItems/Remove`), resource packs (`settingsPackAdd/Policy/Move/Remove`), shader tab (pack list, selection, enable switch, iris/oculus file, per-pack options via `settingsShader*`), policy usage bar and `state.policy.error`.
- Unsaved changes: in-app modal; `new`/`open` repeat with `discard: true`; window close uses `onCloseRequest` and `closeConfirm`/`closeCancel`. No native dialogs; `noNativeDialogs.test.ts` (grep-style) and the smoke guard.
- Per the user decision there is no UI for old-launcher/old-project compatibility (the v2 policy warning was dropped).
- `adapters/insights.ts` is now a thin read model over `StudioState`; `adapters/discard.ts` wraps the discard and close commands.

## Validation (WSL2 Linux, DISPLAY=:0)
- `pnpm lint` 0 errors (37 warnings, CSS specificity/!important), `pnpm typecheck` ok, `pnpm test` 89 files / 1298 tests passed (4 files, 9 tests skipped), `pnpm build` ok.
- `node scripts/smoke.mjs` passed (both apps, 760/1100).
- `node apps/admin/scripts/smoke-functional.mjs` passed: fixture game folder (options.txt, config, iris, shader options), pack zips, import, bulk policies, packs, shader selection, build, blocked export (reason text), address check, real ZIP export to a temp path (contents checked), folder reveal (stubbed `shell`), later change blocks again, UNSAVED reply, discard flow, window close path (cancel, then save and close), 760/1100 painted-layout checks, fonts, isolation, no native boxes.
- Test-only stubs in the smoke: `safeStorage` (no keyring in headless Linux) and `globalThis.fetch` in main (range-capable server of the built pack for the https address, since the config rejects localhost URLs). Not run: Windows, packaged apps, a real public host or Google Drive.

## Gaps / notes for #0
- **Main contract bug:** while a close request is outstanding main answers every command except `closeConfirm`/`closeCancel` with `BUSY`, so "save, then closeConfirm" (as documented in STUDIO-MAIN-01) cannot work. The renderer cancels the request, saves, then calls `window.close()` (clean project closes). Better: let main accept `save`/`saveAs` during a close request.
- Key bindings show raw option keys (`key.jump`), no translated names (the API has none). Option values are display-only; no value editing UI yet (`settingsOptions` supports `value`).
- Mod config and shader option items are listed per file; no search or bulk selection there. Shader pack names that are not ASCII-safe surface through `state.policy.error`.
- Reopened projects need the source folder again before packs can be added and the diff is known (`deploy.status: unknown`).
- Export done screen persists in `state.export.done`; it is dismissed per result in the renderer only.
- Branding preview still cannot show chosen images (state carries metadata only). Font OFL notices must be in the package like the launcher.
