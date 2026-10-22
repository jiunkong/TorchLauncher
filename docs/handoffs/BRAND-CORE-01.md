# BRAND-CORE-01 — hybrid branding contracts, reader and writer

2026-10-23. Worker #1 `branding_contracts`, requested Sol medium (actual model/effort UI unverified).
Branch `feat/branding-contracts`; worktree `.agents/worktrees/agent-1`; baseline `4c55456`.
#0 reviewed the concrete design and authorized implementation; approved design is recorded in main
`docs/operator-branding-hybrid.md` (coordinator `bffaecd`). No merge/integration was performed here.
The implementation commit is the commit adding this handoff; obtain its ID with
`git log -1 --format=%H -- docs/handoffs/BRAND-CORE-01.md`.

## Implemented

- Optional v1 `ServerConfig.branding`: local-only `appName` and icon/background sidecar descriptors
  `{path, sha256, length, mediaType}`. The parser clones descriptors and rejects unsafe portable NFC
  paths, unknown fields, invalid hashes/types/lengths and malformed names. No image data is in JSON.
- `branding/index.ts` pure metadata/PNG-IHDR/JPEG-SOF header helpers with bounded scans and dimension,
  pixel and encoded-byte limits. No filesystem, dependency, actual decode or platform UI changes.
  Helpers are re-exported through existing server-config/contracts entrypoints; no root export changes.
- Separate v1.1 index `branding` object with fixed roles. Each non-null asset is
  `{sha256, offset, storedLength, originalLength, compression:'none', mediaType}`. No game path/policy.
  Encoded PNG/JPEG bytes remain uncompressed. `files` retains existing semantics and ownership.
- New readers support exact v1.0/v1.1, require matching header/index minor versions, reject unknown
  versions/fields, and validate one continuous payload: game files, then icon, then background.
  Length/hash/compression/role limits and full payload boundaries reject gaps, overlaps and trailers.
  `DEPLOYMENT_FORMAT_VERSION` stays legacy 1.0 for existing consumers; added
  `DEPLOYMENT_BRANDING_FORMAT_VERSION` is 1.1. Previous launchers reject 1.1 explicitly.
- `openDeploymentReader` returns `BrandingDeploymentReader extends DeploymentReader`, adding
  `stageBrandingAsset(role, newScratchPath, options?) -> {role, outputPath, length, sha256}`. Existing
  injected `DeploymentReader` mocks do not acquire a required method. Game `stageFile` still searches
  only `index.files`. Both staging paths share existing pinned Range/length/hash/abort/cleanup logic.
  Absent/null roles fail `branding-not-found` without creating scratch or requesting payload.
- `writeDeployment` optional `branding` accepts bounded `Uint8Array` snapshots. It copies bytes before
  its first await, validates format/header/dimensions, computes SHA-256, then appends the role payloads.
  Existing output remains untouched before atomic commit. Omitted input emits v1.0; present `{}` or
  removal-only input emits v1.1. Game root-relative source streaming/link checks are unchanged.

## Consumer contract and examples

Remote legacy/no branding means retain current display. In v1.1, an omitted role means retain that role;
explicit `null` means default/remove. Local profile omission means no shipped override; local null is invalid.
Remote appName is intentionally unsupported. Local appName is title/menu only: do not change app.setName,
appId, userData, auth cache, home server name, startup TorchLauncher logo or EXE icon.

Studio passes the same selected, bounded and fully decoded byte snapshot to sidecar export and writer:

```ts
const iconSnapshot = Uint8Array.from(selectedDecodedPngBytes);
const result = await writeDeployment({
  ...existingOptions,
  branding: { icon: { bytes: iconSnapshot, mediaType: 'image/png' }, background: null },
});
// Export iconSnapshot beside server JSON; use result.index.branding.icon sha256/originalLength.
// Profile: branding.icon = { path:'branding/icon.png', sha256, length:originalLength, mediaType:'image/png' }.
// Do not reopen the original selection between these outputs.
```

