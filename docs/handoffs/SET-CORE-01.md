# SET-CORE-01 handoff

- Session: implementation worker (agent-2), task SET-CORE-01
- Branch/worktree: `feat/settings-core-shaders`, `.agents/worktrees/agent-2`; baseline main `c5035df`
- Implementation commit: `8284a53` (`feat(core): add settings policy v2 with config files and Studio builder API`); this handoff is committed after it.
- Scope touched: `packages/core/src/instance/settings/**`, `docs/settings-policy.md`, this file. No apps, other packages, root configs, lockfile or dependencies.

## What changed

- Policy `version: 2` adds `configFiles` (path -> `required`/`initial` key=value maps) for shader settings (Iris/Oculus `config/*.properties`, `shaderpacks/<pack>.txt`) and simple mod `.properties`/`.txt` configs. v1 files are parsed and applied exactly as before (v1 still rejects `configFiles` as unknown field). Rationale (old launchers must reject, not silently ignore, enforcement) is in `docs/settings-policy.md`.
- Safety model reused: strict JSON/limits, validated relative paths (`config/**`, `shaderpacks/<name>`, `.properties`/`.txt` only), maintenance lock, all edits planned in memory before any write, temp+fsync+atomic rename with stat check, line/CRLF/BOM/unknown-line preservation, initial never overwrites a user value, `always` sync ownership of a policy file is rejected (`config-owned-by-sync`).
- New state format `.torchlauncher-user/settings.json` v2 (per-file initial tracking) written only when config files have initial keys; v1 state still read/written otherwise.
- New files: `properties.ts`, `entries.ts`, `builder.ts`; tests `config.test.ts`, `builder.test.ts`. `checkPolicyAgainstProfile` moved from `api.ts` to `profiles.ts` (exported, used by the builder).
- One existing test changed: `settings.test.ts` "wrong version" used `version: 2` as the invalid example; now `version: 3`.

## API summary for STUDIO-MAIN-01

Import from `packages/core/src/instance/settings/index` (same relative-path style the launcher uses; it is not re-exported from the `@torchlauncher/core` root).

- `parseOptionsEntries(bytes|string)` / `parsePropertiesEntries(bytes|string)` -> `SettingEntry[]` `{key, value, kind: 'keybind'|'mod-keybind'|'other', group, valueType: 'boolean'|'number'|'json'|'text', reserved}`; throws `SettingsError` (`invalid-options`, `invalid-config`, `limit-exceeded`). `sortSettingEntries`, `classifyOptionKey`.
- `buildSettingsPolicy({options?, resourcePacks?, configFiles?, minecraftVersion?})` with items `{key, state: 'unset'|'initial'|'required', value}` -> `{policy, json, bytes}`; deterministic (sorted keys/files, empty sections omitted, `version` 1 unless config files, 2-space JSON + trailing newline) and validated by the launcher's own parser plus format-profile checks. `serializeSettingsPolicy(policy)`, `selectionFromPolicy(policy)` (reload a saved policy).
- Shader helpers: `shaderSelectionToConfigFiles({configPath?, enabled, pack, packOptions})`, `shaderPackOptionsPath`, `IRIS_CONFIG_PATH`, `OCULUS_CONFIG_PATH`.
- `validConfigPath`, `parseSettingsPolicy`, `describeManagedSettings(policy).configFiles`, `assertConfigFilesNotSyncOwned`.
- Studio must keep `options.txt` and the policy file out of deployed `always` files (existing rule) and must not put policy-managed `config/**` files in `always` either.
- Items rejected by design (surface as `SettingsError` messages): non-ASCII, backslash, padded values in config files; `resourcePacks`/`version` as plain option items; numeric key codes for key_ items.

## Required launcher call-site changes (for #0)

None required. `apps/launcher/src/main/product/service.ts` (`afterSynchronization`) already calls `applySettingsPolicy(root, {minecraftVersion, signal, ownership})`, which now applies v2 policies. Optional: `ApplySettingsResult` gained `configFiles[]` (per-file enforced/initial results) that the launcher may log; the field is additive. Compatibility note: launchers built before this change reject v2 policies with `invalid-policy`, so a Studio export that uses config files needs a launcher containing this commit.

## Validation (run in this worktree)

- `pnpm biome check --write packages/core/src/instance/settings`: no fixes remaining.
- `pnpm lint`: pass, 8 warnings and 3 infos, same counts as baseline (none in settings files).
- `pnpm --filter @torchlauncher/core typecheck`: pass. Root `pnpm typecheck` (core, admin, launcher): pass.
- `pnpm vitest run packages/core/src/instance/settings`: 4 files, 121 tests passed (settings.test, profiles.test, config.test, builder.test).
- Root `pnpm test` (`vitest run`, run once before the last test-only fix `'launch'` -> `'game'` lock purpose, which was a type error not a runtime change): 82 files passed, 4 skipped; 1239 tests passed, 9 skipped (pre-existing skips). Not rerun in full afterward; the settings folder was rerun and passes.
- Not run: `pnpm check` builds, `pnpm smoke` (no apps touched; needs display), Windows-specific behavior (symlink-dependent paths are exercised only through existing tests).

## Limitations

- Config file formats: `key=value` only, ASCII values only (Properties readers use ISO-8859-1); no TOML/JSON/Forge `.cfg`, no continuation lines, no `:`/space separators. Such files make apply fail with `invalid-config` (nothing modified) rather than guess.
- Iris/Oculus key names and file locations come from documented conventions, not verified against a real 1.21.1 game here (Oculus path especially). OptiFine's `optionsshaders.txt` is out of path scope.
- Vanilla keybind list is the 1.21.1 set; later versions may classify new vanilla keybinds as mod keybinds (group `key`-prefixed segment).
- Policy size limit stays 64 KiB; many per-pack option files can hit it (`limit-exceeded`). State retention is capped at 64 files.
- A malformed config file named by the policy blocks game launch the same way a malformed options.txt does.
