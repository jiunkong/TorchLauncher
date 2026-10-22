# Tool-independent continuation checkpoint

Updated: 2026-10-22 by #0 (Claude Code session). Read `AGENTS.md`, then `docs/progress.md` (source of truth for task
status, in Korean), `docs/work-distribution.md` (assignments, model policy, scopes) and the relevant `docs/handoffs/*.md`.
This file is a resume checkpoint, not the tracker. The next coordinator session will run on GPT/Codex; chat history and
session IDs are not needed.

## Active UI-PROD-01 functional workflow work

User approved starting UI-PROD-01, explicitly functionality before aesthetics. Read `docs/ui-production.md`.
#4 subagent `ui_prod_launcher` / agent-4 / `feat/ui-prod-launcher-flow` owns launcher renderer + app-local
smoke/handoff. #1 subagent `ui_prod_studio` / agent-1 / `feat/ui-prod-studio-flow` owns Studio app + root
`scripts/smoke.mjs` + its handoff. Both Luna medium initially; escalate only if actual task complexity warrants.
No image/theme/animation redesign, dependencies or new Studio features. Core/launcher IPC changes need #0 coordination.
#0 only docs/review/merge. Both workers are active; no new live login/server action requested.
Scope includes actual activity display, clear primary actions, advanced management relocation, page data/error/draft
handling, Studio step prerequisites/validation/save/cancel/retry and existing behavior preservation.

## Completed follow-up: parallel install and activity metadata

Previous planning registered UI-PROD-01; the newer approval and active assignments above supersede the
earlier idle state. Remaining later work is Studio branding/settings/packaging, native verification,
full QA and final own-app/release work.

User confirmed **server connection succeeded through the new UI**. Selected environment was Fabric
1.21.1/0.19.5; server log and restart cached-session restoration remain unverified. Do not request another
login/join merely to repeat this evidence. The user then pointed out slow sequential base installation and
requested future UI metadata distinguishing game installation/server mod downloads/etc.

#3 `install_parallel` (Sol medium) delivered `ee4ef86`, merged `424b787`: default6/validated1–16
bounded game+Java file pool, 128MiB expected-byte budget (oversized files alone), first-error/abort stops
admission and drains siblings before staging/lease cleanup, stable publication order, unchanged hashes/cache/recovery.
Also optional structured InstallActivity callback. No real download speedup/native Windows pool measurement.
#4 `install_activity` (Sol medium) delivered `e34e376`, merged `0717835`: ProductState.activity + gate
forwarding + optional awaited sync file started/completed callbacks. Metadata distinguishes game/Java/libs/assets/
loader/server-mod/resource-pack/server-config/server-file; relative paths only, unknown counts null.
Sync plan counts are not a completion percentage. Legacy progress callbacks keep their old timing.
Renderer not changed; future UI can consume the activity state already delivered over existing IPC.
Integrated `pnpm check` passed: **786 tests, 9 skips**, full types/Biome and both builds.
Both workers finished; branches can be retired to detached worktrees after status checks. #0 performed only
coordination/review/integration. User asked to be notified on completion. Do not automatically start UI redesign.
User's earlier native install/game processes must not be altered. Restart cached-session restoration remains unverified.

## Functional UI integrated (2026-10-22, Codex #0)

