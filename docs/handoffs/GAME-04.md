# GAME-04 — full downloads and managed Java runtime

- Session: `launcher develop #3` / TorchLauncher worker #3.
- Branch/worktree: `feat/game-04-runtime`, `.agents/worktrees/agent-3`.
- Baseline: `58fe23ea2c7d13e52d63a9e6f69220c04df359c2`.
- Implementation commit: `3bd1837b2cea0044060b412b58e51e2a73e21674`.
- The final handoff commit hash is reported separately in the session reply.
- Exclusive scope: `packages/core/src/minecraft/**`, `packages/core/src/download/full/**`,
  this handoff. No shared manifests/exports, IPC, app entry points, tracker or integration
  branch changed. #0 owns review, integration and task completion decisions.

## Contracts and behavior

`download/full.createFullDownloader(options?)` implements the existing installer
`Downloader` contract. It performs anonymous complete GETs with HTTPS, manual
redirect validation, no cookies/authentication/Range headers, bounded receipt and
exact declared-length checks. HTTPS downgrade, URL credentials/fragments, partial
responses and encoded bodies fail explicitly. Plain HTTP is allowed only for an
explicit localhost fixture option; HTTPS-to-HTTP is still refused.

Defaults: three attempts, 150 ms retry delay, five redirects, 120-second whole-attempt
limits. Transient transport failures, timeouts, HTTP 408/429/5xx retry from byte zero;
protocol violations and other HTTP errors do not retry. Cancellation terminates a
pending body and retry delay. `maxBytes` remains mandatory per call, capped at
512 MiB; the installer caps JSON at 16 MiB. Unknown-length buffers grow within this
byte limit, without retaining an unbounded list of tiny chunks. Responses are still
buffered per file, and transfers remain sequential. There is no disk-streaming or
byte-resume API. `onBytes(count)` reports payload bytes received, including body
bytes from failed/retried attempts, without exposing signed URLs. This adapter is
not a fallback for the separate pinned Range deployment engine.

`minecraft.acquireServerDataLock(root, purpose)` returns a cooperative filesystem
lease for `install`, `game` or future `maintenance` callers. The installer now holds
this lease throughout its existing staged transaction; the managed process holds it
until the child's `close` event, output completion and cleanup. Simultaneous installs,
game launches and lease-aware maintenance operations fail while it is held.
Strict root/ancestor symlink containment is preserved. Owner metadata contains only
an opaque ownership ID, host PID and purpose; release checks ownership and is
idempotent. Future deletion/update entry points must acquire this same lease.

`minecraft.launchMinecraft(installation, launchOptions, processOptions?)` uses the
existing AUTH-compatible launch contract and `shell: false`. It resolves after the
native spawn event, returning `{pid, finished, stop, getLogs}`. A spawn acknowledgement
is not Minecraft readiness or successful server connection. Start failures expose a
sanitized `GameStartError` code, never the raw spawn error, original argv or a
`ChildProcess` object. `finished` preserves exit code/signal and distinguishes ordinary
exit, requested stop, cancellation, process/output errors and lease cleanup errors.
Stop/cancel sends SIGTERM and escalates to SIGKILL after a configurable grace period
(default five seconds). Termination semantics depend on the host; graceful game
shutdown is not guaranteed. Process management covers the direct Java child, not
arbitrary descendant process trees created by third-party code.

Stdout/stderr are collected in bounded in-memory snapshots, with no on-disk logging
or credential/argv diagnostics. Supplied token, player name/UUID, xuid and client ID
are redacted case-insensitively, along with common token/authorization labels. UTF-8
and secrets split across chunks remain buffered until a complete line; oversized raw
lines are discarded instead of emitting partial token text. Defaults are 256 KiB,
512 entries and 16 KiB raw lines. Snapshot counters report eviction/discarding. Only
safe, bounded copies of retained entries are returned; log export/UI is not implemented.

`minecraft.startJavaDiagnostic(installation, processOptions?)` executes only
`-version`, without authentication, using the same process/lock/log boundary.
`processOptions.spawn` and downloader `fetch` are privileged host/test adapters;
they are not renderer/IPC contracts. The defaults use native Node spawn/fetch.
All module imports remain internal relative imports; root package exports were not added.

