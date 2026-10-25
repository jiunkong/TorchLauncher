# Launcher release downloads

`packages/core/src/releases` is the Electron-free download foundation shared by Studio
export and both apps’ main-process update backends. The default repository is
`jiunkong/TorchLauncher`; renderer input does not select repositories or URLs.

The client’s host-only `application` option defaults to `launcher`; `studio` selects exact
`TorchLauncher Studio-<version>-<platform>` assets. Cache validation checks the selected
product’s filename, so a launcher artifact cannot satisfy a Studio update or vice versa.
Studio export continues to use the default launcher target.

- `latest(target, signal)` reads and validates stable GitHub release metadata only.
- `download(target, { signal, progress, newerThan? })` fetches fresh metadata itself.
  `newerThan` requires a strictly newer stable version before cache reuse or executable
  download. Metadata previously returned to a caller is never accepted as download authority.
- `cached(target, signal)` verifies the cached artifact without contacting GitHub. Studio
  export alone uses it after a network failure, with explicit approval for that exact version.
  Neither app’s self-update flow falls back to an offline artifact as a successful update.

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
`apps/launcher/src/main/updates` and `apps/admin/src/main/updates` provide check, download, cancellation and state snapshots.
The launcher and Studio in-app Help menus show the current app version and explicit Check for updates / Update
actions in Korean and English. Startup and menu opening only read local state; they do not
query GitHub. Update is enabled after a newer stable version is found. Duplicate operations
are disabled, and status reports available/no-release/offline/errors and received bytes in the
menu while open. Completed explicit actions also appear in the launcher toast or Studio notice. `downloaded` means
the file was downloaded and verified; it does not mean installation or restart.
Trusted main-frame IPC accepts only exact check/download commands, never repository, version,
URL or path overrides. Event subscriptions follow window lifecycle; shutdown cancels and
awaits active download cleanup. Unsupported platforms report safe state without blocking
app startup. A new operation cancels its predecessor;
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

Studio’s Help menu checks Studio itself; its existing launcher export resolver remains separate.
Confirmed window exit aborts and awaits update cleanup before destroying the Studio window;
cancelling an unsaved-project close confirmation keeps the updater usable.

Focused mocked-transport tests cover shared product identity, both update services and trusted
IPC, menu gating and status, and Studio export compatibility. Native Windows execution, real GitHub downloads,
installation, restart and UI remain separate validation work.
