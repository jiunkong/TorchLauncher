# TESTRUN-MAIN-02 — explicit settings import / read-only test previews

- Session/model: Codex implementation worker, current worktree agent-1; GPT-6-based Codex (exact runtime variant is not exposed). Not coordinator #0. No sub-agents used.
- Task: TESTRUN-MAIN-02. Branch: `feat/testrun-main-2`.
- Worktree: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-1`.
- Baseline: `f390fa9` (user-designated main; includes TESTRUN-MAIN-01 via `89176e0`). The worktree initially had clean detached HEAD `9d8f03b`; inspected status, worktrees, recent commits and current coordinator main before creating the branch directly from `f390fa9`. No reset/clean or existing-file deletion was performed.
- Final implementation commit: `fef5a6f3c51d19aa881f61662ff8507a507be319`.
- Final handoff commit: the subsequent commit containing this file; its exact HEAD is reported in the session final response to avoid a self-referential hash. Resolve with `git log -1 -- docs/handoffs/TESTRUN-MAIN-02.md`.
- Status: implemented, tested and committed on the worker branch for #0 review. No main integration or completion decision made here.

## Behavior

Test completion no longer calls `StudioService.importPreset`. It cannot replace `project.gameSettings`, mark the project dirty or replace the last explicit `state.preset` import preview. Counts and config candidates live only under `state.testRun`. Existing dirty state stays as it was; completion does not clear existing edits either.

Player settings import is explicit. Both new options sources reuse `readPreset` and the same `importPreset` / `mergeOptions` / settings-policy validation path as the existing import. They read **options only** and never import config/shader candidates. Existing policies of retained keys survive, selected keys absent from the incoming file survive, newly discovered keys default to `none`. Successful import marks the project dirty. Existing config/shader/pack settings are preserved.

`readPresetConfigs(folder)` was extracted from the existing bounded folder reader. It reads config/pack metadata without opening options.txt. Consequently missing/invalid options cannot block config candidates. Existing explicit `settingsImport` folder/file behavior remains the current supported workflow, not a legacy reader. No project/policy format migration was introduced.

## Exact IPC contract for TESTRUN-UI-01

Use existing `window.torchlauncher.request(...)` / `studio:request`. No new preload key/channel and no renderer edits.

| Exact payload | Result |
| --- | --- |
| `{action:'settingsImportOptions', source:'test'}` | Re-read `<Studio userData>/test-instances/<current serverId>/options.txt` after a completed current-project test. Merge only options into the project; set `state.preset.source = 'test'`; dirty = true. No picker or caller-provided path. |
| `{action:'settingsImportOptions', source:'file'}` | Existing `optionsfile` native file picker and existing options.txt validation/merge. `state.preset.source = 'file'`; dirty = true. Cancel returns CANCELLED without changing the project. |
| `{action:'settingsTestConfigs'}` | Refresh read-only candidates at the current project's fixed instance root. Return them under `state.testRun.configFiles/configPreview/configError`; no settings import and no dirty change. May inspect a previously existing instance even before a new test in this app session. |
| `{action:'settingsImport', source:'folder'|'file'}` | Existing explicit folder/file preset workflow, still used by the current renderer. No changes to its command contract. |

All new commands reject missing/extra own fields, inherited action substitutions and unsupported sources. `settingsImportOptions` accepts only `test` or `file`; `folder` is INVALID. `settingsTestConfigs` takes no source/path/root. Existing trusted main-frame URL, sender and frame checks run before service calls. Existing BUSY/close/cancellation serialization applies, so config refresh/import cannot overlap preparation/game execution. Both fixed-instance read operations also take the existing outer and instance maintenance leases and refuse a pending file transaction rather than repairing it.

Specific source failures are explicit machine codes in **`reply.detail.code`**:

```ts
{ ok: false, code: 'INVALID', detail: { code: 'NO_TEST_RESULT' } }
{ ok: false, code: 'INVALID', detail: { code: 'TEST_OPTIONS_MISSING' } }
```

- `NO_TEST_RESULT`: no completed current-project test/exit record, project ID differs from the last result, runner unavailable, or the fixed instance no longer exists. A reset/new/open clears the in-memory last result. Merely having an old options.txt on disk does not create an options import result.
- `TEST_OPTIONS_MISSING`: the last test exists, but its options.txt does not. A crash/config-only result can still show config candidates.
- These detail codes are declared as `StudioTestSettingsError`; `TestSettingsFailure` carries them in main. The top-level INVALID category keeps the current renderer's error catalog type-correct within the assigned main/shared-only scope. This is one error envelope with category plus specific code, not a second format or legacy reader. The new UI should inspect `reply.detail?.code` first and localize the specific message. No new user-facing sentence was hardcoded in main.
- Malformed/unsafe options return existing INVALID without source detail. Other failures use existing IO/MISMATCH/BUSY/CANCELLED etc. No raw error/cause/provider data is added to replies.

## Exact state contract

All fields below are renderer-safe structural DTOs from `apps/admin/src/shared/studio.ts`.

- `StudioPresetPreview.source` now also accepts `'test'`.
- `testRun.extracted: StudioTestExtracted | null` extends the existing preset preview with:
  - `optionCount`: total parsed option entries, including keybinds (existing meaning).
  - `keybindCount`: vanilla plus mod keybinds.
  - `otherOptionCount`: `optionCount - keybindCount`.
  - `newConfigCount`: newly detected generic config paths absent from the current project's configFiles; excludes Iris/Oculus shader configs and includes unsupported config formats so the UI can direct users to the mod settings list.
  - `source: 'test'`, detection/skipped/importable paths and other preview fields. `importedConfigs` is the existing field name for parsed **candidates**, not evidence of a project mutation.
- `testRun.configFiles: StudioConfigFile[] | null`: parsed `.properties`/`.txt` candidates with current values and policy `none`. Null means not read/cleared/failed; [] means a successful scan with no supported candidates. Iris/Oculus are handled by existing shader parsing and excluded from generic configFiles.
- `testRun.configPreview: StudioPresetPreview | null`: config scan metadata, source test, optionCount/ignored = 0. `detected.modConfigs` paths are relative to config/, while `configFiles[].path`, importedConfigs and skippedConfigs[].path include the config/ prefix. Unsupported JSON/TOML/etc. appear in skippedConfigs rather than being silently parsed.
- `testRun.configError: string | null`: safe code for a config refresh failure. New source absence is NO_TEST_RESULT here. Clear stale candidates before refreshing; failures do not show a previous successful candidate list.
- `testRun.extractionError` still describes options extraction separately. Invalid options can yield extracted=null / extractionError=INVALID while configFiles/configPreview are available. Missing options at exit yields a zero-option preview; an explicit later import returns TEST_OPTIONS_MISSING.

At completion both options counts and config candidates are refreshed under the existing analysis lease. A later settingsTestConfigs refresh changes only candidate state; the last-exit extracted counts remain the last-exit snapshot. Neither operation merges values into project.gameSettings. To adopt an individual mod config value/policy, the future mod-settings UI may use the existing `settingsConfigItems` command with a validated config path and explicit changes/value; candidate display alone never calls that command.

The last test/import/config snapshot is transient. Test reset and project replacement clear it. Test options import requires the current session's completed test record; config refresh may read an already existing fixed instance after restart. The import rereads current instance bytes under leases rather than applying an immutable cache of the exit preview. No source/instance/account paths are accepted through new IPC.

## Validation (actually executed)

Environment: Linux/WSL x64, Node `v24.21.0`, `corepack pnpm --version` = `10.34.7`, DISPLAY=:0. Existing coordinator Electron binary used read-only via `ELECTRON_OVERRIDE_DIST_PATH=/mnt/d/Projects/mclauncher/node_modules/electron/dist`; this worktree's frozen install has no downloaded Electron executable.

- `CI=true corepack pnpm install --frozen-lockfile --store-dir /tmp/auth-share-pnpm-store`: exit 0, all 5 workspaces, 374 packages reused / 0 downloaded. Necessary because the starting worktree predated the desktop-auth workspace link. No manifest/lockfile/workspace/root config changes. Log: `/tmp/testrun-main-02-install.log`.
- Scoped `corepack pnpm exec biome check --write` on modified main/shared TypeScript: passed; no remaining scoped diagnostics.
- `corepack pnpm exec vitest run apps/admin/src/main/test-run.test.ts apps/admin/src/main/game-settings.test.ts apps/admin/src/main/ipc.test.ts`: final **3 files / 49 tests passed / 0 failed / 0 skipped**, 5.46s. Includes 20 test-run tests, with seven additional cases plus updates to previous automatic-import assertions. Covers saved-project nonmutation/clean dirty state, explicit import/dirty, present/missing-key policies, independent config/shader preservation, no-result/missing-options, rereading instance bytes, invalid options independent of config scan, file selection/cancel, exact fields/inherited fields, trusted IPC, links and reset/project replacement.
- `corepack pnpm --filter @torchlauncher/studio typecheck`: final exit 0, main and renderer TypeScript.
- `corepack pnpm check`: **exit 0**, Biome 372 files / existing 37 warnings and 3 infos / 0 errors; core + desktop-auth + both app TypeScript; **96 test files passed / 4 skipped, 1,394 tests passed / 9 skipped / 0 failed**, 44.82s; both production app builds passed. Log: `/tmp/testrun-main-02-check.log`. Existing opt-in/live skips were not activated.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=/mnt/d/Projects/mclauncher/node_modules/electron/dist node scripts/smoke.mjs`: **exit 0**, launcher and Studio renderer/navigation/IPC/isolation/760px+1100px layout checks passed. Log: `/tmp/testrun-main-02-smoke.log`.
- Same DISPLAY/override with `node apps/admin/scripts/smoke-functional.mjs`: **exit 0**, Studio shell/splash/in-app unsaved dialog, existing pages, persistence, painted 760/1100px layout and isolation passed. Log: `/tmp/testrun-main-02-functional.log`.
- `git diff --check` and `git diff --cached --check`: passed.

