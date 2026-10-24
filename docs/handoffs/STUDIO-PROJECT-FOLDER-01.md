# STUDIO-PROJECT-FOLDER-01 handoff

Worker session: implementation worker. Branch: `feat/studio-project-folder`. Commit: `d1ffb59`.

## Behavior & Changes

- **Project Folder Layout**: Studio project is converted from a single `.torchproj` file to a project folder layout:
  ```
  <project-dir>/
  ├── project.torchproj    # Container v1 binary format (unchanged schema)
  └── files/               # Game data directory (mods/, resourcepacks/, shaderpacks/, config/ ...)
  ```
- **New Module `apps/admin/src/main/project-folder.ts`**:
  - `PROJECT_FILE_NAME = 'project.torchproj'`, `PROJECT_DATA_DIR = 'files'`.
  - `createProjectFolder(dir)`: Ensures empty directory (rejects with `FOLDER_NOT_EMPTY` if not empty), creates `files/` (0o700).
  - `readProjectFolder(dir)`: Reads `project.torchproj` (safeRead 32MB limit); rejects if missing (`INVALID`); ensures `files/` exists.
  - `copyProjectFolder(from, to, signal)`: Safe recursive copy into empty target directory; validates boundaries and containment, ignores temporary `.torchstudio-*` files, and copies `project.torchproj` last.
  - `copyIntoDataDir(dataDir, picked, signal)`: Safe file copy into `files/` using `isListableName`, O_NOFOLLOW and atomic rename (`.torchstudio-<uuid>.tmp`). Rejects with `INVALID` if target file exists with different content (no accidental overwrites).
- **Studio Backend (`apps/admin/src/main/studio.ts`)**:
  - `sourceRoot` is derived as a getter (`join(this.projectDir, PROJECT_DATA_DIR)`). Removed `sourceName` from `StudioState`, removed `'source'` from `StudioCommand`.
  - Added `'revealProject'` action to `StudioWorkCommand` (`dialogs.reveal(this.projectDir)`).
  - `new`: Prompts for empty directory (`projectnew`), creates folder, writes initial `project.torchproj`, initializes `dirty: false`.
  - `open`: Prompts for directory (`project`), reads `project.torchproj`, sets `projectName = basename(dir)`.
  - `save`: Overwrites `project.torchproj` directly in current project directory without dialog.
  - `saveAs`: Prompts for empty directory (`projectnew`), copies project folder via `copyProjectFolder`, updates active `projectDir`.
  - `files`: Copies files outside `files/` into `files/` via `copyIntoDataDir`, registering them by relative path. Rejects duplicates with `INVALID`.
- **Dialogs & I18n**:
  - Updated open dialog definitions: `project`, `projectnew` open directories. Removed `save('project')`.
  - Updated dialog titles: `dialog.projectOpen` ("프로젝트 폴더 열기"), `dialog.projectNew` ("새 프로젝트 폴더 선택"), `dialog.filesOpen` ("추가할 파일 선택").
  - Removed obsolete dialog titles: `dialog.sourceOpen`, `dialog.projectSave`, `dialog.studioFileFilter`.
- **Renderer (`apps/admin/src/renderer/**`)**:
  - Menu: Added `파일 > 프로젝트 폴더 표시` (`menu.revealProject` / "Show Project Folder") in `menus.ts` (disabled when busy or no project). Connected to `studio.command({ action: 'revealProject' })` in `App.tsx`.
  - Files page (`FilesPage.tsx`): Displays project folder name and adds "폴더 표시" button. Updated file add button to "파일 추가(프로젝트에 복사)". Removed `files.needSource` warning.
  - Pages & Settings: Removed `sourceName` / `sourceReady` checks and `needSource` warnings across `DeployPage`, `ExportPage`, `TestPage`, `ModsPage`, `PackSettingsPage`, `ShaderSettingsPage`.
  - Added error message for `FOLDER_NOT_EMPTY` in `catalog.ts`.
- **Scripts**:
  - `scripts/smoke.mjs`, `apps/admin/scripts/smoke-functional.mjs`, `apps/admin/scripts/branding-smoke.mjs` updated to use project folder flow.
- **Documentation**:
  - Updated `docs/studio-project-format.md` with "프로젝트 폴더 구조" section.
  - Updated `docs/current-formats.md`.

## Files Changed
- `apps/admin/src/shared/studio.ts`
- `apps/admin/src/main/project-folder.ts` (new)
- `apps/admin/src/main/project-folder.test.ts` (new)
- `apps/admin/src/main/studio.ts`
- `apps/admin/src/main/native-dialogs.ts`
- `apps/admin/src/main/i18n.ts`
- `apps/admin/src/main/branding.test.ts`
- `apps/admin/src/main/game-settings.test.ts`
- `apps/admin/src/main/i18n.test.ts`
- `apps/admin/src/main/native-dialogs.test.ts`
- `apps/admin/src/main/signing.test.ts`
- `apps/admin/src/main/studio.test.ts`
- `apps/admin/src/main/studio-features.test.ts`
- `apps/admin/src/main/test-run.test.ts`
- `apps/admin/src/renderer/src/menus.ts`
- `apps/admin/src/renderer/src/menus.test.ts`
- `apps/admin/src/renderer/src/App.tsx`
- `apps/admin/src/renderer/src/i18n/catalog.ts`
- `apps/admin/src/renderer/src/pages/FilesPage.tsx`
- `apps/admin/src/renderer/src/pages/OverviewPage.tsx`
- `apps/admin/src/renderer/src/pages/DeployPage.tsx`
- `apps/admin/src/renderer/src/pages/ExportPage.tsx`
- `apps/admin/src/renderer/src/pages/TestPage.tsx`
- `apps/admin/src/renderer/src/pages/TestPage.test.ts`
- `apps/admin/src/renderer/src/pages/fixtures/fakeStudio.ts`
- `apps/admin/src/renderer/src/pages/settings/ModsPage.tsx`
- `apps/admin/src/renderer/src/pages/settings/PackSettingsPage.tsx`
- `apps/admin/src/renderer/src/pages/settings/ShaderSettingsPage.tsx`
- `scripts/smoke.mjs`
- `apps/admin/scripts/smoke-functional.mjs`
- `apps/admin/scripts/branding-smoke.mjs`
- `docs/studio-project-format.md`
- `docs/current-formats.md`
- `docs/handoffs/STUDIO-PROJECT-FOLDER-01.md`

## Validation Results
- `pnpm check`: passed (exit code 0; Biome lint, workspace typecheck across all 4 projects, 115 test files / 1499 tests passed, production electron-vite build for launcher and studio).
- `pnpm --filter @torchlauncher/studio typecheck`: passed (0 errors)
- `pnpm vitest run apps/admin`: 29 test files passed (201 tests passed)

## Not Verified
- Native Windows directory selection dialogs (tested via mock dialogs in headless Linux/WSL).
- Packaged desktop application distribution (packaged installers deferred to release cycle).
