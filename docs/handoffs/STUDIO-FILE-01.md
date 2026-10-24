# STUDIO-FILE-01 handoff

Worker session: agent-2. Branch `feat/studio-project-file`, created from main 4b6db22; main merged in
afterwards (STUDIO-MENU-01 and the `.torchproj`/`.torchkey` spec update; the merge was conflict free).

## Behavior
- New pure codec `apps/admin/src/main/project-file.ts`: `encodeProjectFile(project, snapshots) -> Buffer`
  and `decodeProjectFile(bytes, decode) -> { project, snapshots }` (zlib/crypto only). Deviation from the
  spec signature: the image bytes are passed separately because the in-memory `StudioProject` holds only
  image metadata, and a pixel decoder is required to keep the existing `validateImage` checks.
- Output is deterministic (recursively sorted META keys, fixed deflate level, fixed section order).
- Strict decode: magic, format 1, flags 0, 1-8 sections, trailer SHA-256, per-section SHA-256, unknown or
  duplicate id, section length beyond file, trailing bytes, META inflate capped at 8 MiB (`maxOutputLength`),
  `parseProject` on META, ICON/BGND present exactly when branding metadata names them and matching
  length/hash/media type/dimensions, 32 MiB file cap. Sections may appear in any order.
- Studio save writes the bytes through the existing atomic `saveProject` (now accepts string or bytes); open
  reads with `safeRead(PROJECT_FILE_LIMIT = 32 MiB)`. Old `encodeProject/decodeProject/PROJECT_READ_LIMIT`
  were removed from `branding.ts`. JSON or any other bytes open as `INVALID`; no legacy reader.
- Extensions per #0 decision: `.torchproj` (filter "TorchLauncher Studio 파일", default `server-project.torchproj`),
  key backup `.tlkey` renamed to `.torchkey` (default `signing-key.torchkey`, content unchanged).
- Renderer: no change (the catalog has no text naming the JSON file). Preload and packages/core untouched.
- Note: `update` compares branding/lastBuild/gameSettings with `JSON.stringify`, so key order matters; a
  reopened project now has sorted keys, so tests send back the snapshot object rather than a hand-built one.

## Files
`apps/admin/src/main/{project-file.ts,project-file.test.ts,branding.ts,filesystem.ts,studio.ts,index.ts}`,
tests `branding/game-settings/signing/studio/studio-features/test-run .test.ts`,
`apps/admin/scripts/{smoke-functional,branding-smoke}.mjs`, `scripts/smoke.mjs` (saved-file assertion only),
this handoff. Smokes read the file with a small `readStudioFile` helper (magic, trailer and section hashes,
inflate META). The root smoke does not reopen the file through the app (native dialog flow); reopening is
covered by the functional smoke and unit tests.

## Validation (Linux/WSL, DISPLAY=:0, pnpm via corepack wrapper)
- `pnpm check`: passed, 1453 tests passed / 9 skipped, Biome, tsc and both builds clean.
- `pnpm build`: exit 0.
- `node scripts/smoke.mjs`: both apps passed (Studio save asserts the .torchproj container).
- `node apps/admin/scripts/smoke-functional.mjs`: passed.
Commands were run after merging main.

## Not verified
Real Windows, packaged builds, `branding-smoke.mjs` (only renamed its path, not run), real PNG/JPEG
decode of large images through the file (unit tests use a 1x1 PNG with a fake decoder).
Docs: `docs/studio-project-format.md` already described the final format; no other doc needed edits.
