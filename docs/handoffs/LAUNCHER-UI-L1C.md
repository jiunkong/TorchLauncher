# LAUNCHER-UI-L1C handoff

- Session: `launcher develop #1`
- Branch: `feat/launcher-ui-l1c`, baseline `816519b` (final commit hash is reported in the session response).

## Changes

- Splash: minimum 2200ms -> 1600ms (reduced motion 900 -> 700ms). CSS intro (halo 1.1s, torch 1.1s, word 0.65s/0.3s delay, bar 0.4s/0.35s delay, bar fill = minimum - 0.35s) now ends inside 1600ms. Waiting phase and the 15s cap are unchanged.
- Menu header: server name wraps to at most 2 lines (line-clamp 2, `word-break: keep-all` so Korean breaks at spaces), ellipsis beyond that, full name in `title`. Toggle position, icon and open/close animation unchanged; closed menu unchanged.
- Server config `game` (optional) in `packages/core/src/server-config/index.ts` (+test): strict check, exactly `minecraftVersion` and `loader{kind,version}`, same token rule as deployment index (1-64 chars, `[A-Za-z0-9._+-]`, alnum first), kind `fabric|neoforge`, unknown fields rejected. Files without `game` stay valid.
- Launcher `ProductService`: constructor fills `ProductState.game` from `config.game` (no login needed).
- Studio export (`apps/admin/src/main/studio.ts` export action) writes the project `game` into the config; `studio.test.ts` fixture includes it so export round trip is covered.
- Smokes: fixtures include `game`; renderer smoke asserts the version line and takes `.cache/smoke/launcher-menu-open.png` (long name "TorchLauncher 접속 검증").

## Schema example

```json
{
  "format": "torchlauncher-server",
  "version": 1,
  "serverId": "44444444-4444-4444-8444-444444444444",
  "name": "TorchLauncher 접속 검증",
  "address": "example.org:25565",
  "sourceUrl": "https://example.org/server.torchpack",
  "game": { "minecraftVersion": "1.21.1", "loader": { "kind": "fabric", "version": "0.19.5" } }
}
```

## Mismatch handling (current behavior)

Unchanged: `prepare` still requires the index `minecraftVersion` to be `1.21.1` (else `unsupported-game`), overwrites `state.game` from the deployment index, and installs the index's loader. So on mismatch the index (what is actually installed) wins and the displayed value updates at prepare; launch is not blocked. Opinion: this deviates from "config wins" only to keep the display truthful; if a hard error on config/index mismatch is wanted, that is a separate decision for #0.

## Verification

- vitest (server-config, admin main, launcher src): 26 files, 190 tests pass; Biome no errors (7 pre-existing style warnings); `pnpm typecheck` passes.
- `node scripts/smoke.mjs`, `node apps/launcher/scripts/renderer-functional-smoke.mjs` pass on Linux; screenshot confirmed two-line name and "Minecraft 1.21.1 · Fabric 0.19.5" before login.

## Not verified

- Windows visual check of splash pacing and menu header; real Studio-exported package opened by the launcher; reduced-motion splash timing visually.
