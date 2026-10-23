# STUDIO-MAIN-01 - Studio main/shared/preload features

Worker `agent-3` (STUDIO-MAIN-01), branch `feat/studio-main-features`, worktree `.agents/worktrees/agent-3`, base main `c5035df`.
Commits: `git log --oneline c5035df..feat/studio-main-features` (feature commit `b5dc955`, tests/handoff commit follows it). Not merged.

Scope touched: `apps/admin/src/main/**`, `apps/admin/src/shared/studio.ts`, this file, and two message entries (`BLOCKED`, `TOO_LARGE`, `UNSAVED`) in
`apps/admin/src/renderer/src/hooks/useStudio.ts` (needed to keep `Record<StudioError,string>` compiling; drop-in safe for UI-01). `packages/core`, root config and lockfile are untouched; `scripts/smoke.mjs` has one line changed (Studio `expectedBridge`).
SET-CORE-01 had no usable commit when this was written (no `feat/settings-core-shaders` ref visible), so part B is built on the existing v1 policy API.

## Transport (unchanged)
Preload exposes `request(command)`, `onCloseRequest(listener)` (see below) and `getApplicationInfo()`; every new feature is a new `StudioRequest` action on the same
channel. Sender validation, strict field validation (exact keys, types, limits) happen in `StudioService.request`. Paths never come from the
renderer: they come from native dialogs (`StudioDialogs`) or are source-relative strings validated against the scanned source folder.
`scripts/smoke.mjs`: one edit, see the close-request contract below (new bridge key `onCloseRequest`).

## State additions (`StudioState`)
`files: StudioFiles | null`, `deploy: StudioDeploy | null`, `urlCheck: StudioUrlCheck | null`, `export: StudioExport | null`, `preset: StudioPresetPreview | null`
(all defined in `shared/studio.ts`). Every command that finishes (except `state`, `touch`, `cancel`) recomputes `files`/`deploy`/`export`
without changing the project; a failed re-listing only nulls `files`. `reply.ok === false` replies carry only `code`; call `{action:'state'}`
afterwards to read the detail (`urlCheck`, `export.checks`).

- `files`: `{scannedAt, entries[], counts{total,totalBytes,added,modified,removed,excluded,managed,missing}, truncated, skipped}`.
  Entry: `{path, size|null, policy: 'always'|'initial-only'|'excluded'|'managed', change: 'added'|'modified'|'removed'|'unchanged'|null, missing}`.
  `change` is null when the project has no last build. `managed` = `options.txt`, `resourcepacks/**`, `shaderpacks/**`, `torchlauncher/settings-policy.json`
  (mock: "managed in game settings"). `excluded` = a file in the source folder that the project does not include. Limits: 10000 files, depth 24;
  links/special files/odd names are counted in `skipped`, never followed. Modified detection compares size first, then sha256 (cached per mtime+size).
  A missing included file is `missing:true, change:'modified'`.
- `deploy`: `{status: 'none'|'unknown'|'changed'|'upToDate', reasons: ('files'|'game'|'branding'|'settings')[], lastBuild: {fileName, builtAt, fileCount, totalLength, sequence}|null, changes{added,modified,removed}}`.
  `unknown` = built before but no source folder selected (reopened project); choosing the source resolves it.
- `urlCheck`: `{checkedAt, url, serverId, game, fileList{state,count}, range: 'ok'|'mismatch'|'failed'|'unknown', remoteGame, deployment: 'current'|'older'|'unknown', stale}`.
  `stale` flips true when serverId/sourceUrl/game/branding/last build changed after the check.
- `export`: `{checks: [{id:'serverId'|'game'|'url'|'deployment', ok, reasons: ExportBlockReason[]}], blocked, done: {fileName,size}|null}`.
  Reasons: `server-id`, `game`, `url-unchecked`, `url-failed`, `range`, `no-deployment`, `deployment-outdated`, `deployment-changed`.

## Commands
Existing actions keep their shapes. New:

