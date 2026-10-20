# GAME-01 handoff — Java and Minecraft installation core

- Session: `launcher develop #3` (TorchLauncher worker #3).
- Branch/worktree: `feat/game-01-installer`, `.agents/worktrees/agent-3`.
- Baseline: `866e194f95487af9353348a72ee03fd0ecbd5987`.
- Implementation commit: `cb35d25598b1a3b0c3102159317bd838e6dbb0db`.
- Host-portability review commit: `31f0404e0d12af1485b71b14a4720316b4f2771d`.
- This handoff is committed separately after the implementation; its final branch-tip
  hash is reported in the session's final reply to avoid a self-referential hash.
- Scope: `packages/core/src/minecraft/**`, `docs/handoffs/GAME-01.md` only.
- Ready for #0 review and integration; no tracker updates or integration performed.

## Behavior and entry points

`packages/core/src/minecraft/index.ts` exposes the internal installation and launch
API. No package manifest, root export, IPC, app, loader, or authentication code changed.
A shared package export can be assigned separately by #0 when a consumer needs it.

`installMinecraft({root, platform, download, signal?, onProgress?, version?})`:

- Defaults to Minecraft 1.21.1 and resolves official Mojang version/runtime catalogs.
  Verifies the version document SHA-1, then the asset index, runtime manifest, client,
  selected library/native JARs, logging configuration, Java files, and asset objects
  against published hashes and exact byte lengths.
- Uses Windows x64/ARM64, macOS x64/ARM64, and Linux x64 runtime catalogs. Linux
  ARM64 and unsupported OS/architecture values fail explicitly. Selects JVM/library
  rules by OS, architecture and OS version, applying the last matching rule. For
  1.21.1 it retains the OS-allowed native JAR set from Mojang's metadata, whose JARs
  carry the architecture-specific resources; no legacy native archive extraction.
- Hash-checks existing file content, reuses valid game/library/asset/Java bytes, and
  repairs corrupted content. Duplicate assets download once. A Java runtime is rebuilt
  in staging from verified cache bytes/downloads and replaced as one complete tree,
  including executable permissions and safe relative license links.
- Rejects traversal, Windows device/ambiguous paths, conflicting paths, symlinked
  roots/ancestors/destinations, dangling/escaping runtime links and file/link ancestors.
- Stages all content before publication. Cancellation and transfer/integrity failures
  preserve prior published files. Publication failures restore earlier replacements;
  rollback failure preserves backups and reports the recovery directory. Empty
  directories created while preparing destinations may remain after a failed install.
- Returns `Installation` containing Java path, ordered classpath, version metadata,
  asset/logging/native directories and the target platform. Does not start a process.
- Preserves unrelated server files/settings and performs no stale library/asset cleanup.

`buildLaunchCommand(installation, options)` returns executable, argv, cwd,
`shell: false`, and separate `redactedArgs` suitable for diagnostics. Resolves published
JVM/game placeholders, target-OS classpath separators, Java memory, macOS arguments,
logging configuration, optional custom resolution and multiplayer Quick Play. Rejects
expired/invalid identity inputs, unknown placeholders and NUL arguments. Raw argv
contains the access token and must not be logged or persisted by the caller.

The structural authentication boundary matches #0's AUTH-01 contract decision:

```ts
{
  accessToken: string;
  expiresAt: number; // epoch milliseconds
  profile: { id: string; name: string }; // id: 32 hexadecimal characters
  userType: 'msa';
  clientId: string; // public OAuth application ID
  xuid?: string;
}
```

Installation requires no account. Launch assembly consumes an externally acquired,
current session and never acquires, refreshes, saves, or logs credentials.

## Download and filesystem integration contract

`Downloader` is `(url, {signal?, maxBytes}) => Promise<Uint8Array>`. It must bound the
response while receiving it, reject HTTP errors/unsafe redirects, honor cancellation,
and own transport retries. The installer validates returned bytes again. No second
HTTP engine, gdown code, Google integration, archive dependency, or manifest change
was introduced. The downloader must support ordinary complete HTTPS resources;
these Mojang files are not the product's single-file Range deployment format.

The caller supplies a dedicated server root and native host platform, serializes all
writers/deletion/game launch, and starts Java only after installation resolves. Paths
are native to the host running installation; simulated target selection in tests does
not generate a portable Windows installation from Linux.

A `.torchlauncher-install-lock` directory excludes a second installer. During staging
it contains staged files; before publishing, `journal.json` records the absolute target,
staged and backup paths for every operation. A killed process leaves this lock in
place; it is never automatically stolen. Recovery must confirm no process owns the
root and validate journal paths against that same root before restoring backups in
reverse operation order. A present backup corresponds to an original target moved
aside. For an originally absent target, a missing staged file indicates it was moved
to the target. Remove the lock only after recovery is resolved. No automatic stale-lock
recovery API or power-loss/fsync durability guarantee is provided in this task.

## Validation

Environment: Linux/WSL, Node `v24.21.0`, pnpm `10.34.7`. Dependencies installed in this
worktree with `pnpm install --frozen-lockfile`. The initial sandboxed attempt could
not create pnpm's default home store; the same install succeeded with sandbox
escalation. Nested scripts used `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`.
No manifest/lockfile changes were needed.

Passed:

- `pnpm check`: Biome, all workspace TypeScript checks, **48 tests across 3 files**,
  and both Electron app builds.
- Initial targeted validation: `pnpm exec vitest run packages/core/src/minecraft`:
  **36 tests across 2 files**; `pnpm --filter @torchlauncher/core typecheck`.
- `pnpm exec biome check --write packages/core/src/minecraft`: clean after formatting.
- `git diff --check` and staged whitespace checks.
- After #0's host-portability review: `pnpm test` passed **49 tests across 3 files**
  (37 Minecraft cases, no skips on this Linux host), `pnpm lint` and
  `pnpm --filter @torchlauncher/core typecheck` passed. Changes were confined to
  tests/fixtures and this handoff; application builds were not repeated.

Behavioral coverage includes five simulated platform selections, hashes/lengths,
asset deduplication, cache reuse/corruption repair, personal-file preservation,
cancellation even when an adapter ignores the signal, malformed asset metadata,
version tampering, root/ancestor symlinks, unsafe paths/links, second-writer exclusion,
publication rollback and rollback-failure recovery preservation. Launch tests use
Mojang's published 1.21.1 metadata and cover rules, separators, placeholder resolution,
Quick Play, resolution, identity expiry/validation and redacted diagnostics.

Read-only live evidence: fetched the official version catalog, 1.21.1 document, Java
runtime catalog, and macOS ARM64/Windows x64 Java manifests; locally recomputed the
three child document SHA-1 values and confirmed their upstream hashes. The real
1.21.1 metadata fixture records its source and upstream hash. Other download bytes
in automated tests are synthetic, so these tests do not assert real Java/game execution.

Primary metadata sources:

- [Mojang version catalog](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
- [1.21.1 metadata](https://piston-meta.mojang.com/v1/packages/1757c8b1fbfc6b638504e1f6cceb05893f7389d5/1.21.1.json)
- [Mojang Java runtime catalog](https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json)

## Remaining validation and explicit limits

- Full real Java/client/library/asset installation, running Java, paid-account game
  launch, and a real server Quick Play connection were not executed. These require
  subsequent integration validation; no OS execution compatibility claim is made.
- No Windows/macOS native filesystem/process run, Electron smoke, or portable package
  verification was performed. The cross-platform tests simulate metadata selection
  on Linux, including Java paths, rather than executing binaries for those targets.
  Fixture roots resolve `realpath(tmpdir())` so a host's conventional temporary-path
  symlink is excluded from the caller-supplied root. Strict production containment
  remains unchanged. Unix execute-mode assertions run only on non-Windows hosts.
  Ordinary install fixtures require no symlinks; the three symlink-dependent cases
  skip with an explicit host-capability reason for EPERM/EACCES/ENOTSUP/ENOSYS.
  Other symlink errors remain failures. A skipped symlink case is not containment
  validation for that host; rerun on a host/account capable of creating the links.
- Process spawning, stdout/stderr capture, log rotation/export/redaction of process
  output, exit/error mapping and game-running locks are deferred to caller/launcher
  integration. This task returns a spawn-ready command and redacted diagnostic argv;
  it does not implement a process manager or a log-capture adapter.
- Stale-lock detection and automatic crash recovery remain deferred. Only manual
  recovery from the preserved lock/journal/backups is documented above; injected
  commit/rollback failures were tested, not actual process-kill or power-loss recovery.
- Only the modern Java 21 metadata family is accepted; 1.21.1 is the fixture-backed
  target. Legacy assets/native extraction, version inheritance, loaders and helper
  mods are explicitly excluded. Other modern versions have not been validated.
- Transfers are sequential and buffered one file at a time (maximum declared file
  size 512 MiB, JSON 16 MiB). Staging plus backups/runtime copies require spare disk.
  Byte-level resume, bounded streaming-to-disk, retries and download UI are follow-up
  integration work; repeated installation reuses successfully published verified files.
- Trusted HTTPS vendor catalogs are the bootstrap trust boundary; their SHA-1 values
  provide the vendor's content integrity checks, not independent publisher signing.
