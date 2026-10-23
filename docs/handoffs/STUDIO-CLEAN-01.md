# STUDIO-CLEAN-01 - close-request fix and development-phase compatibility cleanup

Worker `agent-3`, branch `chore/dev-compat-cleanup`. Rule applied: AGENTS.md "Development-Phase Compatibility" (no migration or legacy readers before first release).

## 1. Close request contract bug (fixed in main)
`StudioService.beginClose()` now clears the closing flag when it decides to ask the renderer, so while a close request is outstanding `save`/`saveAs`
(and any other command) are accepted instead of answered `BUSY`, as are `closeConfirm`/`closeCancel`. Test: `studio-features.test.ts` "accepts save and the close answers
while a close request is outstanding". Flow for the renderer: `save` (or `saveAs`), then `closeConfirm`; `closeCancel` to stay.
Renderer change NOT made (out of scope, for #0): in `apps/admin/src/renderer/src/adapters/discard.ts` replace `saveThenClose` with
```ts
export async function saveThenClose(studio: StudioController): Promise<boolean> {
  if (!(await studio.run('save'))) return false;
  await studio.answerClose('closeConfirm');
  return true;
}
```
(no `closeCancel` first, no `window.close()`), and drop the BUSY comment above it. `smoke-functional.mjs` still passes with the old renderer flow.

## 2. Compatibility code removed
- **Settings policy:** one format, `version: 1`, with optional `configFiles`. `version: 2` is rejected (`invalid-policy`). The state file `.torchlauncher-user/settings.json` is one format
  (`{version:1, initial: null | {keys, resourcePacks, files}}`, `files` always present); old state shapes are `invalid-state`. Changed: `policy.ts`, `types.ts`, `builder.ts`, `io.ts`, `api.ts`,
  tests (`config.test.ts`, `builder.test.ts`, `settings.test.ts`), `docs/settings-policy.md`. `apps/launcher` is untouched (it only calls `applySettingsPolicy`; builds and tests pass).
- **Studio project schema:** one schema, `version: 1`, `lastBuild`/`gameSettings` optional. The version 1/2 split, the "v1 must not carry v2 fields" rule and every `version: 2` bump are gone;
  a `version: 2` file (earlier development builds) is rejected with `INVALID`. `StudioProject.version` is the literal `1`.
- **Studio state:** `state.policy` is now `{generated: boolean, configFiles: number, bytes, limit, error}` (the `version` 1|2 field is gone, nothing in the renderer used it).
- **Dead code:** removed `exportLauncher` (folder exporter), the unused `output` dialog kind (service type and `index.ts` title), `countPolicies`, and the tests that only exercised the folder exporter
  (replaced by equivalent `exportLauncherZip` tests: bytes/mode, abort cleanup keeps the previous file, mislabeled/linked/non-executable binaries, sidecar validation).
  `smoke-functional.mjs` expects project `version` 1.
- Kept on purpose (not compatibility): plain `options.txt`/`resourcepacks/` file entries still build for projects without `gameSettings` (a normal file list, not a format reader).

## 3. Font licenses in the packaged Studio
`apps/admin/electron.vite.config.ts` now emits `font-licenses-NOTICE.txt` (Pretendard Variable and Pixelify Sans OFL texts from `third-party/*/LICENSE`) into `out/main`, the same plugin approach as the
launcher, so it ships inside the asar via the existing `files: out/**/*`. Verified in `pnpm --filter @torchlauncher/studio build` output; the packaged archive itself was NOT built/inspected.

## Left alone (list only): deployment container versions and signing
`packages/core/src/deployment` still reads 1.0, 1.1 and 1.2 (`contracts/types.ts`, `contracts/validation.ts`, `reader/reader.ts`: `minor === 2` signed path, branding 1.1 path, `signature-required` for unsigned
containers when a key is configured), the writer emits 1.0 without branding/sequence/sign, 1.1 with branding, 1.2 when signing; `docs/deployment-format.md` documents all three, including "old launchers reject 1.1".
Collapsing these to one container version is a separate decision (touches the writer, reader, launcher sync, fixtures and the format spec).
Other things seen: launcher sync code that handles deployments without signing keys, and Studio's signing key store backup format has its own version field (`torchlauncher-signing-backup` v1, `BACKUP_UNSUPPORTED`), unchanged.

## Validation (WSL2, DISPLAY=:0)
- `pnpm lint` exit 0 (37 warnings, all in renderer CSS/pages from earlier tasks; none in files touched here), `pnpm typecheck` passed, `pnpm build` passed.
- `pnpm exec vitest run`: 89 files passed, 4 skipped; 1298 tests passed, 9 skipped.
- `node scripts/smoke.mjs` passed (launcher and Studio), `node apps/admin/scripts/smoke-functional.mjs` passed, `node apps/admin/scripts/branding-smoke.mjs` passed.
- Not run: Windows, packaged apps (`package:studio`).
