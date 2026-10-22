# BRAND-RUNTIME-01 — launcher hybrid branding runtime

2026-10-23. Worker #1 `branding_contracts` reused for sequential BRAND-RUNTIME-01; requested Sol medium,
actual model/effort UI unverified. Branch `feat/branding-runtime`, worktree `.agents/worktrees/agent-1`,
baseline `907f7d7`. #0 approved the cache/IPC architecture before implementation and reviewed lifecycle,
file ancestry and commit serialization. This handoff's adding commit is the implementation commit
(`git log -1 --format=%H -- docs/handoffs/BRAND-RUNTIME-01.md`). No integration/merge performed by worker.

## Behavior implemented

`main/branding/` owns optional images separately from game preparation. Bootstrap preserves the actual
server JSON path. Initialization checks verified role cache, then that JSON directory's shipped sidecar,
then default. App name changes native title/menu label only, default TorchLauncher. The home server
name, fixed TorchLauncher splash, app.setName/appId/userData/auth identity and packaged executable icon
remain unchanged. The native window icon, menu icon and home background use verified overrides.
Page title updates cannot overwrite the operator's native title.

Local/cache reads are bounded, reject symlinks through the full supplied path ancestry, reject hardlinked
or nonregular files, verify opened/path identities and size/timestamps, and recheck parent chains and
canonical containment. SHA-256, MIME/magic/header/dimensions and actual nativeImage decoding are checked;
decoded dimensions must match the bounded header and bitmap length must equal width × height × 4.
PNG icon ≤1 MiB/512², PNG/JPEG background ≤8 MiB/3840×2160 use the integrated core limits.

Cache is outside `servers/`, under `<userData>/branding/v1/<serverId>/<fingerprint>/`. Fingerprint is
SHA-256 of stable explicit profile fields (including source URL) and resolved actual JSON path. Raw
source URLs/paths are never recorded in cache records or branding IPC. There is one fixed JSON file
per role, containing version + metadata + canonical bounded base64, or `{version:1,removed:true}`.
The tombstone prevents shipped image resurrection after restart; remote role omission/legacy retains
that state. Corrupt/undecodable cache falls back to sidecar/default. Changing profile path/content
isolates its cache; live profile switching is not exposed by this fixed-server application.

Cache creation captures every directory inode, revalidates earlier ancestors before/after deeper mkdir,
and rejects replaced/link components. Atomic writes use fresh exclusive files, fsync, identity/ancestry
checks and rename. Cleanup checks created inode identity and preserves foreign replacements. Remote
scratch cleanup likewise removes only the observed image inode and unchanged empty private directory;
unexpected/replaced paths are preserved. These are portable Node path/identity checks, not an OS-level
openat transaction or guarantee against every same-user filesystem race.

Startup performs one asynchronous metadata check after local initialization, with its own 15 s abort.
Game `ProductService.current()` also reports its already validated reader through optional
`observeDeployment`; synchronous throws/rejected observer promises cannot fail or delay the game gate.
No ProductState image bytes or game progress publication is used. Only changed roles are staged. Equal
hashes also require consistent original length and MIME; inconsistent same-hash metadata retains the
previous display without refetch. Null persists default; omitted roles/old packs retain current display.
Whole malformed game indexes still fail at the existing game reader boundary. Optional fetch/header/hash/
decode/cache failures retain previous display and do not alter game ownership or game installation.

Startup reserves its generation/controller before awaiting local reads. A newer observed reader aborts
and supersedes earlier optional requests. Shared reader source is never reset; its pin/snapshot checks
remain intact. Legitimate remote version changes retain the existing source/game safety behavior.
Cache commit acceptance linearizes at the generation check immediately before atomic rename. Newer
updates wait already queued accepted commits before deciding retain/hash-skip, so a rename already
accepted cannot leave disk-only stale null state. Accepted intent finishes before later role decisions;
older downloads not at acceptance are rejected. Shutdown immediately aborts branding and suppresses
publication, begins game shutdown without waiting for branding, and drains accepted cache writes before
process exit. A defective injected transport ignoring abort cannot publish a late image.

## Renderer and IPC contract

`shared/branding.ts`: optional LauncherApi `getBranding()` / `onBranding(listener)`. Existing smoke/mock
APIs remain valid without these methods. Trusted main-frame no-argument `launcher:branding` returns
`{revision,appName,icon,background}`; `launcher:branding-changed` sends a snapshot only on role changes.
Images are verified encoded data URLs. No arbitrary role/path/URL request slot exists. Large backgrounds
never enter ProductState or its frequent progress events. A snapshot can include both roles when either
changes; at most 9 MiB encoded input is bounded by role limits. CSP remains local/data-only as before.

`useBranding` subscribes before requesting its snapshot and ignores older revisions. `BrandingVisual`
keeps the previous image/default mounted until browser `Image.decode()` succeeds, then uses two layers
for a 220 ms fade. Browser decode rejection retains the displayed image. Reduced motion switches
immediately without previous layers. Custom backgrounds use object-fit cover; icons use contain.
Default scene/torch returns through the same path. Selection/drag protection and existing layouts remain.

## Validation

Node v24.21.0; pnpm 10.34.7 via `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`.

- `pnpm --filter @torchlauncher/launcher typecheck`: passed after final changes.
- `pnpm exec vitest run apps/launcher/src/main/branding apps/launcher/src/main/product apps/launcher/src/renderer/src`:
  **172 passed / 24 files** before the final ancestor replacement fixture, no skips. The final
  expanded run passed those same 172 tests while the new test hit a Node built-in ESM spy restriction;
  corrected its test-only module wrapper, then `pnpm exec vitest run apps/launcher/src/main/branding`
  passed **16 tests / 3 files**, including the new regression. Final launcher typecheck passed again.
- `pnpm --filter @torchlauncher/launcher build`: passed; main/preload/renderer production bundles.
- `node apps/launcher/scripts/branding-smoke.mjs`: passed on Linux/WSLg using isolated temp profile/userData,
  production native decoder/cache/IPC/preload/full renderer and fake validated reader, with no remote network.
  Native PNG/JPEG and browser decode, profile-relative sidecars, unchanged-role no download, changed role only,
  decode-failure retention, previous-layer fade, reduced-motion defaults, persisted tombstones after actual
  process restart, fixed splash/app identity/home name, background cover and 760/1100 no overflow all checked.
- `pnpm exec biome check apps/launcher`: passed with 8 existing stylesheet warnings, no new warnings/errors.
- `git diff --check`: passed.

Unit regressions also cover cache corruption/fallback, profile/source isolation, missing/unsafe/oversize files,
full ancestry links/hardlinks, foreign temporary/ancestor replacement preservation, scratch cleanup identity,
late startup/close suppression, delayed local-start/observe ordering, malformed same-hash descriptors,
source pin failure, accepted commit serialization, IPC sender/frame/URL/arguments and game observer nonblocking
behavior (including rejected observer promise). Early checks found strict Promise typing and test harness
case/multiple-heading/ESM built-in mocking assumptions; final checks corrected those. Review-found start/observe and directory
chain gaps were fixed and regression tested before handoff.

## Remaining / resume

No core/admin/root config/manifests/dependencies/lockfile/tracker edits. Studio consumes the frozen core
contract in its separate worker. No real user config, private URL, authentication, actual game, Drive upload,
portable package or Windows validation used here. Hashes are integrity checks, not publisher authentication.
#0 owns integration and full `pnpm check`; Windows native icon/display and real deployment verification
remain user checks after Studio output is ready. No task process remains running after final checks. Linux link fixtures passed; Windows symlink
fixtures require OS permission/developer mode and were not executed here.
