# STUDIO-MAIN-02 - Studio shader selection and mod config items (core settings policy v2)

Worker `agent-3`, branch `feat/studio-main-shaders`, base main `0e2b057` (STUDIO-MAIN-01 and SET-CORE-01 integrated).
Scope: `apps/admin/src/main/**`, `apps/admin/src/shared/studio.ts`, this file. No `packages/core`, renderer, preload, root config or lockfile changes.
Commit: `git log --oneline 0e2b057..feat/studio-main-shaders`. Not merged.

## What changed
`game-settings.ts` now builds the policy with core's `buildSettingsPolicy` + `shaderSelectionToConfigFiles` and reads config files with
`parsePropertiesEntries`; `classifyOptionKey` supplies keybind kind/group for options. The old hand-written v1 generator is gone.
- **Version choice:** the generated policy is `version: 1` unless at least one config file item (generic config or shader) is `initial`/`required`;
  only then `version: 2` (launchers without v2 reject it). `state.policy.version` tells the UI which one the build will contain.
- **Options order:** generated keys are sorted by core (deterministic output); earlier hand ordering is not kept.
- **Limit and validation errors are structured**, see Errors.

## Project schema (still schema 2, additive)
`StudioGameSettings` keeps `options`, `resourcePacks`, `shaderPacks` and gains optional fields; files without them still open.
```ts
StudioGameOption  { key, value, policy: 'none'|'initial'|'required', kind?: 'keybind'|'mod-keybind'|'other', group?: string, valueType?: 'boolean'|'number'|'json'|'text' }
StudioConfigItem  { key, value, policy, valueType? }
StudioConfigFile  { path: 'config/....properties|txt', items: StudioConfigItem[] }          // gameSettings.configFiles?
StudioShaderSettings {                                                                     // gameSettings.shader?
  configPath: 'config/iris.properties' | 'config/oculus.properties',                       // Fabric / NeoForge
  enabled: { policy, value: boolean },   // enableShaders
  pack:    { policy, value: string },    // shaderPack ('' = none)
  packOptions: { pack: string, items: StudioConfigItem[] }[]                              // shaderpacks/<pack>.txt
}
```
Parser limits: <=32 config files, <=512 items per file, <=32 pack option files, valid `validConfigPath`, iris/oculus paths only in `shader`.
`none` = not managed (core "unset"); `initial` = first configuration only; `required` = forced on every launch.

## Commands (all `request`; reply `{ok:true,state}` or `{ok:false,code}`)
| Action | Fields | Notes |
| --- | --- | --- |
| `settingsImport` (extended) | `source:'folder'|'file'` | folder import also reads `config/*.properties|txt` (not iris/oculus) into `configFiles`, `config/iris.properties` or `oculus.properties` plus `shaderpacks/*.txt` into `shader`. Re-import keeps chosen policies; values of items with policy `none` are refreshed, shader `enabled`/`pack` values are only refreshed while their policy is `none`. |
| `settingsConfigItems` | `path`, `changes: {key, policy, value?}[]` (1..512) | creates the file entry when new; unknown keys are created and need `value`; path must be `config/**.properties|txt`, not iris/oculus, else `INVALID` |
| `settingsConfigRemove` | `path` | `INVALID` if unknown |
| `settingsShader` | any of `configPath`, `enabled:{policy,value:boolean}`, `pack:{policy,value:string}` (at least one) | creates `shader` with defaults (iris, all `none`) |
| `settingsShaderOptions` | `pack` (file name; options file is `shaderpacks/<pack>.txt`), `changes` | creates the pack entry; same key rules |
| `settingsShaderOptionsRemove` | `pack` | |
Existing `settingsOptions`, pack commands and everything else are unchanged. Mutating commands validate the resulting policy with core before saving.

## State additions
`state.policy: {version: 1|2|null, bytes, limit: 65536, error: {code, message}|null} | null` (null until the project has `gameSettings`; `version:null` = no policy generated).
`error` is the current build failure of the project, or the reason the last settings command was rejected (cleared by the next successful settings command).
`state.preset` gained `importedConfigs: string[]`, `skippedConfigs: {path, reason: 'unsupported'|'invalid-config'|'limit-exceeded'|'unsafe-path'}[]`,
`shader: {configPath: string|null, packOptionFiles: string[]}|null` (`detected.modConfigs` still lists every file name found in `config/`).
Files that the policy edits (set items) are shown as `policy:'managed'` in `state.files`, and `filesPolicy` refuses them (`INVALID`).

## Errors
No new `StudioError` codes (so the renderer message map is unchanged). Reply code `TOO_LARGE` = policy over 64 KiB / too many files or items;
`INVALID` = any other policy problem (non-ASCII, padded or backslash values in config files, bad keys, numeric key codes, unsafe path, sync-owned file).
Read `state.policy.error.code` for the exact core code: `limit-exceeded`, `invalid-policy`, `unsupported-options-version`, or `config-owned-by-sync`
(a plain `always` file is also edited by the policy; `initial-only` is fine). `build` refuses (same codes, before any dialog or write) when the policy cannot be built.
Studio-side validation (`settings*` commands) rejects such changes so a saved project normally never reaches that state; it can after e.g. changing the Minecraft version.

## Compatibility notes
- Config file formats: `key=value` ASCII only (core limitation). TOML/JSON/`.cfg` mod configs are listed in `skippedConfigs` as `unsupported`.
- Shader pack names that are not ASCII-safe can be imported but cannot be selected as `required`/`initial` (policy value rule); the UI should show `state.policy.error`.
- Iris/Oculus file names/keys follow core's documented convention, not verified against a real game here.
- Export needs a launcher containing SET-CORE-01 when `state.policy.version === 2`; the UI should warn.

## Validation (WSL2, this worktree)
- `pnpm lint` exit 0 (8 warnings, 3 infos, same as baseline; none in Studio main/shared).
- `pnpm typecheck` passed; `pnpm build` passed.
- `pnpm exec vitest run` (repo): 84 files passed, 4 skipped; 1286 tests passed, 9 skipped. Studio: 83 tests; new in `game-settings.test.ts`
  (import of config/shader files, v1 vs v2 selection, 64 KiB rejection, value/path/shape validation, sync-owned conflict, re-import and schema round trip).
- `node scripts/smoke.mjs` passed for launcher and Studio (display available).
- NOT run: Windows, packaged apps, real Iris/Oculus files, a launcher applying the generated v2 policy end to end.
