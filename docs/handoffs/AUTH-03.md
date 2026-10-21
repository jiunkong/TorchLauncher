# AUTH-03 — Temporary public Java authentication

- Owner: `launcher develop #4`, branch `feat/auth-03-public-java`.
- Baseline: `b53d5da` (`docs: authorize temporary public Java authentication provider`).
- Final commit: reported separately to avoid a self-referential hash.
- Status: implementation ready for integrated review; real Windows account cycle remains pending.

## Behavior and boundaries

The user explicitly authorized temporary public Java Title authentication while own-app approval is
deferred. The public route uses pinned MIT `prismarine-auth@3.1.1`, an explicit Java Title, `sisu`
flow, and Win32 device metadata. It does not pass the Title through the own-app PKCE GUID validator.
The smoke default is now `public-java`; `--provider own-app` explicitly retains the previous PKCE
implementation. Supplying own-app ID/redirect options without selecting that provider is rejected.
There is no fallback between providers. The original own-app 403 cause remains unconfirmed.

The library runs in a private Node child using Electron's Node mode in the app. Both the app build
and temporary smoke build emit `public-java-worker.cjs` plus the bundled library chunks. No product
renderer or privileged IPC interface was added. Library console/debug output is suppressed and its
stdout/stderr are discarded. Only fixed private worker messages, cache values and the validated
account result reach Electron main; raw library errors are replaced with safe error codes.

The library always receives a custom memory cache factory. Cache updates are acknowledged through
private IPC after Electron main writes an OS-encrypted snapshot. All library cache payloads use a
separate `public-java` directory/key; the default plaintext file cache is never instantiated. The
shared atomic encrypted-file implementation was extracted without changing the own-app disk format,
key rules or validation. Public snapshots are limited to 128 KiB; ciphertext and transport response
reads retain 256 KiB caps. Linux insecure/unknown backends still fail closed.

Each operation starts with fresh Xbox device/title/XSTS and Minecraft-token cache entries because
the library creates a new proof key. The live refresh session remains encrypted. Both login and
refresh obtain a fresh Minecraft token and independently perform online Java license/profile checks;
the library's optional helpers, which swallow service errors, are not used for those checks. Token
expiry, Java entitlement and profile shape must all validate before returning `MinecraftAuthResult`.
Refresh cannot silently open a device prompt: an interactive requirement returns a safe error.

Some upstream cache writes are unawaited. The worker records all persistence promises and drains
them before success; main also drains accepted writes before returning. Cancellation/timeout/logout
closes the write gate, terminates/reaps the child, closes the local code window, and drains any write
already in progress. Logout then removes the encrypted snapshot. Queued/late messages cannot restore
it. The operation limit defaults to five minutes; child requests are limited to thirty seconds, and
an unresponsive child receives SIGKILL after SIGTERM. In-flight OS encryption/filesystem calls are
not interruptible; cleanup waits for them before reporting logout complete.

The device code appears only in a local sandboxed window with no script or Node integration. Main
opens a fixed Microsoft sign-in page in the system browser and ignores provider-supplied URLs.
The code, tokens, account/profile and response bodies are excluded from diagnostic JSON and handoff.
Closing the local window cancels authentication. Logout is local cache deletion, not remote consent
revocation. A cancelled/failed login may retain an earlier encrypted partial session until logout.

## Dependencies and licensing

`apps/launcher/package.json` pins `prismarine-auth` to 3.1.1; the lockfile pins its resolved graph.
Release provenance/integrity, the upstream MIT license and notices for all 24 distinct runtime
packages are recorded in `third-party/prismarine-auth/`. The launcher build emits their consolidated
notice into `out/main`, which the existing packaging file rules include. No LGPL implementation was
copied. Final own-app registration/approval and switching back before distribution remain follow-up
work owned by #0.

## Validation and limitations

Validation uses an isolated Linux copy under `/tmp/torchlauncher-auth03-validation` so the user's
Windows-installed worktree dependencies are not replaced. Dependency installation there used the
committed lockfile with lifecycle scripts disabled. An existing Linux Electron binary was supplied
only for non-login worker execution.

- Full `pnpm check`: passed (Biome, all workspace TypeScript checks, **474 tests passed / 3
  skipped**, both app builds). Skipped checks are the existing environment-dependent live suites;
  they are not counted as successful real-account authentication.
- The production app worker successfully loaded pinned 3.1.1 under Electron Node mode, completed a
  constructor-only self-check with a custom cache factory, and was killed/reaped. No network/login.
- `worker-check` successfully built and ran the temporary smoke worker from an isolated temporary
  bundle directory. This confirms the library resolves in that bundle too. No network/login/cache.
- The app worker self-check also passed after copying its CJS bundle/chunks into a standalone
  directory with no dependency tree. Both checks confirmed library version 3.1.1 and process reaping.
- Non-live CLI argument checks rejected a missing own-app ID and rejected own-app options under the
  default public provider, preserving explicit provider selection.
- Unit checks cover cache encryption/restart/deletion, insecure storage rejection, payload limits,
  unawaited-write barriers/failures, timeout/cancel/logout/late writes, local-only device-code handling,
  redaction, fresh proof/token caches, ownership/profile failure and non-interactive refresh.
- No real public Java login, Windows DPAPI cycle, packaged-app host execution, macOS Keychain cycle
  or authenticated Minecraft game launch has been claimed. Those need separate execution evidence.

## Windows verification after #0 integration

Use Windows Node 24 and pnpm 10.34.7. From the integrated checkout root, the exact public-default
commands are:

```powershell
pnpm install --frozen-lockfile
$data = "$env:LOCALAPPDATA\TorchLauncherAuthSmoke"
node scripts/auth-smoke.mjs worker-check --data-dir $data
node scripts/auth-smoke.mjs probe --data-dir $data
node scripts/auth-smoke.mjs storage-cycle --data-dir $data
node scripts/auth-smoke.mjs cycle --data-dir $data
```

The last command opens a local code window and the system browser. Complete login locally. It then
starts separate Electron processes for fresh-token refresh, logout and empty-cache verification.
Only a complete cycle prints `liveAuthentication: "verified"`. Share only sanitized result JSON,
never the code, browser address, cache files or token values. If a stage fails or is cancelled:

```powershell
node scripts/auth-smoke.mjs logout --data-dir $data
node scripts/auth-smoke.mjs assert-empty --data-dir $data
```

The own-app route is available by adding `--provider own-app` with that app's locally entered client
ID and redirect options. It is not part of this public-provider live cycle. #0 coordinates the next
user test; this worker has not requested a duplicate login.
