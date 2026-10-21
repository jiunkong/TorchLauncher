# GAME-03 preparation: Fabric 0.19.5 install and argument check

Session `launcher develop #3`, branch `fix/game-03-fabric-validation`, baseline `575ccff`.
Final commit hash is in the session reply. No product code defect was found; no production code changed.

## Changed files
- `.gitignore`, `biome.json`: exclude the read-only `.testfabricserver/` (same method as `.testserver`).
- `packages/core/src/loaders/fixtures/fabric-0.19.5-profile.json`: public Meta profile for 1.21.1 / loader 0.19.5 (no tokens).
- `packages/core/src/loaders/launch-args.test.ts`: Linux and Windows regression for 0.19.5.
- `packages/core/src/loaders/live.test.ts`: the opt-in Fabric version can be set with `TORCH_LOADER_LIVE_FABRIC` (default stays 0.16.14).

## Validation (Linux x64)
- Live install in a separate copy of the base cache (`/tmp/torchlauncher-game03-live`; the earlier receipts were untouched):
  `TORCH_LOADER_LIVE_FABRIC=0.19.5 TORCH_LOADER_LIVE_ROOT=/tmp/torchlauncher-game03-live pnpm exec vitest run packages/core/src/loaders/live.test.ts -t fabric`
  passed. Receipt: 13 s, 5.4 MB adapter-observed, 65 classpath entries, mainClass `net.fabricmc.loader.impl.launch.knot.KnotClient`.
- The 0.19.5 profile has 8 libraries (ASM 9.10.1 set, sponge-mixin 0.17.4+mixin.0.8.7, intermediary 1.21.1, fabric-loader 0.19.5);
  no new profile format, module replacement or hash problem.
- New tests assert, on Linux and Windows: no `${` left, no `-DignoreList`, empty module path, exactly one `1.21.1.jar`,
  no duplicate classpath entries or Maven keys, `fabric-loader-0.19.5.jar` present and 0.16.14 absent,
  `--version fabric-loader-0.19.5-1.21.1`, Knot main class after `-cp`, and the `-DFabricMcEmu=` argument.
- Loaders tests: 21 passed, 2 opt-in skipped. Biome and `tsc -p packages/core` clean. Full `pnpm check`: see the session reply.

## Not verified
Real Fabric game launch, authenticated join to `.testfabricserver` (Windows, user), Windows install of 0.19.5, and that the server
accepts the client (both use Fabric Loader 0.19.5, MC 1.21.1, online-mode, no mods). The server directory was only listed, not modified.

## Windows commands (use a fresh empty game directory; its basename must be the server UUID)
Optional install check:
```powershell
node scripts/game-smoke.mjs install --data-dir D:\TorchLauncherSmoke\auth --game-dir D:\TorchLauncherSmoke\games\44444444-4444-4444-8444-444444444444 --server-id 44444444-4444-4444-8444-444444444444 --loader fabric --loader-version 0.19.5
```
Launch (needs the Fabric server running with a matching empty pack; the source URL file is local and ignored):
```powershell
node scripts/game-smoke.mjs launch --data-dir D:\TorchLauncherSmoke\auth --game-dir D:\TorchLauncherSmoke\games\44444444-4444-4444-8444-444444444444 --loader fabric --loader-version 0.19.5 --source-file D:\Projects\mclauncher\.cache\game-smoke-validation\live-url.txt --server-id 44444444-4444-4444-8444-444444444444 --server localhost:25565 --duration-seconds 300
```
Note: the launch gate needs a deployment/source for this server ID that matches the Fabric loader; the existing NeoForge URL file
may describe a NeoForge pack. #0 must confirm that a Fabric-matching source exists before the user runs launch.