## Actual Linux validation

Node `v24.21.0`, pnpm `10.34.7`, Linux x64/WSL. Dependencies were installed in this
worktree with `CI=true pnpm install --frozen-lockfile --store-dir
/tmp/torchlauncher-pnpm-store`; CI mode was needed to replace the prior store linkage
without an interactive prompt. Nested scripts used
`PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`. No dependency changes.

Command, run twice against an explicit temporary root:

```sh
TORCH_GAME_LIVE_ROOT=/tmp/torchlauncher-game04-live pnpm exec vitest run packages/core/src/minecraft/live-install.test.ts
```

The first run fetched real official 1.21.1 metadata, client, library/native JARs,
assets, logging config and the Linux Java runtime. All installer hashes/lengths were
checked, then the installed executable ran through `startJavaDiagnostic` successfully:

| Measurement | Cold install | Verified-cache repeat |
| --- | ---: | ---: |
| Received payload bytes | 1,024,456,840 | 862,331 |
| Completed resource downloads | 4,087 | 5 |
| Installation duration | 154,922 ms | 8,390 ms |
| Java result | exit 0 | exit 0 |

Java reported Microsoft OpenJDK `21.0.7+6-LTS`, 64-bit Server VM. The cold installed
files totaled 1,024,082,474 bytes across 4,084 regular files (filesystem usage about
987 MiB). Payload counts exclude HTTP headers and TLS overhead; completed-download
counts are logical successful resources, not a count of every retry/redirect request.
The repeat re-fetched metadata and reused all published binaries/assets. Its disk
count includes the previous local receipt, an unrelated file preserved by installation.

Machine-readable evidence is committed in
`minecraft/fixtures/game04-linux-x64-receipt.json` and
`minecraft/fixtures/game04-linux-x64-cache-receipt.json`. The runtime/binaries remain
in `/tmp/torchlauncher-game04-live`, outside Git. The harness requires an explicit
`TORCH_GAME_LIVE_ROOT`; ordinary tests skip it and make no real-network success claim.
Internet access to Mojang's metadata, binary, library and asset hosts, sufficient
staging/backup disk, and an executable compatible Java runtime environment are needed.
No client ID, account or token was used. No authenticated game/server connection,
loader execution or Windows/macOS execution was performed.

## Automated checks

- `pnpm check`: lint, workspace TypeScript, **313 tests passed / one opt-in live test
  skipped**, and both app builds passed.
- Focused `vitest run packages/core/src/minecraft packages/core/src/download/full`:
  **66 passed / one live test skipped** after bounded-buffer changes.
- Final process-error coverage: `vitest run packages/core/src/minecraft/process.test.ts`:
  **8 passed**; core TypeScript and scoped Biome checks passed.
- Whitespace checks passed. The full check preceded the final added bounded-buffer
  and output-stream-error cases; focused checks verified those edits without another
  application rebuild.

HTTP tests use local servers and injected responses for bounds, chunking, redirects,
HTTPS downgrade, status/transport retries, cancellation, deadlines and safe errors.
Lifecycle tests use real host Node child processes with synthetic scripts through the
spawn adapter: exit codes, spawn failures, safe output errors, token/identity masking,
stop/cancel escalation, lock exclusion and release. They are not Java/Minecraft
connection tests. Actual installed-Java evidence is the separate opt-in run above.

## Deferred scope

GAME-05 automatic stale-lock/crash recovery remains excluded. A killed host can leave
`.torchlauncher-server-lock`; never steal it based only on PID or age. The existing
`.torchlauncher-install-lock`/journal/backups also remain manual-recovery state.
Managed launch refuses an unresolved installation transaction. Confirm all relevant
processes have stopped and resolve the installation journal before manually clearing
stale locks; no power-loss/fsync durability guarantee was added.

No loaders, inherited/legacy formats, companions, disconnect-exit behavior, UI, IPC,
process-tree supervision or authenticated connection work was added. Native OS
packaging/smoke validation remains #0's integration/release responsibility. The new
cooperative lease must be adopted by future deletion and update callers to enforce
running-game exclusion beyond the installer and managed launcher implemented here.