The user authorized functional wiring before design and explicitly reaffirmed #0 delegation-only.
New subagents (not resumed historical #1/#4 TUI sessions) implemented in the existing worktrees:
Studio `connect_studio` (Sol medium), launcher `connect_launcher` (Sol medium), root smoke
`connect_smoke` (Luna medium). All are finished. Read `docs/ui-integration.md` and their handoffs.

- Shared schema `987203c`/`2960fdb` integrated; Studio tip `27003a6` merged `e90b289`;
  launcher tip `fc1dbfb` merged `c21c4c5`, fixed-profile wording `5712b7f` merged `824441e`;
  smoke integrated `f99e7d4` with navigation/scrollbar followups through `d7452ec`.
- Integrated `pnpm check` passed: **747 tests, 9 skips**, full TypeScript/Biome and both builds.
  Root Electron smoke passed both apps at 760/1100px with IPC/isolation/navigation/real project save.
  Studio functional smoke passed actual editing/save/file policies/writer/reopen. The last wording-only
  change passed scoped Biome/renderer types and launcher rebuild; no redundant full test rerun.
- Screenshots `.cache/smoke/{launcher,admin}-wide.png` were inspected. WSL keychain is unavailable;
  launcher shows an explicit secure-storage error and never falls back to plaintext.
- User invariant: launcher gets exactly one preprovided server profile. No server picker, profile creator,
  address/URL editor or first-run server selection. Missing/invalid profile is an operator distribution error.
- Studio now persists projects, edits server/game/loader/URL/files/policies, generates torchpacks,
  checks remote identity and exports an operator-selected common binary + sidecar into an empty folder.
  Images, convenient settings editing, single-file packaging/signing and actual exported package run remain.
- Launcher wires account/cache restoration, bounded status ping, latest-only install/sync/policy/game launch,
  bounded logs/cancel/stop, mods, packs, usage/deletion and recovery. New UI's native login/join is unverified.

Next action is **user-led Windows UI validation**, not more UI design. User says either Fabric/NeoForge
test server is available; choose Fabric 1.21.1/0.19.5 to match last known Drive pack. No upload requested.
Read `docs/handoffs/UI-CONNECT-WINDOWS.md` for exact commands/checks. Ignored config already created:
`.cache/game-smoke-validation/ui-server.json`, from the existing ignored `live-url.txt` (do not print/commit).
The Windows clone was read-only checked clean on `verify/windows-reader-cancel`; switch main and pull
without discarding any new user work. No login/test is currently waiting in an agent process.
Record user-observed online counts, world entry, normal game exit and cached restore separately from tests.
Older checkpoint sections below are historical; consult current status/log and progress first.

## UI-BASE (2026-10-22, Codex #0)

The user authorized renderer foundations for both apps. Worker #1 implemented `f4b89c7` and cleanup
`af28d54`, integrated into main. Read `docs/handoffs/UI-BASE.md`. Each app now owns its local
components, pages, app-info hook, navigation and CSS tokens; no dependencies, main/preload or IPC changed.
Product actions remain disabled until real services are wired. UI-01/UI-02 and STUDIO tasks remain pending.
Integrated `pnpm check` passed: 705 tests, 9 skips, TypeScript/Biome and both builds. Linux/WSLg
`node scripts/smoke.mjs` passed both apps' navigation at 760px, disabled actions, IPC and sandbox checks.
Screenshots are ignored `.cache/smoke/{launcher,admin}.png`; inspected visually. Native Windows validation
of this UI change has not been run. No further task is assigned; await the user's next instruction.
The older checkpoint below describes the pre-UI baseline; inspect current git status/log before resuming.

## State at hand-off

- Coordinator checkout: `/mnt/d/Projects/mclauncher`, branch `main` at `fd328d0`, clean, no other local branches.
  Worktrees `.agents/worktrees/agent-1..4` are clean and detached at `a05e7ec` (old main). Start every task with a new branch from
  `main` (`git -C <worktree> checkout -b <branch> main`); never reuse a merged branch.
- Last integrated `pnpm check` (WSL/Linux, Node 24, pnpm 10.34.7): 705 tests passed, 9 skipped, all TypeScript/Biome and both
  app builds. Windows 11 `pnpm check` also passed (686 passed / 27 skipped / 0 failed) with the same code plus the reader fix.
- No agent is running, no login/live test is in flight, no uncommitted work exists. The user manages test servers.
- Supported targets: **Windows x64 and Linux x64**. macOS is deferred (user decision 2026-10-22), Linux ARM64 is unsupported.
  Game versions: 1.21.1 validated with NeoForge 21.1.264 and Fabric 0.19.5.

## Done and verified (see progress.md for commits)

Contracts/writer/reader (FMT-01..03), downloads (DL-01/02, Drive), sync engine (SYNC-01), Java/Minecraft install and process
runtime (GAME-01/04), loaders + latest-sync launch gate (GAME-02/03; Windows live joins to the user's NeoForge and Fabric
servers confirmed by the user), temporary public-Java auth (AUTH-03), stale-lock/crash recovery (GAME-05, real SIGKILL tests on
Linux and Windows), user cores USER-01 (user mods + disk-space check), USER-02 (options.txt policy + version profiles), USER-03
(server data root, usage, guarded deletion), BASE-03 (Windows check/smoke/package). All USER/GAME-05 modules are **core only**:
no IPC, no UI, not exported from `packages/core` (see `packages/core/src/instance/index.ts` for namespaced exports).

## Remaining work (task IDs from progress.md)

Ready: UI-01 (server online/ping core), STUDIO-01 (Studio project model). Waiting: UI-02 (needs UI-01; wires auth, sync, launch,
settings, mods, deletion, recovery, logs into the launcher), STUDIO-02, STUDIO-03, QA-01, RELEASE-01, RELEASE-02.
Deferred: BASE-04 (macOS), AUTH-02/AUTH-04 (own Microsoft app ID is blocked on Minecraft API approval; dev uses the public
Java title ID by user decision). Open product decisions are listed at the end of progress.md.
Recommended order: UI-01, then UI-02 (integration, Windows-verify cancellation/recovery paths), STUDIO-01..03, QA-01, RELEASE.
Do not start anything beyond the user's current approval; the user has approved tasks one set at a time.

## Facts that are easy to get wrong

- **Windows process behavior (measured):** a plain `spawn` child dies when its host (Node or Electron) is force-killed; a
  `detached: true` child survives. Product `process.ts` does not detach Java. Hence `held-live` after a Windows host crash is
  mostly theoretical but kept as a safeguard. Process start identity probing via PowerShell is stable.
- **Reader bug fixed:** gzip stage cancel could hang when zlib dropped the write callback (Windows, ~45%); fixed in `reader.ts`
  by also settling on the inflater `close` event. Root cause is believed to be Node-internal and was not isolated.
- **Windows test tuning:** `vitest.config.ts` raises timeouts on win32; symlink-dependent tests skip without Developer Mode (14
  skips); two `writer.test.ts` replacement tests are skipped on win32 (open-file rename EPERM); kill tests accept
  `child-pid-reused` as dead. If Windows timeouts recur, set `fileParallelism: false` for win32.
- **Drive:** the public link serves `Last-Modified` but no ETag and never 304; conditional requests are not used. The current
  Drive object is the **Fabric 0.19.5** empty pack (301 B, server ID `44444444-4444-4444-8444-444444444444`, deployment
  `66666666-6666-4666-8666-666666666666`); the NeoForge pack (305 B) exists only as an ignored local file. Regenerate with the
  writer if needed. The public URL is in ignored `.cache/game-smoke-validation/live-url.txt`; never commit or print it.
- **options.txt:** the 1.21.1 profile (data version 3955) is validated against a real file fixture
  (`instance/settings/fixtures/options-1.21.1.txt`, CRLF preserved via `-text`). Profiles `java-1.13-1.21` (1519-3954) and
  `java-1.21.2+` (3956-5023, Minecraft 1.21.2-26.3) are research-based and unverified; default policy `verified-only` rejects them.
- `authenticatedConnection: "not-asserted"` in game-smoke output is intentional; a join is proven only by the user or server logs.
- Do not merge worker branches that were produced outside the integration flow; verify with `pnpm check` on `main` after each merge.

## Environment, paths and artifacts

- WSL: working pnpm lives at `/tmp/torchlauncher-tools/node_modules/.bin` (add to PATH; check it exists, it is in /tmp and may be
  gone after a reboot — reinstall pnpm 10.34.7 there or use a project-local one). Worktree `node_modules` exist but the worker
  worktrees lack `prismarine-auth`, so `pnpm check` at the launcher typecheck fails in worktrees; run full checks on `main`.
- Ignored local artifacts (regenerate if missing): `.cache/game-smoke-validation/` (empty packs, manifest, `live-url.txt`),
  `.cache/sync-validation/` (older sync v1/v2 packs), `.testserver/` (NeoForge 21.1.264 server) and `.testfabricserver/` (Fabric
  0.19.5 server), both user-managed and read-only for agents, both on port 25565 (never run together).
- Windows: native validation clone `D:\TorchLauncherWindowsSmoke` (currently on branch `verify/windows-reader-cancel`; run
  `git checkout main && git pull` before use). Smoke data/game roots: `D:\TorchLauncherSmoke\auth` and
  `D:\TorchLauncherSmoke\games\<server UUID>` (holds both NeoForge and Fabric loader trees). Fabric/NeoForge launch command:
  `node scripts/game-smoke.mjs launch --data-dir ... --game-dir ... --loader <fabric|neoforge> --loader-version <0.19.5|21.1.264>
  --source-file <live-url.txt> --server-id 44444444-4444-4444-8444-444444444444 --server localhost:25565`. The Drive pack must
  match the loader being launched.
- Windows Claude verification sessions followed `docs/handoffs/WINDOWS-VERIFY.md` and `WINDOWS-READER-CANCEL.md`, wrote results on
  `verify/*` branches in the Windows clone, and #0 fetched them with `git fetch <clone path> <branch>:<branch>`. Reuse that pattern.

## Working method used (keep or adapt)

- #0 does not implement product code. Assign one worker per exclusive file scope, create the branch from `main`, require a
  handoff in `docs/handoffs/<ID>.md`, review the diff, merge `--no-ff`, run `pnpm check` on `main`, update `docs/progress.md`,
  delete the merged branch and detach the worktree. Shared files (root configs, manifests, exports, lockfile) go to exactly one worker.
- Model policy: `docs/work-distribution.md` has a GPT table and a Claude table. Under Codex use the GPT table. Escalate only for
  data-loss, concurrency, auth or process-lifecycle work; never keep high effort by default. User is cost-sensitive: prefer small,
  scoped tasks, one or two workers at a time, final full check once.
- Claude-specific: stopped subagents cannot be resumed (start a new one); a subagent's reported model may differ from what a UI
  shows — verify from the transcript model field if it matters.
- Never request credentials, tokens or private URLs. Real-account actions (Microsoft login, server joins) are done by the user.

## Pending user actions

None required now. Optional: enable Windows Developer Mode and run `pnpm exec vitest run packages/core/src/minecraft
packages/core/src/instance` to exercise the 14 symlink tests; decide the next task (UI-01 recommended).
