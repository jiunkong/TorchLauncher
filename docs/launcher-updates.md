# Launcher release downloads

`packages/core/src/releases` is the Electron-free download foundation shared by Studio
export and the launcher main-process update backend. The default repository is
`jiunkong/TorchLauncher`; renderer input does not select repositories or URLs.

- `latest(target, signal)` reads and validates stable GitHub release metadata only.
- `download(target, { signal, progress, newerThan? })` fetches fresh metadata itself.
  `newerThan` requires a strictly newer stable version before cache reuse or executable
  download. Metadata previously returned to a caller is never accepted as download authority.
- `cached(target, signal)` verifies the cached artifact without contacting GitHub. Studio
  alone uses it after a network failure, with explicit approval for that exact version.
  The launcher never falls back to an offline artifact as a successful update.

Versions are stable x.y.z (optional v tag prefix), compared numerically. Drafts,
prerelease tags, ambiguous versions, missing/duplicate assets and missing SHA-256
checksums fail closed. Launcher target detection supports Windows x64 and Linux x64;
macOS and Linux ARM64 are unsupported. Studio can export either supported target.

HTTPS hosts, redirects, response sizes, lengths, executable headers and SHA-256 are
validated. The 120-second network deadline covers headers and streamed bodies.
Caller cancellation stays cancellation. Cache reads reject symbolic links, hard links
and special files. Each download stages a unique generation, then publishes its pointer
atomically; failed staging preserves the previous cache. Published generations are
retained so simultaneous consumers do not lose their artifact. Cache pruning is deferred.
Caches must live in application-owned directories; these checks do not provide a sandbox
against a malicious process concurrently replacing user-owned directory ancestors.

Studio retains its development-local package behavior and existing status/error contract.
`apps/launcher/src/main/updates` provides check, download, cancellation and state snapshots
without startup, renderer, preload or IPC wiring. A new operation cancels its predecessor;
stale completions cannot overwrite newer state. The returned artifact path stays in the
host process; snapshots contain no local paths or transport URLs. `downloaded` means
verified cached bytes. No downloaded executable is run, installed or used to replace files.

The digest and size currently come from GitHub's HTTPS API. They detect transport and
cache corruption but are **not independent publisher authentication**. Before a future
installer may execute or replace the launcher, it must verify an independently signed
publisher manifest according to [release policy](release-policy.md), and implement the
remaining installation/rollback policy. This module does not satisfy that signed updater
manifest requirement. `release-metadata.json` is not a signed manifest. No signing keys,
release workflow changes or automatic installation are included here.

Focused mocked-transport tests cover shared boundaries and launcher state behavior; Studio
resolver tests cover export compatibility. Native Windows execution, real GitHub downloads,
installation, restart and UI remain separate validation work.
