# DL-01 live Drive validation

## V1 public-file evidence

The production Google Drive download source was exercised against the supplied public file URL. The safe receipt is `packages/core/src/download/google-drive/fixtures/dl01-live-drive-v1.json`.

- Total length: 78,641,842 bytes.
- Probe (byte 0), first, middle, last, and repeated middle ranges returned HTTP 206 with the expected `Content-Range` and total length.
- The repeated middle range had the same SHA-256 as the original middle sample.
- Full-file comparison was skipped because the file exceeds the 16 MiB cap.
- The receipt contains range metadata and hashes only. It omits the URL, file identifier, file contents, cookies, and signed URLs.

## Reproduction

Set `TORCHLAUNCHER_LIVE_DRIVE_URL` to the public link in the local environment; do not put the link in source, receipts, logs, or handoff files.

```sh
TORCHLAUNCHER_LIVE_DRIVE_URL='<public Drive link>' pnpm exec vitest run packages/core/src/download/google-drive/live-validation.test.ts
```

For the replacement check, set `TORCHLAUNCHER_LIVE_DRIVE_MODE=replacement` as well. The harness verifies the v1 samples, retains that production source instance and generation, then writes `/tmp/torchlauncher-dl01-live-drive-replacement-arm.json`. It waits up to 30 minutes for a confirmation JSON file at the `confirmationPath` in the arm file, with the same nonce and `proceed: true`. Do not create that signal until #0 confirms that the user has uploaded a clearly changed version.

```sh
TORCHLAUNCHER_LIVE_DRIVE_URL='<public Drive link>' TORCHLAUNCHER_LIVE_DRIVE_MODE=replacement pnpm exec vitest run packages/core/src/download/google-drive/live-validation.test.ts
```

After confirmation, the harness records pinned-source behavior, calls `reset()`, and records bounded v2 ranges and hashes in `packages/core/src/download/google-drive/fixtures/dl01-live-drive-v2.json`. It does not read full file contents. The pinned URL may continue serving the old version; that outcome is recorded separately from successful changed-version detection. The wait is finite and the v1 receipt is preserved.

## Status

V1 validation is complete. V2 replacement validation is waiting for #0's confirmation after the user replacement. No replacement was initiated by this worker.

## Local validation

- `biome check` passed for the opt-in harness.
- `@torchlauncher/core` typecheck passed.
- The offline Vitest invocation passed with both live tests skipped because no live URL was configured.
