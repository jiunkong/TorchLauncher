# SIGN-STUDIO-01 — Studio signing key, backup, signed builds, exported signing config

2026-10-23. Worker `agent-2`, branch `feat/sign-studio`, worktree `.agents/worktrees/agent-2`, base = main `1cfa91e`.
Implementation commit: `git log -1 --format=%H -- docs/handoffs/SIGN-STUDIO-01.md`. Not merged or integrated.

## Implemented (main process only)
- `apps/admin/src/main/signing.ts`: `SigningKeyStore(directory, safeStorageLike, scryptParams?)`.
  - One Ed25519 key per `serverId`, stored in `<userData>/signing-keys/<sha256(serverId)>.json` (0600, atomic temp+fsync+rename,
    strict parsing, `O_NOFOLLOW`). Private key = PKCS8 DER encrypted with `safeStorage.encryptString`; public key and `sequence`
    are plaintext in the record. Load re-derives the public key and rejects a mismatch (`KEY_CORRUPT`).
  - Encryption unavailable (`isEncryptionAvailable()` false, throws, or Linux backend `basic_text`/`unknown`) -> typed
    `ENCRYPTION_UNAVAILABLE` for create/load/sign/import; nothing is written.
  - Backup: JSON `torchlauncher-signing-backup` v1, scrypt (N=2^17, r=8, p=1) + AES-256-GCM, random 16-byte salt / 12-byte nonce,
    AAD binds context, serverId, publicKey and every KDF/cipher parameter. Import bounds: N power of two in [2^14, 2^20], r=8,
    p in 1..4, exact base64 lengths, strict fields, 16 KiB cap. Passphrase NFKC, 12 chars..256 bytes (`WEAK_PASSPHRASE`).
    Errors: `BACKUP_AUTH` (wrong passphrase or any tampering; deliberately indistinguishable), `BACKUP_INVALID`,
    `BACKUP_UNSUPPORTED` (version), `KEY_MISMATCH` (other server / derived key != header), `KEY_EXISTS` (different key present
    and `replace` not set). Same-key restore is idempotent. Restore keeps the store's existing sequence high-water mark.
- Sequence: `reserveSequence(serverId, floor) = max(stored, project.sequence) + 1`, persisted BEFORE the writer runs. Choice: a
  failed or cancelled build burns its number (gap is harmless; launcher only needs strictly increasing); a number is never issued
  twice. The value is also written to the project (`StudioProject.sequence`, optional, >= 1, strict) and marks it dirty. Because the
  key store keeps a high-water mark too, deleting outputs or losing/resetting the project file cannot lower it; a project carrying a
  higher value (restored key on a new machine) wins. `update` from the renderer cannot change `sequence`.
- Build: when a key store is injected, the key is auto-created if missing (reported), the sequence reserved, and
  `writeDeployment({sequence, sign: createEd25519Signer(key)})` writes format 1.2. Result text states `sequence N` and
  "새 서명 키 생성" when a key was created; `state.signing.lastOperation = {keyCreated, sequence}`.
- Export: key auto-created if missing (explicit in result and `lastOperation`), `signing {algorithm:'ed25519', publicKey}` written to
  `torchlauncher-server.json` (parsed by `parseServerConfig`); branding sidecar and `game` unchanged. Legacy projects (no `sequence`,
  no key) open unchanged and get a key plus sequence 1 on the next build/export.
- IPC/shared (`StudioRequest`): `keyStatus`, `keyCreate`, `keyExport {passphrase}`, `keyImport {passphrase, replace}`; file paths come
  from native dialogs (`keybackup` kind added to `StudioDialogs.open/save` and to `index.ts`), never from the renderer. Strict field
  validation; sender validation is the existing `handleStudioRequest`. `StudioState.signing` =
  `{encryptionAvailable, keyExists, publicKey, lastSequence, lastOperation}` (no private key, no passphrase, never logged).
  New `StudioError` codes: ENCRYPTION_UNAVAILABLE, KEY_EXISTS, KEY_MISSING, KEY_CORRUPT, KEY_MISMATCH, WEAK_PASSPHRASE,
  BACKUP_INVALID, BACKUP_UNSUPPORTED, BACKUP_AUTH. `index.ts` wires `SigningKeyStore(userData/signing-keys, safeStorage)`.

## Deviations / things to review
1. **Renderer touched minimally**: `apps/admin/src/renderer/src/hooks/useStudio.ts` has `Record<StudioError,string>`; the new codes
   forced nine message strings to keep typecheck green. No screens/UI were added. Safe to drop when the UI is rewritten, as long as
   the map covers the codes.
2. `StudioService` takes the key store as an optional 4th constructor argument; without it (existing tests only) builds/exports stay
   unsigned. `index.ts` always injects it, so shipped Studio always signs.
3. `check` (verify) still opens the public pack without `trustedPublicKey`; a signed pack reports unverified there. Wiring the key into
   the check is a small follow-up if wanted (a pre-existing unsigned pack would then fail the check until redeployed).
4. Export order: the public-pack check runs first, then key creation, then config write; a key created by a failed export persists
   (reported only on success). Losing a key requires a new key and re-exported launcher (UI warning text is for the UI rewrite).
5. `scripts/smoke.mjs` needed no change (bridge keys unchanged: `request`, `getApplicationInfo`).

## Validation (WSL, this worktree)
- `pnpm check` exit 0 (Biome, typecheck, Vitest 78 files / 1137 tests passed, 9 skipped, both app builds).
- `node scripts/smoke.mjs` passed (launcher and Studio); `node apps/admin/scripts/branding-smoke.mjs` passed.
- New `apps/admin/src/main/signing.test.ts` (13 tests): fake safeStorage incl. unavailable/basic_text/throwing, raw-private-bytes scan
  (seed, DER, hex, base64) of key store, project file, deploy output, source dir, backup file and state; backup round trip, wrong
  passphrase, bit flips in every field, header substitution, version/format/parameter bounds; sequence monotonic across deletion,
  failed build, lost project sequence and restored higher sequence; signed pack verifies with derived key and fails with another;
  exported config parses with `signing`; legacy project upgrade; key command validation and service-level export/import.
- NOT exercised: real Electron `safeStorage` (Windows DPAPI / Linux keyring), native dialogs for the key backup, packaged apps,
  Windows. The fake storage is AES-GCM based and only tests the interface contract.