| Action | Fields | Result / errors |
| --- | --- | --- |
| `rescan` | - | re-reads the source folder, updates `files`/`deploy`; `NO_PROJECT`, `IO` |
| `exportCheck` | - | rescans and re-evaluates `export.checks` from the last `urlCheck` (no network) |
| `check` (existing) | - | now fills `state.urlCheck`; still returns `MISMATCH` (server/game/branding differ) or `IO` (unreachable) as before |
| `export` (changed) | - | runs the URL check itself, rescans, blocks with `BLOCKED` before any dialog; then dialogs `binary` and `save('zip')`; writes ONE ZIP. `INVALID` (bad launcher/destination), `TOO_LARGE`, `CANCELLED`, `IO` |
| `revealPack` / `revealExport` | - | `dialogs.reveal(path)` of the last built pack / exported ZIP; `INVALID` if none |
| `filesPolicy` | `paths: string[]` (1..1000), `policy: 'always'|'initial-only'|'excluded'` | sets policy for source-relative paths. `excluded` removes the entry from the project. Reserved/managed paths, paths not in the scanned source, links, `..`/absolute -> `INVALID` |
| `settingsImport` | `source: 'folder'|'file'` | dialog `gamefolder` (reads `<dir>/options.txt`) or `optionsfile` (must be named `options.txt`); fills `gameSettings.options` (re-import keeps set policies), `state.preset` reports counts/ignored/detected mod configs and packs (informational only) |
| `settingsOptions` | `changes: {key, policy:'none'|'initial'|'required', value?}[]` (1..512) | key must exist; value <=2048 chars, no control chars; max 512 per policy map -> `TOO_LARGE` |
| `settingsPackAdd` | `kind: 'resourcepack'|'shaderpack'` | dialog (`.zip`); validated name/size (<=256 MiB)/zip magic; copied to `<source>/resourcepacks|shaderpacks/<name>` (never over a different file); new pack defaults to `initial`; same name replaces metadata keeping policy and position; needs a source folder |
| `settingsPackPolicy` | `kind, name, policy` | `INVALID` for unknown/invalid name |
| `settingsPackMove` | `kind, name, index` | index 0..length-1 after removal |
| `settingsPackRemove` | `kind, name` | removes from the preset only; the file in the source folder is NOT deleted |

New `StudioError` codes: `BLOCKED` (read `state.export`), `TOO_LARGE`. `StudioDialogs` gained `open` kinds `optionsfile|gamefolder|resourcepack|shaderpack`,
`save('zip')` and optional `reveal(path)`; `index.ts` implements them (`shell.showItemInFolder`).

## Project schema (backward compatible)
`StudioProject.version: 1 | 2`. Schema 1 files open unchanged and stay 1. Version becomes 2 the first time `lastBuild` (set by every build) or `gameSettings`
is written. A schema-1 file carrying `lastBuild`/`gameSettings`, unknown keys, bad hashes/names/limits is rejected (`INVALID`). The renderer's `update`
cannot change `lastBuild`, `gameSettings`, `sequence`, `version`, branding or `serverId`.
- `lastBuild`: `{deploymentId, builtAt, fileName, totalLength, sequence|null, game, brandingKey, files[{path,sha256,length,policy}]}` (basis of the diff).
- `gameSettings`: `{options: [{key,value,policy}], resourcePacks: [{name,sha256,length,policy}], shaderPacks: [...]}`; policy `none|initial|required`
  (`required` -> `always` file + `required` policy entry, `initial` -> `initial-only` file + `initial` entry, `none` -> not shipped).
  Pack bytes live in the source folder, not in the project file; the build re-hashes them and returns `MISMATCH` (nothing written) if they changed.

