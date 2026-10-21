# GAME-02 / GAME-03 — modded client installation and direct connection

## Authorized scope

Implement Minecraft 1.21.1 NeoForge first, then Fabric, using the existing Java 21/base installation,
HTTPS downloader, authentication, synchronization and managed process code. General legacy version
support, product UI, server-side enforcement and disconnect-triggered exit are outside this task.
The worker owns both loaders and shared launch changes so file scopes do not overlap.

## Loader installation

- Operator-selected exact loader versions are authoritative; do not silently choose latest or replace
  the requested Minecraft/loader combination. The running user test server is 1.21.1 / NeoForge 21.1.264;
  use a new matching game test pack rather than the old 21.1.200 synchronization fixture.
- NeoForge: inspect the official Maven installer/profile and supported client CLI. Prefer running its
  official installation processors with managed Java in a dedicated staging root, not reimplementing
  the processor pipeline. Bound execution, capture sanitized logs, stop/reap on cancellation, and
  validate results before publication. Do not touch the user's existing `.minecraft` or launcher profiles.
- Fabric: use the official Meta API profile for the exact game/loader pair; obtain its libraries and
  merge its launch metadata with the validated base installation. Fabric API is a separately deployed mod.
- Validate metadata, Maven paths, HTTPS sources, hashes/lengths where supplied, inheritance and argument
  placeholders. Merge overridden libraries deliberately; do not blindly concatenate conflicting versions.
  Keep OS/architecture rules and JVM module/classpath semantics needed by the actual loader profile.
- Reuse the server maintenance/install lease. Failed installs must not publish a usable partial loader.
  If the official installer needs launcher bookkeeping, create only private disposable staging metadata.
- Explicitly distinguish installer Java (`java.exe` on Windows) from the GUI game executable (`javaw.exe`).
  Linux real installation evidence may reuse the existing ignored/tmp base cache after checking it.

## Fail-closed launch gate

The user requires launch to be blocked when the required environment cannot be synchronized.

1. Fetch/validate the operator deployment and resolve its exact game/loader pair.
2. Prepare Java/base game/loader and obtain a valid owned-account authentication result.
3. Reread the current remote deployment before launch; if its game/loader changed during installation,
   fail with a restart/update-needed result instead of launching the older installation.
4. Synchronize required files using the current reader. Network failure, hash mismatch, conflicts,
   cancellation or recovery-needed state blocks launch; there is no cached/offline bypass.
5. Under the game lease immediately before spawn, check that the accepted deployment is still current,
   ledger identity matches, no unresolved synchronization transaction remains, and required `always`
   files still match. A trusted bounded pre-spawn callback may be added to the existing process API.
   A read-only synchronization guard can be added in the narrowly assigned sync files.

`initial-only` personal changes are not launch blockers. A newer deployment detected at the final
check is an explicit retry/update result. This guarantees the environment against the latest deployment
served at the check, not against unknowable later remote changes. Direct use of another launcher is
not prevented; server-side compatibility enforcement remains a separate possible feature.

## Test runner and account handling

- Provide a dedicated Electron `game-smoke` runner and instructions before asking for user tests.
  Installation-only diagnostics can run without login, deployment or server; authenticated launch mode
  requires the expected server ID, current deployment source and server address.
- Reuse temporary public-Java authentication and OS encrypted cache. Keep tokens only in memory and
  protected storage; do not accept/copy tokens via CLI, environment, files or chat. Do not change auth code.
- Bundle the existing authentication worker beside the temporary harness. Keep the harness alive when
  its code window closes, and own shutdown until output flush and child cleanup complete.
- Use dedicated absolute data/game directories outside the repository; preserve user files. Serialize
  multiple harness instances. Redact tokens, profile identifiers, private URLs and raw upstream errors
  from terminal output and committed receipts. Never print raw command arguments or full game logs.
- Pass the configured Quick Play multiplayer target for 1.21.1. Process spawn/exit 0 or an argument
  fixture does not prove joining a server. Record visible world entry or server-side confirmation as
  separate user/live evidence. No fake/offline account test counts as successful authenticated launch.

## Validation and user cooperation

Test profile merging, incompatible versions, argument/rule handling, integrity failures, cancel/timeout,
failed staging, no spawn on failed latest-check/sync/guard, and unchanged personal settings. Run real
official loader installations where possible before Windows user execution.

Ask #0 before adding dependencies or widening file scopes. Report commit/tests/OS/limitations in
`docs/handoffs/GAME-02-03.md`; keep unverified live checks pending. Commit an implementation checkpoint
before a long user wait and update the portable handoff if a tool limit interrupts work.

The user offered to supply a test server or run direct tests when needed. #0 coordinates requests.
Do not assume an existing server, accept an EULA on the user's behalf, or claim a connection from
installation-only checks. Prepare concrete server requirements and exact commands first.

The user has now started the server independently in repository-local `.testserver/`. Its port is
25565, online mode is enabled, whitelist is disabled, and no extra mods are installed. Startup completion
is visible in the server log. This directory is read-only user data: never stop it, change its configuration,
or publish its logs/world/account files. Exclude it from Git and Biome. A coordinator-tool localhost TCP
probe did not connect; this does not establish server failure. Native client connectivity must be verified.

## Upstream references

- [NeoForge client installation](https://docs.neoforged.net/user/docs/client/)
- [Official client CLI announcement](https://neoforged.net/news/2024-retrospection/)
- [Fabric Meta API](https://github.com/FabricMC/fabric-meta/blob/master/README.md)
