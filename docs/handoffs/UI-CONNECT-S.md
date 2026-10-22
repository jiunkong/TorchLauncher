# UI-CONNECT-S — functional Studio

Worker: #1 (`connect_studio`), 2026-10-22. Coordinator remains #0.
Worktree: `.agents/worktrees/agent-1`; branch: `feat/ui-connect-studio`.
Baseline: `e031859`. Implementation commits:

- `987203c`: shared portable server configuration parser and tests.
- `2960fdb`: coordinator-requested support for self-hosted HTTPS URLs, including localhost/IP literals.
- `02eafa0`: validated project model, main-owned selections, persistence, writer/reader/export service, narrow trusted IPC and behavioral tests.
- `629e5c4`: functional React editor/workflows and reusable Electron smoke helper.
- `b8407d0`: real writer cancellation test, fresh pre-copy URL check, portable smoke corrections.

No integration/merge performed. No root manifest, lockfile, desktop contract, public exports, root smoke script or tracker edited.

## Implemented

- `packages/core/src/server-config/index.ts`: pure `parseServerConfig(unknown): ServerConfig`, `SERVER_CONFIG_FILENAME`. Exact six-field v1 format from `docs/ui-integration.md`; UUIDv4, bounded clean name, host:port (including localhost/IPv6), bounded HTTPS URL without credentials or fragment. Self-hosted HTTPS and public Drive links are allowed; no Google account integration.
- Native create/open/save/save-as workflow and strict `torchlauncher-project` v1 model. Bounded regular-file reads, no links, atomic temporary-file save and validated relative file paths, policies/game/loader. Server ID stays stable for a project's lifetime. JSON carries metadata, source URL, game and file policies; absolute source/target paths are never accepted from the renderer or persisted in the project.
- Local renderer drafts mark main's project dirty immediately (`touch`), including invalid/incomplete text. Save/build/check/export first validate/apply the draft. New/open/close prompt before discarding. Reopening a project explicitly requires source folder reselection; the UI explains this.
- Main owns authorized source/target paths from native dialogs. Arbitrary regular files inside the selected source root can be added, removed and assigned `always`/`initial-only`; no extension allowlist. Core validation/writer retain path/collision/protected-file and source-change rules. Payloads use `compression: none` to support arbitrary binary/compressed inputs without ratio surprises.
- Actual existing writer generates `.torchpack` with progress/cancel. Cancellation preserves a prior committed output and removes temporary staging. Native save dialog authorizes replacement for pack/project save; export never replaces an existing file.
- HTTPS/Drive source factory and real deployment reader check header/index integrity and exact server ID, Minecraft version, loader kind/version. Export repeats this check after output/binary selection and immediately before copying. This checks metadata; it does not download every payload or prove a full live game installation.
- Folder export copies an operator-selected existing `.exe` or `.AppImage` plus strict `torchlauncher-server.json` into an empty selected directory. Copies are bounded (2 GiB binary cap, 1 MiB buffer), use exclusive creation, preserve source permissions, reject links, check source/output identity and clean only owned files on cancellation/error. AppImage requires executable bits. MZ/ELF headers identify file type only: the operator remains responsible for selecting the correct trusted common launcher; authenticity/signature is not asserted. No binary is downloaded, rebuilt or executed.
- Trusted main-frame IPC with sender/window/URL checks before dialogs; strict action shapes; safe fixed error codes; serialized mutations, safe state/cancel requests while busy; shutdown aborts and awaits work and rejects new mutations until an explicit resume if discard is declined. The renderer has only application info and typed request methods, with Node disabled/context isolation/sandbox retained.
- Korean forms for server/game/loader/source URL, file policies, save state, progress/cancel, URL inspection and export. Optional custom branding images and single-file repackaging/signing remain unimplemented and are stated in the UI.

## Validation

Final targeted suite: `pnpm exec vitest run apps/admin packages/core/src/server-config` — **3 files, 23 tests passed** (13 Studio service/export tests, 1 IPC test, 9 schema tests). Behavior includes actual persistence, writer/reader/staged bytes, both file policies, full service export, exact server/game mismatch, malformed/forged inputs, post-dialog cancellation, shutdown blocking, writer mid-read cancellation, bounded export cancellation cleanup, permission preservation and a foreign config appearing mid-copy.

- `pnpm --filter @torchlauncher/studio typecheck` — passed.
- `pnpm exec biome check apps/admin packages/core/src/server-config` — passed, no warnings.
- `pnpm --filter @torchlauncher/studio build` — passed, main/preload/renderer production outputs.
- Linux/WSLg Electron functional smoke passed via `apps/admin/scripts/smoke-functional.mjs`: actual renderer editing, native dialog adapters, real JSON save, arbitrary file selection, policy change, actual writer generation, reopen/source reselection and isolated bridge. The test stubs native dialog responses; it does not claim manual native-dialog interaction or a real distributed launcher package run.
- Screenshot `.cache/smoke/studio-functional.png` (ignored in worker worktree), inspected at 760px width. No renderer errors observed.

Worker dependencies were already present. Its Electron binary download was missing, so smoke used the existing coordinator executable as a tool (no node_modules sharing or dependency/lockfile edits):

```sh
PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH" pnpm --filter @torchlauncher/studio build
TORCH_STUDIO_ELECTRON_EXECUTABLE=/mnt/d/Projects/mclauncher/node_modules/electron/dist/electron node apps/admin/scripts/smoke-functional.mjs
```

With an installed worktree Electron binary the override is unnecessary. Helper uses `tmpdir()`/`process.platform` for portability. Native Windows execution of these new flows, live remote HTTPS/Drive retrieval, real portable-package export/run and manual native dialogs remain unverified. Reader transport is injected in unit tests; existing core HTTPS/Drive implementations are used in production. No login, server connection or signed binary claim is made.

## Resume / integration

All requested implementation is committed; no running worker processes are intended to remain. Only the ignored screenshot/build outputs and environment-local test helper artifacts exist outside tracked source. No secrets/private URLs are in this handoff.

#0 should review/integrate the commits in order (schema may already be integrated separately), run integrated checks and update the root smoke expectations for the new bridge/actions. The new app-local smoke can be rerun directly. Windows verification and live operator packaging remain separate evidence to obtain on those environments. No user input blocks code integration.
