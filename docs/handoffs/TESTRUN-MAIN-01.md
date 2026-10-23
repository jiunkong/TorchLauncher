# TESTRUN-MAIN-01 — Studio test execution main-process handoff

- Session/model: Codex implementation worker `agent-2` / GPT-6; not coordinator #0.
- Task: TESTRUN-MAIN-01. Branch: `feat/testrun-main`.
- Worktree: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-2`.
- Baseline: `57c6fcd` (main after AUTH-SHARE-01 merge `5c85c12`, TESTRUN-CORE-01 merge `88107e4`).
  Coordinator and both candidate worker checkouts were clean/detached before selecting agent-2.
- Initial implementation commit: `37023d8`.
- Final implementation commit: `be9213b2db32244cacc5d031ee76248f256b61d7` (bounded recovery journal + large-file checks).
- Final documentation commit: resolve with `git log -1 -- docs/handoffs/TESTRUN-MAIN-01.md`;
  also reported in the final response to avoid a self-referential hash.
- Not integrated into main. No progress/distribution/coordinator documentation, renderer or core edits.
  #0 owns review, integration and completion decisions.

## Scope and authorization

User explicitly approved adding `@torchlauncher/desktop-auth: workspace:*` to
`apps/admin/package.json` and its link in `pnpm-lock.yaml` (Studio importer, 3 lines).
No external dependencies, dependency versions, root config or workspace structure changed.
All other changes are within admin main/shared and its authentication worker build configuration.
Preload and root smoke bridge lists stay unchanged: the existing validated request/state transport
handles the new commands. This deliberately keeps renderer implementation assigned to TESTRUN-UI-01.

## Main implementation

- Studio owns `app.getPath('userData')/public-java`, its own single-instance lock, Electron safeStorage,
  local sandboxed device-code window and fixed Microsoft browser URL. No launcher imports or shared
  session store. Device text comes from a small ko/en main-process catalog with a parity test.
- Linux insecure/missing keyrings fail closed with `secure_storage_unavailable`; no plaintext or
  memory-only login fallback. Existing encrypted snapshots can still be removed by logout.
  No background browser login is attempted: testLogin is explicit; testStart refreshes the stored
  session silently before preparation and again before launch. Initial signedIn is false until a
  successful login/start. A persisted session can refresh without opening a device prompt.
- Instances: `<userData>/test-instances/<serverId>/`; game runtime/base/loader data are app/instance
  owned and never shared with the launcher. Source and instance must be disjoint, UUID is validated.
- An outer core maintenance lease at `<userData>/test-instance-locks/<serverId>/` spans preparation,
  game execution and analysis. Installers, file application, settings, game and analysis also use
  the appropriate existing core instance leases. Operations are serialized with project editing.
- `buildPlan` computes the current deployment candidate. Disk and selected pack entries go through
  `planTestInstance`, while generated policy bytes are written only inside the test instance.
  Raw settings-owned options/pack exclusions follow the same build plan. Source files are opened
  read-only and streamed into verified staging files. Pack digests must match the project snapshot.
- `test-instance.ts` implements staged backups, a bounded journal, before/after digest checks,
  verified copy/removal and atomic ledger replacement after the entire plan succeeds. In-process
  failures/cancellation roll back; persisted applying journals roll back in a later invocation.
  Recovery refuses later local edits, unknown journal formats and unsafe paths instead of guessing.
  Required always candidates skipped as unowned/modified block launch with MISMATCH; personal
  initial-only changes remain preserved. The core pre-spawn callback verifies managed always files
  under the game lease and rejects a remaining file transaction.
- `installStudioTestGame` uses core installMinecraft + exact installLoader. Progress reports actual
  installation activity/counts, loader totals remain unknown. Core applySettingsPolicy runs against
  the instance using the project's game version. No torchpack, signature or server connection is made.
- `launchMinecraft` receives current owned-account credentials in main only, without Quick Play args.
  Its existing SIGTERM -> 5-second grace -> SIGKILL and child reaping are reused. Stop waits for exit
  and analysis; cancellation/close aborts preparation or the child and waits for cleanup. No detaching.
- During the game, sanitized logs are refreshed every 250 ms. Renderer snapshots retain 300 lines,
  256 KiB, at most 8 KiB per line. Core process capture retains up to 10,000 lines / 1 MiB for analysis;
  truncation prevents a no-problems-found claim. Known account/token values, token fields, controls,
  command-line identities and home user names are sanitized before display. Account name is exposed
  only through account.name. Raw errors and auth results never cross IPC or reach application logs.
- Exit analysis uses core analyzeGameLog and readModMetadata; newest crash report created since this
  launch is read with a 4 MiB cap. Up to 512 top-level mod jars (64 MiB each) and 1 MiB of aggregate
  metadata are retained. Jar failures get safe per-file codes. A requested normal stop does not
  itself become an abnormal-exit error; observed loader/crash patterns still count.
- Settings extraction reuses one internal importPreset merge for both settingsImport and test-run
  results. Selected policies are retained and options/config/shader keys refreshed. The instance
  root is fixed in main; no new path IPC. Missing options is allowed for test extraction so crash
  runs can still yield config/shader data. Folder imports now traverse config subdirectories with
  bounded depth/counts. Source is never written by test execution or extraction.
- testReset requires confirmed:true, takes the instance leases, refuses links and removes only that
  project's instance. Accounts, source, other projects and the outer lock directory stay outside it.
  The renderer's in-app confirmation modal is the follow-up UI task; no native confirmations added.
- Studio builds public-java-worker.cjs plus library/protocol/metadata chunks and prismarine-auth-NOTICE.
  Keep all main output chunks and notices in packaging. Existing out/**/* packaging rules include them;
  packaged archive execution has not been performed here.

## Exact IPC/UI contract

Use the existing `window.torchlauncher.request(command)` / `studio:request` channel.
All commands validate exact own fields, action and types; the existing handler rejects other windows,
subframes and navigated frames before any service call. No new bridge key/channel was exposed.

| Command | Exact payload | Behavior |
| --- | --- | --- |
| state | `{action:'state'}` | Safe snapshot, also available during any operation. |
| testLogin | `{action:'testLogin'}` | Explicit Microsoft public Java login; awaits complete cleanup. |
| testLogout | `{action:'testLogout'}` | Cancels a pending login/preparation, stops a running game, waits and clears Studio auth. |
| testStart | `{action:'testStart'}` | Needs project and source; refresh -> prepare/install/sync/settings -> game -> analysis/extraction. |
| testStop | `{action:'testStop'}` | Cancels preparation/login; for a running game requests normal stop then awaits analysis. Idle is harmless. |
| testReset | `{action:'testReset',confirmed:true}` | Current project's instance only. False/missing/nonboolean/extra fields are INVALID. |
| cancel | `{action:'cancel'}` | Existing cancellation command also aborts active test operations. |

Long requests stay pending: UI must start them without blocking its state polling/stop controls.
Poll state (e.g. every 250 ms) to observe progress/logs; no event subscription was added. Stop/logout
bypass BUSY for active tests but wait for the preceding request to settle; other project mutations
remain BUSY. Test commands are BUSY during shutdown/close confirmation. Existing close() aborts and
awaits the test child and operation before allowing the usual unsaved-project modal.

StudioState additions (required fields, renderer-safe structural DTOs defined in shared/studio.ts):

```ts
account: {
  signedIn: boolean; name: string | null; available: boolean; error: string | null;
};
testRun: {
  phase: 'idle'|'preparing'|'installing'|'syncing'|'running'|'analyzing'|'done'|'failed';
  serverId: string | null;
  exit: {reason:'exited'|'stopped'|'cancelled'|'process-error'|'lock-error',
    code:number|null, signal:string|null} | null;
  progress: {component:'metadata'|'game'|'java'|'library'|'asset'|'logging'|'loader'|'files'|'settings',
    completed:number, total:number|null} | null;
  logs: {stream:'stdout'|'stderr',text:string}[];
  truncated: boolean;
  report: StudioCompatibilityReport | null;
  mods: StudioModInfo[];
  metadataErrors: {file:string,code:string}[];
  extracted: StudioPresetPreview | null;
  extractionError: string | null;
  error: string | null;
};
```

Report and ModInfo mirror core's structural contracts without importing Node implementation modules
into renderer typechecking. report summaries are `{code,parameters}` and evidence is
`{source:'log'|'crash-report',line,text}`; line numbers refer to the bounded analysis input, not the
300-line tail. UI can display evidence text even when its original line is outside that tail.
Report status is problems/no-problems-found/incomplete and never guarantees compatibility.

Top-level busy uses the existing 'choosing' for testLogin/testStart/testReset. Render test-specific
progress from testRun, not the generic top-level numeric progress. Results describe the last test
snapshot; editing files/settings afterwards does not revalidate them. New/open clears old results.
Successful commands return `{ok:true,state}`. Generic failure codes keep existing StudioError:
INVALID/BUSY/NO_PROJECT/CANCELLED/MISMATCH/IO/ENCRYPTION_UNAVAILABLE as appropriate. Detailed account /
testRun / extraction errors contain only existing auth/host/core planner codes, existing Studio codes,
'cancelled' or 'test-failed'. metadataErrors use ModMetadataError codes, 'unreadable' or 'limit-exceeded'.
No provider error messages, exception causes, local absolute paths, tokens, device codes or account
profile IDs are included. extracted is an import preview; imported values are in project.gameSettings
and remain dirty until the operator saves the project.

## Verification and exact results

Environment: Linux/WSL x64, Node v24.21.0, pnpm 10.34.7 at
`/tmp/auth-share-tools/node_modules/.bin`; DISPLAY=:0. Recheck these environment-local tools on resume.
Electron 44.9.1 reused read-only via
`ELECTRON_OVERRIDE_DIST_PATH=/mnt/d/Projects/mclauncher/node_modules/electron/dist` because this
worktree's Electron package has no downloaded executable. Coordinator dependencies were not changed.

- `CI=true PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm install --frozen-lockfile --store-dir /tmp/auth-share-pnpm-store`:
  passed, lockfile resolution skipped, all 5 workspaces up to date.
- Initial focused 5-file run: 74 passed / 1 failed (new test assumed only one imported option).
  Replaced the assertion with a containment check; rerun 5 files / 75 tests passed.
- Initial Studio typecheck surfaced Node implementation types through core diagnostic type imports
  in shared state. Replaced those with renderer-safe structural DTOs; subsequent Studio typecheck passed.
- `pnpm exec vitest run apps/admin/src/main`: 8 files / 100 tests passed / 0 failed / 0 skipped
  before the final two journal/large-file tests were added.
- First `PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm check`: passed; 372 Biome files,
  existing 37 warnings / 3 infos, all workspace TypeScript, 96 files passed / 4 skipped,
  1385 tests passed / 9 skipped / 0 failed, both app builds. Log `/tmp/testrun-main-check.log`.
- Final `PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm check`: **passed (exit 0)**,
  after the bounded-journal guard and two additional tests. Biome 372 files / existing 37 warnings +
  3 infos, all TypeScript, **96 files passed / 4 skipped; 1387 tests passed / 9 skipped / 0 failed**,
  both app builds. Log `/tmp/testrun-main-check-final.log`. Existing live/platform skips were not
  activated. All 22 new test-run/transaction tests were executed and passed.
- Standalone Studio production worker: `ELECTRON_RUN_AS_NODE=1 /mnt/d/Projects/mclauncher/node_modules/electron/dist/electron /tmp/auth-share-worker-check.mjs /mnt/d/Projects/mclauncher/.agents/worktrees/agent-2/apps/admin/out/main`:
  passed, Electron 44.9.1 / prismarine-auth 3.1.1 / liveAuthentication:false. Copies all built main
  chunks to a standalone temporary directory, self-checks the actual worker, reaps it and removes
  the temporary copy. No account or network used.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=... node scripts/smoke.mjs`: passed, both apps,
  renderer/navigation/IPC/isolation/760px+1100px checks. Log `/tmp/testrun-main-smoke.log`.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=... node apps/admin/scripts/smoke-functional.mjs`:
  passed, existing Studio shell/splash/in-app close confirmation/pages/persistence/layout/isolation.
  Log `/tmp/testrun-main-functional.log`. These smoke runs preceded the final journal-size guard;
  that change was covered by the final full check. These scripts do not prove real account/game execution.
- Scoped Biome and git diff --check passed. Root smoke bridge list needed no edit.

## Real Linux installation attempts (separate from automated successes)

Used the exported production installStudioTestGame path (no auth/game/server). Linux x64 1.21.1,
Fabric 0.19.5 and NeoForge 21.1.264, dedicated `/tmp/testrun-main-live-game` root. Nothing in the
user's server worlds, .minecraft, credentials or private download configuration was accessed.

1. First local harness used a minimal strict fetch downloader: Fabric attempt failed after
   134,520 ms / 604,922,924 received bytes; NeoForge attempt failed after 8,321 ms / 64,815,361 bytes.
   Original errors were suppressed; exact cause is not established. This harness differed from the
   production downloader, so these failures are not classified as product defects.
2. Rebuilt harness with actual createFullDownloader and the same production installation function,
   each with a 180-second AbortSignal deadline. Fabric: **failed at base install, timeout**, 180,098 ms /
   257,663,199 received bytes. NeoForge: **failed at base install, timeout**, 180,115 ms /
   269,973,661 received bytes. No loader completion, account authentication or game execution is claimed.

Exact local command: `node /tmp/testrun-main-install-probe/probe-production.cjs` (exit 1).
Receipts: `/tmp/testrun-main-install-probe/receipts.json`; logs:
`/tmp/testrun-main-live-install.log`, `/tmp/testrun-main-live-install-production.log`.
The generated CJS harness and bundle are environment artifacts, not permanent repository scripts.
For a repeat, bundle main/test-run.ts and core/download/full/index.ts as CJS with Vite noExternal,
then call installStudioTestGame with createFullDownloader, an explicit Linux x64 root outside source,
version 1.21.1 and one of the selections above; allow a longer deadline if desired. The installed
metadata/cache and temporary tools are environment-specific; never assume the previous attempt succeeded.

## Unrun checks, limitations and manual account procedure

- Real Microsoft login/refresh/logout/restart cycle, successful OS-keyring encryption, actual game
  window/direct play/modpack validation, Windows native and packaged applications: **not run**.
  They require a user-controlled account, secure keyring and corresponding OS/UI environment.
- TESTRUN-UI-01 still owns test panel/login/results/modal/i18n renderer work. Existing functional smoke
  validates the existing UI only; the new service is covered with fake installer/process tests.
- Mod configs use existing ASCII key=value .properties/.txt semantics. JSON/TOML/YAML remain reported
  as unsupported in the preset preview; generic mod settings are not silently converted. Config
  traversal is capped at depth 8 / 256 directories / 200 matched files, existing per-file/item caps
  and shader option limits remain. These limits can omit files, as can core metadata/parser limits.
- Process capture and reports are bounded; truncated observations are incomplete, not compatibility
  proof. Metadata parsing is declarative and does not solve dependencies or inspect nested jars.
- In-process rollback and fresh-invocation journal recovery are tested; real SIGKILL/power-loss and
  Windows file-lock races are not. Existing stale/uncertain core locks are never forcibly removed.
  A verified stale core lease may require existing core recovery tooling before a crashed instance
  can be resumed; an uncertain/live child must be resolved first. An orphan staging directory without
  a valid journal fails closed and requires explicit reset after locks are safely resolved.
- Reset refuses linked instance trees; it does not traverse and delete external targets. Source and
  account roots cannot be selected through the reset command.

Manual verification after TESTRUN-UI-01 wiring (or controlled trusted-frame service invocation):

1. Start Studio on Windows or Linux with a secure OS keyring. Select a dedicated project source with
   a real Fabric/NeoForge 1.21.1 candidate; save the project. Keep the launcher's userData separate.
2. testLogin: complete Microsoft login only in the local code window/system browser. Verify only
   signedIn/available and sanitized success/error codes; never share codes, tokens, profiles or caches.
3. testStart: observe preparing/installing/syncing/running. Play the actual game, check the intended
   mods/settings, then exit normally. No automatic server connection should occur.
4. Verify done/report/mods and imported options/config/Iris/Oculus/shader options. Previously selected
   policies remain selected; source bytes/mtime remain unchanged. Save the dirty project explicitly.
5. Repeat start (silent refresh/cache reuse), request stop, cancel during installation/login, and close
   Studio while running. Verify children have exited before Studio closes and logs remain bounded.
6. Restart Studio and run/login with its encrypted session, then testLogout. Verify a launcher session
   remains independent. Use an in-app confirmation modal before testReset; confirm only that
   project's instance is removed and source, accounts and other projects remain intact.

## Resume/integration checkpoint

`git diff --stat 57c6fcd...be9213b` verified **13 implementation files, 1673 insertions(+),
66 deletions(-)**: admin authentication worker config/manifest; main game-settings/index/studio;
new main test-auth/test-instance/test-run and their tests; shared studio/test-auth-text; lockfile link.
The final handoff adds this document, for **14 changed files**. Repeat
`git diff --stat 57c6fcd...HEAD` on the final branch for exact final totals.

No user approval remains pending. All validation commands, both smoke processes, production worker
and the real installation probe have exited. No dev server/game/auth worker is left running.
Only ignored/local /tmp tools, receipts, logs and the failed public-game installation root remain.
The installation root contains no account data and must not be treated as a successful installation.

#0 should review this branch, integrate it in the designated integration checkout and perform its
integration checks. Do not merge from this worker worktree. TESTRUN-UI-01 can consume the contract
above after its design prerequisite; no renderer changes were made here. Real account, direct game
play, Windows and successful loader installation evidence remain separate follow-up validation.
