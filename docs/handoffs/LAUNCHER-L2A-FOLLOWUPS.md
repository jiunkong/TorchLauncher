# LAUNCHER-L2A-FOLLOWUPS

- Worker/session: #2 `launcher_followups`; task L2a followups + exclusive shared player-skin wiring.
- Worktree: `.agents/worktrees/agent-2`; branch `feat/launcher-l2a-followups`.
- Initial baseline: `08244b2`; implementation checkpoint `f35b8ed`; coordinator main `986600b` incorporated into this worker branch with `fc91f4f`. Final implementation commit is reported to #0 with this handoff.
- Astra medium was requested for the deletion safety boundary. Actual UI model/effort setting was not independently verified.
- #0 owns main integration and full `pnpm check`. This worker did not merge into main or edit the progress tracker. No additional agents.

## Implemented

- Exact no-argument `open-logs` command: only current configured server's canonical `logs` directory reaches host `shell.openPath`. Core validates base/servers/server-root directory ancestry; app validates logs directory type, rejects symlinks/junctions and canonical mismatch, rechecks ancestry, rejects missing paths and shutdown. No creation, process stop, arbitrary path/URL/command input, or raw OS error exposed.
- This read-only command bypasses the running-game Operations slot and preserves deletion confirmation/state. The narrow `hooks/useProduct.ts` addition was explicitly approved by #0: no in-flight/pending/memory-lane mutation and no result snapshot replay over newer events. The log page reports failures locally.
- `serverDataRoot` is derived from trusted base/config separately from usage/deletion. Settings shows its location without issuing a deletion preview. Missing/unqueried usage remains null; no invented zero-size success.
- Separate `remove-unregistered {path}` accepts non-jar files under exact `mods/` relative paths. Closed IPC validation rejects traversal, controls, backslashes, ADS, trailing separators/dot/space and extra fields. Existing Operations, ensure/root checks and core `removeUnregistered` locked ownership/registry/path validation remain authoritative. Managed files and directories are refused; mod listing refreshes after success.
- App-root confirmation names the exact path, starts on cancel, traps focus through existing Modal, and makes the app shell inert. Confirm disables when the file ceases to be unregistered or game/operation is busy. Non-jar files do not show the jar-adoption action. Existing registered-mod confirmation and server-data confirmation tokens retain their behavior.
- Injected optional `ProductHost.skins` and `account.skin` use #3's validated service. Login, restore and game authentication start cosmetic background lookup without awaiting it. Abort/generation/account-object guards reject late updates, including same-account refresh races. Logout, authentication failure and shutdown abort/clear. Production creates the service; App/Menu pass only the skin data URL to PlayerAvatar. Test hosts without skins never make skin requests.
- Plain numeric memory entry, hidden spinners, removed recommendation/save-success text and absent Home recent-result remain intact.

## Validation (Linux/WSLg, Node 24.21.0, pnpm 10.34.7)

Commands use `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`.

- `pnpm exec vitest run apps/launcher/src/main/product apps/launcher/src/main/skins apps/launcher/src/renderer/src`: **21 files, 200 tests passed**.
- `pnpm --filter @torchlauncher/launcher typecheck`: passed.
- `pnpm --filter @torchlauncher/launcher build`: passed, including imported skin service and avatar CSS.
- Biome check on all changed launcher TS/TSX/MJS paths compared with `986600b`: passed (17 files).
- `node apps/launcher/scripts/renderer-functional-smoke.mjs`: passed with production build. Verifies temporary non-jar cancellation preserves bytes, confirmation deletes the fixture, settings location appears without deletion preview, missing log folder fails visibly, memory behavior/regressions, and a synthetic local 64x64 PNG account event decodes through App → Menu → PlayerAvatar face/hat layers. No real login, account, user server, file deletion or external shell opening.
- Safety regressions cover managed/registered-file refusal, live-child lock preservation, active launch rejection of deletion, read-only log opening while game lifetime is held without stopping it, missing/link paths, linked mods ancestor preserving outside bytes, confirmation preservation, late skins and skin failure fallback.
- Initial smoke failures were harness assumptions: cancel text varies by locale; async IPC polling returned before removal settled. Selectors now use the safe autofocus button and wait for the removed row to detach before checking the filesystem. Final run passes.
- Ignored screenshots in worker `.cache/smoke/` were refreshed by smoke. No credentials/private URLs in artifacts committed here.

## Remaining / resume

- Implemented and worker-tested; main integration/full checks belong to #0.
- Windows native junction/shell behavior, real Microsoft authentication/skin network result and actual game launch remain untested in this task. Link tests skip Windows and exercised Linux symlinks here. Successful OS shell opening is mocked in tests; smoke checks the safe missing-folder failure.
- No running validation process at handoff, no pending user action. Toolchain paths and ignored outputs are environment-specific.
- Resume: inspect this branch/status, review diff against `986600b`, then #0 integrates and runs its planned full validation. Do not reset/clean worker paths or reuse old test claims after changes.
