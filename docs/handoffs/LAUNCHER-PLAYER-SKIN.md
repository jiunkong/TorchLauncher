# LAUNCHER-PLAYER-SKIN — worker #3

2026-10-23. Session `player_skin`, task L3 player skin module/avatar. Branch
`feat/launcher-player-skin`, worktree `.agents/worktrees/agent-3`, baseline `08244b2`.
GPT-6.1 Sol / medium was explicitly requested; the actual UI runtime setting was not independently confirmed.
Implementation is ready for coordinator review; it is **not integrated or wired into the product**.

## Delivered contract and boundaries

- `apps/launcher/src/main/skins/index.ts` exports `createPlayerSkinService(): PlayerSkinService`;
  `get(profileId: string, signal?: AbortSignal): Promise<string | null>` and `clear(): void`.
- Only fixed HTTPS Mojang session endpoint and strict `textures.minecraft.net/texture/<64 lowercase hex>`
  metadata URL are accepted. The observed legacy HTTP metadata spelling is upgraded to HTTPS.
  Credentials, alternate hosts/ports/paths, queries, fragments, redirects, profile mismatches and
  malformed base64/JSON are rejected. No auth headers, cookies, token, email or Microsoft identity are used.
- UUID input accepts exactly 32 hex or conventional hyphenated UUID. Profile and decoded texture
  metadata IDs must match the normalized ID. Responses have 64KiB byte limits and a total 8s timeout;
  decoded response byte count remains bounded with content encoding. Content-Length is checked against
  actual bytes only for unencoded/identity bodies because native fetch transparently decompresses.
- PNG magic, IHDR and 64x32/64x64 dimensions are checked before decoding. Production Electron
  `nativeImage` verifies actual decode/dimensions and emits a canonical PNG. Only its bounded data URL
  crosses the intended renderer boundary. Tests inject the decoder/transport without adding dependencies.
- Memory-only success cache: 5 minutes / 32 entries; at most 32 in-flight requests. Same-ID work is
  deduplicated, caller abort is independent, failures return null and are not cached. `clear()` aborts
  current work, removes cached values and invalidates late completion with a generation counter.
- `PlayerAvatar.tsx` exports `{name: string|null, label: string, skin?: string}` and owns its CSS.
  It keeps `avatar`/`empty` classes, validates PNG data URL/header/dimensions again, and crops face
  `(8,8,8,8)` plus transparent hat `(40,8,8,8)` using pixelated, non-draggable image layers.
  First Unicode character / `?` remains visible until browser decode succeeds, and on decode failure.
- No shared state, product service, IPC, main wiring, Menu, App, common CSS, i18n, dependencies or
  lockfile changed. #2 was told the exact export paths and remains the sole integration-wiring owner.

## Exact validation (Node 24.21.0 / pnpm 10.34.7, Linux/WSLg)

All run from the assigned worktree, with `/tmp/torchlauncher-tools/node_modules/.bin` on PATH:

- `pnpm exec vitest run apps/launcher/src/main/skins/service.test.ts apps/launcher/src/renderer/src/components/PlayerAvatar.test.ts`
  — **56 passed**, 2 files. Covers malicious schema/URLs, invalid IDs, preflight rejection, decoder
  failure/dimension change, redirect/length/truncation/size, compression, offline, timeout, TTL/count,
  concurrent cap, caller abort, clear/late fetch and clear during decode, renderer fallback and both sizes.
- `pnpm --filter @torchlauncher/launcher typecheck` — passed (node + web).
- `pnpm --filter @torchlauncher/launcher build` — passed. Product does not import the new module yet.
- `pnpm exec biome check --write apps/launcher/src/main/skins apps/launcher/src/renderer/src/components/PlayerAvatar* apps/launcher/src/renderer/src/components/fixtures/player-avatar`
  — passed, 10 files, no remaining diagnostics.
- `node apps/launcher/src/renderer/src/components/fixtures/player-avatar/smoke.mjs` — **passed**.
  Isolated fixture compiles the production service/adapter, uses actual Electron nativeImage-generated
  64x32 and 64x64 PNGs through that adapter, and checks browser crop bounds and screenshot pixels:
  opaque green hat half covers red face, transparent hat half preserves red face. It checks fallback
  visibility and verifies both browser and native decoder rejection of a header-only malformed PNG.
  This is real decoder/component evidence with mocked transport, not a real account or product-wiring test.
- `git diff --check` — passed before commit.

Initial fixture harness attempts failed because the fixture window had not navigated and Playwright's
main-process evaluate does not provide `require`. The harness now navigates `about:blank` and supplies
its own factory from its main entry. These were harness defects; the final command above passed.
Temporary fixture work directories are `/tmp/torch-avatar-*`; the fixture closes Electron and Vite in
`finally`. No long-running processes remain from successful validation.

## Primary-source verification and limits

Before implementation, bounded unauthenticated `curl --max-time 10 --max-filesize 65536` fetched the
[official Mojang public Notch profile response](https://sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5).
It confirmed `id`, `properties[name=textures].value` base64 JSON, `profileId` and an HTTP
`textures.minecraft.net/texture/<64-hex>` skin URL. The web tool could not open that endpoint; the
bounded direct response succeeded. No live account login or repeated/live texture network test was used.
Head coordinates and accepted skin dimensions follow the binding assignment contract and were tested
with generated fixtures. No claim of full remote API compatibility or signature verification is made.

Coordinator next: review and merge this module first, then #2 rebase and wire production factory, verified
profile ID background lookup, logout/auth-failure/exit clear, `account.skin`, and Menu. Run integrated
checks and product UI smoke after wiring. Windows native behavior and real logged-in skin retrieval
remain unverified. No pending user action is needed for this module.
