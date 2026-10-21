# GAME-02/03 fix — module conflict and smoke result loss

Session `launcher develop #3`, branch `fix/game-02-03-module-conflict`, baseline `864d100`.
Final commit hash is in the session reply.

## Cause (confirmed by assembled arguments, Linux, real NeoForge 21.1.264 and Fabric 0.16.14 profiles)
NeoForge's profile sets `-DignoreList=client-extra,${version_name}.jar`. `version_name` is the merged
id (`neoforge-21.1.264`), but the launcher keeps the verified vanilla jar at
`versions/1.21.1/1.21.1.jar`, so it was on the classpath yet not ignored. BootstrapLauncher then
loaded it as automatic module `_1._21._1` next to the NeoForge `minecraft` module.

## Fix
- `packages/core/src/loaders/profile.ts`: when composing the loader installation, the
  `${version_name}.jar` entry of `-DignoreList` is bound to the actual vanilla jar name
  (`1.21.1.jar`). `--version` and other `version_name` uses stay `neoforge-21.1.264`
  (official contract; smaller than changing version_name globally). NeoForge fails closed if no
  ignore entry matches the client jar. Fabric and vanilla have no ignoreList and are unchanged.
- `apps/launcher/src/main/game-smoke/outcome.ts`: abnormal game exits report `ok:false`, `exitCode`,
  `exitSignal` and a fixed `code` (`module_resolution_failed`, `class_not_found`,
  `unsupported_class_version`, `out_of_memory`, `jvm_creation_failed`, else
  `game_exited_abnormally`) classified from the in-memory sanitized log snapshot; no log text emitted.
- `host_no_result` cause (hypothesis, not reproduced on Windows): the result was written with
  piped `console.log` immediately followed by `app.exit`, which can drop output on Windows.
  `entry.ts` now writes the result synchronously to a private result file and fd 1;
  `scripts/game-smoke.mjs` reads the file first, then stdout, and `host_no_result` now includes
  `hostExitCode`.

## Tests
- New `packages/core/src/loaders/launch-args.test.ts` (+ sanitized profile fixtures): Linux and
  Windows platforms, NeoForge vanilla jar matches `-DignoreList`, single classpath entry, no
  unresolved placeholders; Fabric has one vanilla jar, no duplicate Maven keys, no ignoreList.
- `outcome.test.ts`: module resolution failure classification without log text.
- `pnpm check` passed (Biome, tsc, 549 tests / 6 opt-in skipped, both builds).

## Not verified
Real Windows launch, authenticated join, and whether the result-file change cures
`host_no_result` on Windows. Only argument assembly was tested.

## Windows rerun
```
node scripts/game-smoke.mjs launch --data-dir D:\TorchLauncherSmoke\auth --game-dir D:\TorchLauncherSmoke\games\44444444-4444-4444-8444-444444444444 --loader neoforge --loader-version 21.1.264 --source-file D:\Projects\mclauncher\.cache\game-smoke-validation\live-url.txt --server-id 44444444-4444-4444-8444-444444444444 --server localhost:25565 --duration-seconds 300
```
Run it from a checkout of this branch (with `pnpm install --frozen-lockfile`).
