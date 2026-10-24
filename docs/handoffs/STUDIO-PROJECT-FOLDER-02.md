# STUDIO-PROJECT-FOLDER-02 handoff

Worker session: implementation worker (not #0). Task: STUDIO-PROJECT-FOLDER-02.
Branch: `feat/studio-project-folder-create` (from main `50f4550`). Commit: see `git log -1` on the branch (the hash cannot be embedded in the commit itself).

## Behavior

- **New project** now creates the project folder itself. The renderer shows an in-app modal (`ProjectNameDialog`, built on `Modal`) for the project name (also the server name and folder name); after submit, main opens a native directory picker for the PARENT folder and creates `<parent>/<name>/files/` plus `project.torchproj`. Cancelling either step changes nothing (picker cancel keeps the modal open with the message so the name can be fixed; Escape/Cancel closes it).
- **Save As** uses the same flow: modal prefilled with the current folder name, parent picker, then `copyProjectFolderInto` creates the new folder and copies the project into it.
- **Name rules** (`projectNameProblem` in `apps/admin/src/shared/studio.ts`, used by main as the authority and mirrored in the renderer for live feedback): trimmed, non-empty, at most 64 characters, none of `<>:"/\|?*` or control characters (so no separators), no trailing dot (covers `.`/`..`), no Windows device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, also with an extension such as `nul.txt`). Failure: `FOLDER_NAME_INVALID`.
- **Existing target**: the leaf is made with a non-recursive `mkdir`; `EEXIST` maps to the new error `FOLDER_EXISTS` (file or folder), nothing is written into it. Parent keeps the `noLinks`/directory checks. Save As rejects a target equal to or nested with the source (`INVALID`) before creating anything.
- **Cleanup**: if writing `project.torchproj`/`files/` (New) or the copy / final save (Save As) fails, the created folder is removed again.
- Request shape: `new` and `saveAs` now require a string `name` (`new` still takes optional `discard`; `saveAs` takes no `discard`). Anything else is `INVALID`.
- Removed: dialog kind `projectnew`, title `dialog.projectNew`, the "existing empty folder" `createProjectFolder(dir)`, `defaultServerName` (main i18n, ctor argument of `StudioService`). Added dialog kind `projectparent` with title `dialog.projectParent` (ko/en). `project` (open) unchanged. `FOLDER_NOT_EMPTY` stays for `copyProjectFolder` into a non-empty target only.
- i18n (renderer catalog, ko+en): `error.FOLDER_NAME_INVALID`, `error.FOLDER_EXISTS`, reworded `error.FOLDER_NOT_EMPTY`, `projectName.*`.

## Files changed

apps/admin: `src/shared/studio.ts`, `src/main/{project-folder,studio,native-dialogs,i18n,index}.ts`, `src/main/fixtures/{projects,signing}.ts` (new/updated), tests (`project-folder`, `studio`, `studio-features`, `native-dialogs`, `branding`, `game-settings`, `signing`, `test-run`), renderer (`App.tsx`, `components/ProjectNameDialog.tsx` + test, `hooks/useStudio.ts`, `adapters/discard.ts`, `pages/{Pages,StartPage}.tsx`, `i18n/catalog.ts`), smoke scripts `scripts/smoke.mjs`, `apps/admin/scripts/{smoke-functional,branding-smoke}.mjs`.

## Validation (run in this worktree, DISPLAY=:0)

- `pnpm install --frozen-lockfile`: ok.
- `pnpm check`: exit 0 (Biome, typecheck, Vitest: 116 files passed / 4 skipped, 1516 tests passed / 9 skipped, both app builds).
- `pnpm smoke`: exit 0 (launcher and Studio renderer/navigation/IPC/isolation/760+1100px checks passed; Studio flow uses the name modal and mocked parent picker).
- `node apps/admin/scripts/smoke-functional.mjs`: exit 0. Now also covers: name modal prefill, invalid names (empty, `a/b`, `CON`, `ends.`) disable submit, modal fits at 760/1100 px (screenshots `.cache/smoke/studio-project-name-*.png`), parent-picker cancel leaves no project and no folder, then successful creation of `<parent>/server-project` with `files` + `project.torchproj`, and Save As modal prefill + Escape.
- `node apps/admin/scripts/branding-smoke.mjs`: exit 0.

New tests: invalid and reserved names, accepted unusual names, existing folder/file rejection without modification, missing/file/symlink parent, cleanup on failure (project-folder and Save As copy), cancel paths (New, Save As), request-shape validation, dialog rendering and name rules (renderer).

## Limitations / notes for #0

- Native Windows/macOS directory pickers and real Windows reserved-name behavior were not exercised (Linux/WSL only; picker mocked in smokes).
- Save As end to end (copy, switch) is covered by unit tests only; the functional smoke checks only its modal.
- Docs outside the allowed scope were not edited: `docs/studio-project-format.md` lines 56 and 59 still describe "select an empty folder" for `new`/`saveAs` and need updating to the parent-folder + name flow.
- Existing temp-directory test helpers now create the project through `fixtures/projects.ts#createProjectAt`, which removes the pre-made empty directory first.
