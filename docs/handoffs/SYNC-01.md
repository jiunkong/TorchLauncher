# SYNC-01 — server content synchronization

Worker #2, branch `feat/sync-01-engine`, baseline `f66aee0`. Scope is `packages/core/src/instance/sync/**` and this handoff. Integration belongs to #0.

## API and behavior

The internal `sync/index.ts` exports `synchronizeDeployment({ root, expectedServerId, reader, signal?, onProgress? })` and `recoverSynchronization({ root, expectedServerId })`. Both acquire the shared maintenance lease. Synchronization returns downloaded/reused/preserved/deleted counts and any startup recovery result. Progress callbacks are awaited before commit; failure or cancellation rolls back.

Any deployment-contract-valid game-content relative path is supported, including custom formats, mod data and saves. Installer-owned `runtime`, `versions`, `libraries`, `assets`, `natives`, credential `accounts`/`public-java`, and `.torchlauncher*` roots are protected with the contract's collision key. Root/parent/target symlinks, hardlinked files, file/directory transitions, case aliases, and policy changes are rejected. NFC-equivalent disk spellings resolve to the actual existing spelling; this was tested on Linux, without claiming native macOS verification.

An absent ledger never reconstructs ownership from disk. New always files conflict with any unregistered existing file, even matching content. Previously owned always files are reused when their local length/hash matches, repaired when missing or changed, and removed when omitted. Initial-only files are supplied only during the first successful setup. Existing personal files are preserved; later changes/deletions and later-added defaults remain untouched. Historical initial-only entries remain in the ledger to retain policy/collision checks.

## Transaction and recovery

Private state lives in `.torchlauncher-sync/`. The ledger and journal use strict canonical UTF-8 JSON: exact fields and canonical representation reject malformed data, duplicate keys, BOM, unknown fields and invalid paths. Journal operations must be authorized by validated previous/next ledgers; it is not a free-form deletion list.

The engine records a staging journal, stages every needed file through the production reader, and verifies staged hashes before changing game files. It rechecks original fingerprints, the ledger, source generation and cancellation before applying. Existing files are renamed into same-volume backups; staged files are renamed into place. The ledger is replaced last. The committed journal is saved before backup cleanup. Reader reset or cancellation during final verification still triggers rollback.

Startup recovery discards known partial staging, rolls back an applying transaction, or finishes cleanup of a committed transaction. It preflights every restoration, including the ledger, before mutation. Unknown artifacts, wrong hashes, links, missing backups, or ambiguous external targets preserve the journal/backups and return `recovery-required`. An identical external new target is preserved if its uninstalled stage still exists. Cleanup uses validated individual unlink/rmdir operations and no recursive product deletion. Newly created empty content directories may remain after rollback.

This is cooperative process safety. Adversarial local filesystem replacement, native reparse-point completeness and actual power-loss durability are not claimed. Files are fsynced before journal/ledger publication; directory fsync/power-cut testing is outside this verification. Stale server leases are never stolen; their recovery remains GAME-05.

## Operational budgets

- 10,000 tracked ledger entries (including retained initial-only history); up to 20,000 journal operations.
- 8 MiB ledger, 32 MiB journal, bounded before reading/parsing.
- 4 GiB maximum existing/staged file length; the supplied reader can enforce a lower budget (its default is 1 GiB decoded per file).
- Local file hashing uses 256 KiB buffers. Remote staging uses the reader's bounded ranges. Directory spelling inspection rejects more than 100,000 entries in one directory.

## Validation and continuation

Scoped Biome and core TypeScript passed. Writer→mock HTTPS source→reader→sync tests passed: 32 tests; the opt-in live test was skipped in the offline invocation. Tests cover initial/repeated/update sync, payload selection, generic paths, personal data, unowned conflicts, policy/spelling/path safety, locks, bounded invalid state, stage failures, source reset, cancellation, apply rollback, ambiguous external files, unknown recovery artifacts, ledger replacement recovery and committed cleanup.

Real Drive v1 passed on 2026-10-21: 140,736-byte container, five files downloaded; same-reader repeat downloaded zero, reused four, preserved one and made zero additional range requests. Safe receipt: `sync/fixtures/sync-live-v1.json`. The first replacement wait expired without user replacement; it is not evidence of a product failure, and that old nonce/process must not be signaled.

The opt-in `sync/live-validation.test.ts` accepts `TORCHLAUNCHER_SYNC_LIVE_URL` and `TORCHLAUNCHER_SYNC_LIVE_MANIFEST`. The manifest and synthetic v1/v2 artifacts are in the coordinator's ignored `.cache/sync-validation/`; regenerate them when moving machines. The URL remains an environment/ignored-file input and is never committed. Start a fresh run, inspect `/tmp/torchlauncher-sync-live-arm.json`, then immediately give #0 its nonce, confirmation path and deadline. Only #0 coordinates the user replacement. The harness retains the v1 source, tests it after confirmation, resets/rereads v2, and checks two changed payloads, managed-file deletion and personal-setting preservation. V2 live evidence is pending until that run completes.

```sh
pnpm --filter @torchlauncher/core typecheck
pnpm exec biome check packages/core/src/instance/sync
pnpm exec vitest run packages/core/src/instance/sync
```
