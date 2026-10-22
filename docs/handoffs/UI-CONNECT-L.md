# UI-CONNECT-L — launcher functional integration

Worker: TorchLauncher #4 (`connect_launcher`). Date: 2026-10-22.
Branch/worktree: `feat/ui-connect-launcher`, `.agents/worktrees/agent-4`.
Initial baseline `e031859`; updated from coordinator `main` through `9f83908` for the shared server config.
Implementation commits: `ae0083b` (settings/launch boundary), `5f542dc` (main/IPC/status),
`6c42f65` (UI/cached restore), followed by this handoff/final hardening commit.
Not integrated by this worker. No tracker, manifests, lockfile, shared desktop, or smoke script changes.

## Implemented

- Main reads one bounded regular, nonlinked `torchlauncher-server.json` using shared schema. Development
  `TORCH_SERVER_CONFIG` override; portable executable/AppImage directory and app-path development defaults.
  Server identity/address/name reach the renderer; source URL and raw config errors do not.
- Exact validated app-local IPC command union, trusted sender + main frame + renderer URL checks, narrow preload
  `getApplicationInfo`, `getState`, `command`, `onState` (unsubscribe). Existing CSP/isolation/sandbox retained.
- Main owns `<app.userData>/servers/<UUID>` and separate `authentication/public-java` encrypted auth cache.
  Electron single-instance lock also protects the encrypted auth cache across launcher processes.
- Login/logout/refresh and noninteractive startup cached-session restoration. Missing cache is clean idle;
  secure-storage failure is explicit. Passwords/codes/tokens/argv/source URL never enter product snapshots.
- Bounded TCP Java status protocol: framed VarInts, strict size/count/UTF-8/JSON limits, total timeout,
  abort/socket cleanup, nonce-matched pong latency. Only counts/version/latency are returned, no MOTD/favicon.
  Protocol source: https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping (browser search verified
  handshake/status/ping contract; direct page fetch was denied by robots.txt).
- Play installs base Minecraft 1.21.1 + deployment-selected Fabric/NeoForge, refreshes auth, performs mandatory
  fresh synchronization, applies settings, then retains the existing final remote/local game-lease guard.
  Windows/Linux x64 explicitly supported. Process spawn never claims authenticated server connection.
- Minimal optional trusted `afterSynchronization` hook in launch gate, and optional host launcherVersion.
  Settings ownership callback resolves inside the existing maintenance lease for both policy application
  and user resourcepack writes; null/error/always-owned options prevent writes. Old object callers preserved.
- Main operation exclusion lasts through cancellation cleanup and the entire Java lifetime. UI progress,
  cancel/stop, safe bounded recent logs, account state, recovery inspection and guarded recovery are wired.
  Quit aborts active work and waits for Java/auth cleanup. Auth helper-window closure cannot quit the app.
- Native-selected user JAR addition, listing, registered removal, unregistered adoption; core ownership/conflict
  rules retained. Resourcepack list/order editing preserves operator-required rules.
- Usage, exact deletion preview, root-bound single-use confirmation token, native final confirmation, and
  resumable deletion UI. Other servers and auth cache are outside the deletion target.

## Validation

Environment: Linux/WSL, Node 24.21.0, pnpm 10.34.7. Worker dependencies required a frozen reinstall because
old modules lacked Linux native binaries; install succeeded with no manifest/lockfile change. Worker Electron
binary was absent after install, so real UI validation used coordinator checkout's existing Electron binary
as the executable (worker's own compiled app and Playwright dependencies).

- `pnpm exec vitest run apps/launcher/src/main packages/core/src/server-status packages/core/src/loaders/launch-gate.test.ts packages/core/src/instance/settings`
  — **16 files, 142 tests passed**, zero failures. Includes existing auth/game-smoke regression tests.
- `pnpm --filter @torchlauncher/launcher typecheck` — passed.
- `pnpm --filter @torchlauncher/launcher build` — passed (main/preload/renderer).
- Scoped Biome check — passed (55 files before final small presentation/single-instance change; final changed
  files also checked/formatted). `git diff --check` passed.
- Real Electron/Playwright preview at 760px: config read, preload isolation, forged extra-path command refusal,
  UI navigation, real mod listing, empty resourcepack defaults, usage and deletable preview passed; zero page errors.
  Ignored screenshots `.cache/ui-connect/home.png` and `settings.png` inspected; temporary test config/userData
  removed. Local harness `/tmp/launcher-ui-preview.mjs` is untracked/environment-specific.
  Initial harness expected `vanilla`; corrected to the core's actual verified 1.21.1 default `[]` and reran successfully.
- Real filesystem service tests cover native-selected JAR copy/removal/adoption, operator-file protection,
  required packs, stale/wrong deletion confirmations and preservation of other servers/auth data.
  Injected process-host test checks policy before game gate and exclusion until Java reaping; it does not prove
  actual game launch or authenticated join. Gate tests retain final network/local checks and policy failure blocking.

## Limits / next steps for coordinator

- No new real-account login, Java/gameplay join, native Windows execution, or portable package validation was
  performed for this UI change. Those require the prepared user validation flow after integration/build.
- Linux encrypted login requires a supported OS keychain; this WSL desktop reports unavailable secure storage.
  No plaintext fallback is provided. Mock and existing auth tests are separate from live authentication evidence.
- Dialog cancellation is handled when the native dialog returns; an open native chooser/confirmation may need
  dismissal before application shutdown finishes. All subsequent mutation is gated by the aborted signal.
- Recent logs are bounded in memory for the current launcher session; they are not a persistent log archive.
- Shared smoke script must be updated by its assigned owner for the four bridge keys and working product controls.
  Run integrated `pnpm check`/Electron smoke on `main`; do not treat worker checks as integration evidence.

No worker processes remain after validation; no pending user action was requested. Next action: coordinator
review/integration, full checks, smoke, then user-led Windows login/launch validation when a concrete build is ready.