The runtime can reuse the already opened reader/index from game preparation and compare verified cache
hashes before requesting an image. It can also open a reader independently during startup. The following
is illustrative consumer flow, not implemented runtime/cache behavior in this task:

```ts
const reader = await openDeploymentReader(source, { expectedServerId: profile.serverId });
for (const role of BRANDING_ROLES) {
  const asset = reader.index.branding?.[role];
  if (asset === undefined) continue; // Legacy/omitted: retain verified image or default tombstone.
  if (asset === null) {
    await persistDefaultTombstone(role); // Prevent shipped sidecar resurrection on next startup.
    selectDefault(role);
    continue;
  }
  if (lastVerified[role]?.sha256 === asset.sha256) continue; // No payload request.
  const staged = await reader.stageBrandingAsset(role, freshScratchPath(role), { signal });
  // Bounded read, inspectBrandingImage(role, asset.mediaType, bytes), actual decode and pixel checks.
  // Atomically persist verified cache, confirm current profile/request generation, then switch display.
  // Fetch/header/decode failure retains previous display. Do not gate login or game preparation.
}
```

For injected readers typed as `DeploymentReader`, require the extended interface or check
`'stageBrandingAsset' in reader && typeof reader.stageBrandingAsset === 'function'` before using it.
Do not assume existing mocks implement the role method. `stageBrandingAsset` verifies stored length/hash,
not actual image decode. Small reader maxFileBytes/maxStoredFileBytes budgets also constrain images.

Malformed profile/index schema remains fatal at its existing boundary. Valid optional sidecar references
whose files are missing/unsafe/hash-mismatched/undecodable must fall back in the runtime; the core parser
performs no disk reads. Whole remote index errors remain reader errors, never optional warnings in sync.
Resolve sidecars from the **actual JSON directory**, reject symlinks/hardlinks/real containment escapes,
and keep cache outside game data, isolated by server/profile. Persist null tombstones atomically. Keep the
previous verified display until a replacement fully validates/decodes. Late request/profile responses must
not overwrite current state. These operations and fade/reduced-motion behavior belong to the next phase.
Hashes provide integrity only, not publisher authentication or rollback prevention.

## Validation

Node 24; pnpm 10.34.7 via `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`.

- `pnpm exec biome check --write packages/core/src/branding packages/core/src/server-config packages/core/src/deployment/contracts packages/core/src/deployment/reader packages/core/src/deployment/writer`
  succeeded, 20 files checked (new/changed code formatted).
- The same `pnpm exec biome check` command without `--write` succeeded: 20 files, no fixes.
  `git diff --check` succeeded.
- `pnpm --filter @torchlauncher/core typecheck` succeeded after final code changes.
- `pnpm exec vitest run packages/core/src/branding packages/core/src/server-config packages/core/src/deployment/contracts packages/core/src/deployment/reader packages/core/src/deployment/writer packages/core/src/instance/sync`
  succeeded: **302 passed, 1 skipped**; 9 test files passed, 1 skipped. The live sync test requires explicit
  environment/live fixtures and was not run. No private configuration/URL was read.
- Meaningful checks include legacy packs/profiles, matching versions, game/image cross-boundaries,
  raw index digest, both-role fixed ordering, null/omitted roles, no unchanged-role request, changed-role-only
  ranges, invalid metadata/path/header/dimensions, smaller local budgets, corrupt image hash cleanup and
  successful retry, source generation reset, abort cleanup and writer byte/metadata mutation immunity.
  Existing sync tests passed unchanged; game ownership/launch guard implementations were not edited.
- Initial focused run reported one stale expectation that v1.1 was unsupported; updated the test to v1.2.
  Initial expanded typecheck caught two test-only strict typing errors; fixed before the final checks above.

No app/IPC/root config/manifests/lockfile/dependency/progress changes. No actual image decoding, cache/UI,
Studio asset selection/export, portable ZIP, live download, real game or Windows test was performed.
#0 owns review/integration and full `pnpm check`. No task process remains running after final validation.
