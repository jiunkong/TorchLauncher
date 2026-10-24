# STUDIO-VERSION-SELECT-01 — Studio game and loader selectors

Worker: `studio_version_select_low` (Studio version selector), branch `feat/studio-version-select`, worktree
`.agents/worktrees/studio-version-select`, baseline `0a966ac`.

## Implemented

- Replaced the free-text Minecraft version field with a newest-first stable release dropdown. The official
  Mojang manifest was fetched on 2026-10-24; following the STUDIO-VERSION-SELECT-02 decision, the committed
  catalog now contains the 48 releases from `1.14` through `26.3`. Snapshots, pre-releases, and stable releases
  below `1.14` are excluded; the app makes no runtime request for the Minecraft list.
- Replaced the free-text loader version field with a dropdown populated for the selected Minecraft release and
  Fabric/NeoForge kind. Fabric uses `https://meta.fabricmc.net/v2/versions/loader/{minecraftVersion}` and the
  stable loader entries. NeoForge uses the official Maven metadata at
  `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml` and matches the version
  family (`21.1.*` for Minecraft `1.21.1`, `21.0.*` for `1.21`). Old releases without a NeoForge family, such
  as `1.14`, show an empty compatible list.
- Loader metadata is requested only through the trusted Studio request IPC. The main process accepts exact
  fields, validates Minecraft IDs against the pinned catalog, uses fixed upstream URLs, applies a 10 second
  timeout and 2 MiB response limit, and filters to stable numeric versions. Renderer responses are cached by
  game/kind for that renderer session. Loading, offline/error with retry, and no-compatible-version states are
  displayed.
- Changing game or loader kind clears the currently selected loader version while querying. A previous value
  is restored only if it appears in the newly returned compatible list. Otherwise it stays blank and normal
  Studio project validation prevents saving until a loader version is selected. A legacy game ID outside the
  pinned list must be replaced from the dropdown.
- The UI states that list membership does not mean the game installer has been validated. Current installation
  validation remains Minecraft `1.21.1` on Windows/Linux x64.

## Validation

Passed on the worktree sources:

- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec vitest run apps/admin/src/main/loader-versions.test.ts apps/admin/src/main/ipc.test.ts apps/admin/src/shared/minecraft-versions.test.ts apps/admin/src/renderer/src/pages/Pages.test.ts` — 4 files, 12 tests passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm --filter @torchlauncher/studio typecheck` — passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec biome check` on the 12 changed TypeScript files plus `styles.css` — exit 0, no errors; 31 existing CSS warnings remain.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm --filter @torchlauncher/studio build` — passed.

## STUDIO-VERSION-SELECT-03 test correction

After the minimum moved to `1.14`, the NeoForge no-compatible-version fixture now uses allowed release `1.14`.
The unsupported-version test now verifies `1.7.10` is rejected before metadata is queried.

- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec vitest run apps/admin/src/main/loader-versions.test.ts` — 1 file, 5 tests passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec biome check apps/admin/src/main/loader-versions.test.ts` — passed.
- `DISPLAY=:0 node apps/admin/scripts/smoke-functional.mjs` — passed; Studio pages, persistence, layout and IPC/isolation smoke.
- Queried Mojang, Fabric Meta and NeoForged official endpoints during implementation. Mojang returned 76 stable
  releases at/above the selected minimum; the live Fabric response had stable loader entries for `1.21.1`, and
  Maven metadata contained the `21.1.*` NeoForge family.

The new worktree initially lacked dependencies. `pnpm install --frozen-lockfile` could not create the default
pnpm store under `/home/jiun11/.local/share/pnpm/store` in this environment. For validation only, temporary
symlinks to the coordinator checkout's already installed root and Studio `node_modules` were used, then removed
before commit. No product dependency or lockfile changed.

## Limitations

- The Minecraft catalog is intentionally pinned and must be refreshed in source when the product approves a
  newer catalog snapshot.
- The online metadata endpoints can be unavailable; users then see an error and can retry. Loader lists are
  cached for the renderer session after a successful response.
- Selector availability is broader than installation QA. No extra game/loader combinations were installed or
  end-to-end tested in this task.

## STUDIO-VERSION-SELECT-02 follow-up

User changed the Minecraft minimum from `1.7.10` to `1.14`. The pinned catalog and its test were pruned to 48
stable releases, retaining newest-first order and the no-runtime-fetch behavior. The version selector continues
to require a listed value before saving; English and Korean selector guidance now both state the `1.14` minimum.

Follow-up validation on the updated worktree:

- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec vitest run apps/admin/src/shared/minecraft-versions.test.ts apps/admin/src/renderer/src/i18n/catalog.test.ts` — 2 files, 2 tests passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm exec biome check apps/admin/src/shared/minecraft-versions.ts apps/admin/src/shared/minecraft-versions.test.ts apps/admin/src/renderer/src/i18n/catalog.ts apps/admin/src/renderer/src/i18n/catalog.test.ts` — passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm --filter @torchlauncher/studio typecheck` — passed.
- `PATH=/tmp/main-i18n-bin:$PATH pnpm --filter @torchlauncher/studio build` — passed.