## Build changes
Plan = project files + packs + generated policy. With `gameSettings` present `options.txt` and `torchlauncher/settings-policy.json` plain entries are
dropped from the plan (settings own them). Projects without `gameSettings` build exactly as before (options.txt/resourcepacks entries in `files` still ship).
The generated `torchlauncher/settings-policy.json` is written atomically into the chosen source folder (core's writer only reads from the source root)
and validated with core's `parseSettingsPolicy` (v1: `required`, `initial`, `resourcePacks.required/initial` with ids `file/<name>`).
Core use is isolated in `game-settings.ts` (`parseOptionsText`, `generatePolicy`, `packId`; imports `parseSettingsPolicy`, `SETTINGS_LIMITS`, and
`validOptionKey/Value` from `packages/core/src/instance/settings/policy.ts`).

## Export ZIP
`zip.ts` (Node built-ins: `zlib` deflate/crc32; no dependency). Entries: launcher file (stored, mode 0755), `torchlauncher-server.json` and branding assets
(deflate when smaller). Names validated (no `..`, absolute, backslash, control, duplicates case-insensitively), <=64 entries, 32-bit sizes (no ZIP64; launcher <= 2 GiB),
source opened without links, CRC computed in a first pass and re-checked while copying, written to a temp file next to the target and renamed; abort/error removes the temp
and keeps an existing target. The old directory exporter `exportLauncher` is still in `filesystem.ts` (its helper is shared) but the service no longer calls it.

## No native confirmation dialogs (user rule, relayed by #0)
Studio must not use native confirmation/message boxes (same as the launcher). Native file open/save pickers stay. `dialog.showMessageBox` and
`StudioDialogs.discard` / `StudioService.canDiscard` are removed; main no longer decides about discarding. Exact contract:
- `{action:'new'|'open', discard?: boolean}`: if the current project has unsaved changes (`state.dirty`) and `discard !== true`, main replies
  `{ok:false, code:'UNSAVED'}` before showing any picker. The renderer shows its own modal, and on "discard" repeats the command with `discard:true`.
  `discard` must be a boolean (other values/extra keys -> `INVALID`); it is harmless when the project is clean. Note: a freshly created project is dirty.
  The currently shipped renderer sends no flag, so replacing a dirty project now fails with `UNSAVED` until STUDIO-UI-01/02 sends it.
- Window close with unsaved changes: main aborts running work, then, if dirty, sends the event `studio:close-request` (`studioCloseChannel`) to the
  trusted window only and keeps the window open. Preload exposes `onCloseRequest(listener): () => void` (new bridge key; `scripts/smoke.mjs` Studio
  `expectedBridge` is now `['request','onCloseRequest','getApplicationInfo']` - the only edit to that file). The renderer shows its modal (save / discard / stay) and answers
  through `request`: `{action:'closeConfirm'}` (discard and close the window) or `{action:'closeCancel'}` (stay). To save first, send `save`/`saveAs`
  and then `closeConfirm`. Both answers are accepted only while a close request is outstanding (otherwise `INVALID`), after the usual trusted-frame check.
- Safe fallback: if the renderer does not answer within 60 s, or main fails while closing, the request is abandoned and the window stays open
  (never closes with unsaved data without an explicit `closeConfirm`). A clean project closes immediately.
- New error code `UNSAVED` (one message entry added to `useStudio.ts`). Tests: `studio-features.test.ts` "in-app discard confirmation", `studio.test.ts`, `ipc.test.ts`.

## Behaviour changes that UI-02/#0 should know
1. Export now requires a deployment built by this project (`lastBuild`). Projects built before this change have none: rebuild once, then export.
2. Export saves a ZIP via `save('zip')` instead of picking an output folder; the `output` dialog kind is no longer used by the service.
3. `check`/`export` no longer throw on a mismatch before recording `urlCheck`; the reply code is unchanged for `check`.

## Validation (WSL2 Linux, this worktree)
- `pnpm lint` exit 0 (8 warnings, all pre-existing CSS specificity in the renderer stylesheet; none in main/shared).
- `pnpm typecheck` passed (core, studio, launcher).
- `pnpm exec vitest run` (whole repo): 82 files passed, 4 skipped; 1201 tests passed, 9 skipped. Studio: 77 tests; new: `studio-features.test.ts` (17), `game-settings.test.ts` (22);
  three existing tests (`branding`, `studio`, `signing`) were updated for ZIP export and the last-build requirement.
- `pnpm --filter @torchlauncher/studio build` passed; `pnpm build` passed.
- `node scripts/smoke.mjs` passed for launcher and Studio (display `:0` available; the first run failed only because the launcher `out/` was stale, fixed by `pnpm build`).
- `node apps/admin/scripts/branding-smoke.mjs` passed.
- NOT run: Windows, packaged apps (`package:*`), real `shell.showItemInFolder`, native dialogs for the new kinds, real HTTP range servers (memory sources only), `pnpm check` as one command.

## Limitations / remaining
- SET-CORE-01 not integrated: no shader selection/enable options, no per-pack shader options, no mod config items; `preset.detected.modConfigs` is informational only.
  Wiring point: `generatePolicy` in `game-settings.ts` plus `StudioGameSettings` (add `shader`/`modConfigs` fields, bump nothing: schema 2 reads absent fields as empty) and `buildPlan` in `files-diff.ts`.
- Pack bytes are copied into the user's source folder (`resourcepacks/`, `shaderpacks/`) and the policy into `torchlauncher/`; a project moved to another machine needs its source folder.
- ZIP has no ZIP64 (launcher max 2 GiB); empty/OS-specific attributes only (Unix mode in external attributes, UTF-8 names).
- Hashing large included files for the diff reads them whole once per change (cached by mtime+size); no incremental progress is reported for the rescan.
- Case-insensitive path collisions in the source (Windows) are not specially handled by the scan.
- `range` is inferred from a successful ranged read of the container tail/index; there is no separate probe request.
