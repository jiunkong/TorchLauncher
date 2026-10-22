# SIGN-LAUNCHER-01 — launcher verifies signed deployments and prevents rollback

2026-10-23. Worker `agent-1`, branch `feat/sign-launcher`, worktree `.agents/worktrees/agent-1`, baseline `1cfa91e`.
Implementation commit: `git log -1 --format=%H -- docs/handoffs/SIGN-LAUNCHER-01.md`. Not merged or integrated.
Scope kept: `apps/launcher/src/main/**`, renderer `labels.ts`, `i18n/catalog.ts`, `pages.test.ts`, this file. No core, admin, manifest or shared-contract changes.

## Behavior
- `product/deployment-trust.ts` is the single entry: `openServerDeployment(base, config, signal)` opens the reader; `recordAppliedDeployment(base, config, reader)` persists.
- Config with `signing`: `trustedPublicKey` is always passed; anything other than `verification === 'verified'` (including missing field,
  `unverified`, `unsigned`) throws `signature-unverified` before the reader is returned, i.e. before any prepare/stage/apply. Reader codes
  (`signature-required|invalid|malformed`, `invalid-signing-key`) propagate unchanged. Then the stored state is read and `decideRollback`
  runs; `reject-lower` -> `rollback-lower`, `reject-conflict` -> `rollback-conflict`. All happen inside `current()` of the launch gate, which
  runs before installation, synchronization and again in the pre-spawn guard (identical deployment is `accept`).
- Config without `signing`: unchanged legacy path (1.0/1.1 accepted; a 1.2 file is opened `unverified`, never trusted, never recorded).
- Persist: `afterSynchronization` of `launchDeployment` (called only after `synchronizeDeployment` succeeded) calls `recordAppliedDeployment`.
  Failed/cancelled sync never reaches it. It re-reads the state, re-checks the decision, never lowers, skips identical writes.
- Branding refresh (`index.ts` `openReader`) uses `openServerDeployment` (verify + read-only rollback check) and never records. The game-reader
  `observe()` path reuses the already verified game reader. Single rule: only the game synchronization path advances the floor; a branding
  read can reject a rollback but never raises the state, since it applies no deployment.
- Game smoke harness (`game-smoke/entry.ts`): optional `signingPublicKey` in its config; when set it passes the key and requires `verified`. It has no persistent state and does no rollback tracking.

## State storage
- File `<userData>/servers/<serverId>/.torchlauncher-deployment-state.json`, inside the server data root next to `.torchlauncher-sync/` and the root marker. The `.torchlauncher*` prefix is reserved (never synced, not a mod or user file), and `deleteServerData` removes it with the root (test). Consequence: deleting server data resets the floor; the next valid signature is accepted as a first install (per spec).
- Content `{"version":1,"sequence","deploymentId","indexSha256"}`, exact keys, <= 1024 bytes, regular single-link file, O_NOFOLLOW read, id <= 128 chars. Write = temp file (0600, fsync) + rename in the same directory, via `verifyServerRoot`.
- Missing file or missing root = no state (accept). Any other read problem, malformed, oversized, extra keys, symlink -> `rollback-state-unreadable` (fails closed, file left untouched, never reset automatically). Write failure after a successful apply also yields `rollback-state-unreadable` and stops the launch.

## Failure codes and i18n
New safe codes in `safeCodes`: `signature-required`, `signature-invalid`, `signature-malformed`, `invalid-signing-key`, `signature-unverified` (shown with the signature-invalid text), `rollback-lower`, `rollback-conflict`, `rollback-state-unreadable`. Korean messages in `catalog.ts` (`failure.*`, en inherits ko; catalog parity test passes). Messages carry no key material, URL or raw error. Note `signature-invalid` covers both bad signature and wrong key (core decision).

## Notes
- `BrandingDeploymentReader.verification` stays optional in core; the launcher reads it via the concrete `openDeploymentReader` return type (`OpenedDeployment`) and treats a missing value as untrusted. Tightening needs a core change (not made).
- A rollback-state failure message suggests deleting server data as recovery, which resets the floor by design.

## Validation (WSL, this worktree)
- `pnpm check`: exit 0 (Biome only pre-existing warnings; typecheck; Vitest 79 files passed / 4 skipped, 1147 tests passed / 9 skipped; both builds).
- `node scripts/smoke.mjs`: passed. `node apps/launcher/scripts/branding-smoke.mjs`: PASS.
- New tests: `product/deployment-trust.test.ts` (real Ed25519 writer/signer: valid, unsigned, wrong key, tampered, no-key 1.2, legacy, lower / equal-conflict / equal-same / higher, no persistence on open, never lowers, atomic file, corrupt-state matrix fails closed, state deleted with server data) and `product/service-signing.test.ts` (service-level: persisted only after apply, unchanged on failed apply, safe codes, lower rejected after success). Pages test covers the new labels.
- Not run: Windows, real Drive, `game-smoke.mjs` (needs real downloads/auth), packaged apps. The real private server config was not used.