Failures encountered and resolved:

1. Initial typecheck failed because stale worktree dependencies lacked the existing desktop-auth package link; frozen install restored it. A Biome attempt while pnpm was rebuilding node_modules could not find the binary; subsequent scoped checks passed.
2. A first focused run had **48 passed / 1 failed**: the new picker test expected sourceRoot as dialog's second argument, whereas the existing options picker passes undefined. Corrected the test expectation; product picker behavior was already correct.
3. An intermediate typecheck rejected newly added top-level StudioError members through the renderer's typed translation call. Replaced those members with the precise `detail.code` contract above, within allowed main/shared scope; no renderer/catalog file was modified. Final typecheck and complete check passed.

## Unrun / limits / next worker

- **미실행**: actual Microsoft login, real game launch/direct play, actual modpack logs/configs, Windows native execution, portable packaging. These require account/game/platform validation outside this synthetic service/UI smoke run. No tokens or private account/server data were used.
- The two smoke scripts validate the current renderer, which deliberately remains unchanged. They do not exercise an interactive new source picker or real test process. New service behavior is exercised with synthetic installers/processes and temporary files.
- Config parsing retains existing ASCII key=value `.properties`/`.txt` restrictions, depth 8 / up to 256 directories / 200 matched config files and existing per-file/item caps. Generic JSON/TOML/YAML are listed as unsupported. This task does not add a universal mod config editor or automatic policy adoption.
- Requested outside-scope follow-up for TESTRUN-UI-01: wire the two new commands; render `testRun.extracted` counts and config candidates independently from `project.gameSettings`; localize `NO_TEST_RESULT` and `TEST_OPTIONS_MISSING` using reply.detail.code; source labels must handle preset.source='test'. Keep explicit confirmation/selection in the app. No renderer changes were made here.
- No running validation/game/dev/auth processes remain after all commands settled; temporary logs/tools are environment-specific. No user approval is pending. #0 owns review, integration and integrated validation/completion.

## Scope receipt

`git diff --stat f390fa9...fef5a6f`:

```text
 apps/admin/src/main/game-settings.ts |  35 ++++-
 apps/admin/src/main/project.ts       |   6 +
 apps/admin/src/main/studio.ts        |  41 ++++--
 apps/admin/src/main/test-run.test.ts | 266 +++++++++++++++++++++++++++++++++--
 apps/admin/src/main/test-run.ts      | 126 +++++++++++++++--
 apps/admin/src/shared/studio.ts      |  24 +++-
 6 files changed, 455 insertions(+), 43 deletions(-)
```

The only additional path in the subsequent handoff commit is this document. Re-run `git diff --stat f390fa9...HEAD` on the final worker branch for the combined receipt. No renderer/preload/scripts/core/coordinator tracker/manifest/lockfile files changed.
