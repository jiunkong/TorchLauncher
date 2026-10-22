# SIGN-CORE-01 — signed container 1.2, signing key config, rollback decision

2026-10-23. Worker `agent-2`, branch `feat/sign-core`, worktree `.agents/worktrees/agent-2`, baseline `22da36e`.
Implementation commit: `git log -1 --format=%H -- docs/handoffs/SIGN-CORE-01.md`. Not merged or integrated.
Scope kept: `packages/core/src/deployment/**`, `packages/core/src/server-config/**`, `docs/deployment-format.md`, this file.

## Implemented
- Contracts: minor 2 (`DEPLOYMENT_SIGNED_FORMAT_VERSION`), `DEPLOYMENT_SIGNATURE_LENGTH=64`, `DEPLOYMENT_SIGNATURE_CONTEXT`,
  `deploymentIndexStart(minor)` / `deploymentPayloadStart(header)` (payload = 128+indexLength+offset for 1.2). Header totalLength must
  cover the signature. Index: `sequence` required (safe integer >= 1) in 1.2, rejected as unknown field in 1.0/1.1; `branding` rules of
  1.1 apply to 1.2 (field required; writer emits `{}` for a signed deployment without branding input). Reader accepts exactly 1.0/1.1/1.2.
- `deployment/signing/`: `decideRollback`, `deploymentSignatureMessage`, `verifyDeploymentSignature`, `importEd25519PublicKey`,
  `decodeEd25519PublicKey`, `deriveEd25519PublicKey(privateKey)`, `createEd25519Signer(privateKey)` (Studio helpers, trivial), and
  dependency-free `key-text.ts` (`isEd25519PublicKeyText`) so renderer-visible `server-config` never imports `node:crypto`.
- Writer: `sequence` + `sign(message)` (both or neither). Message = `"TORCHPACK-SIG-v1\0" || header(64)`. Signature length != 64 ->
  `DeploymentWriteError('invalid-signature')`; signer errors propagate; no output on failure.
- Reader: `trustedPublicKey` option; order header -> signature -> index -> SHA-256 -> verify -> parse. Unsigned 1.0/1.1 with a key ->
  `signature-required` right after the header (no index request). New codes: `signature-required`, `signature-invalid`,
  `signature-malformed`, `invalid-signing-key` (thrown before any request). `reader.verification`: `verified | unverified | unsigned`.
- server-config: optional strict `signing {algorithm:'ed25519', publicKey}`; `ServerConfigSigning` type.

## Decisions and deviations to review
1. **Bad signature and wrong key are one code (`signature-invalid`).** Ed25519 verification returns only true/false and the spec has
   no key id, so they cannot be told apart without a format change.
2. **1.2 with no key configured** is opened and flagged `verification: 'unverified'` (staging allowed, nothing authenticated). The
   launcher must pass the key whenever the config has `signing`, and must not treat `unverified` as trusted.
3. `verification` is declared **optional** on `BrandingDeploymentReader` (always set by `openDeploymentReader`) because
   `apps/launcher/.../branding.test.ts` casts mock readers to that type; a required field broke app typecheck. The launcher task may tighten it.
4. Header-field tampering that breaks the header decodes to `invalid-header` / `index-hash-mismatch` before signature verification;
   only a self-consistent header+index swap reaches `signature-invalid`. All reject before any file is requested.
5. Payload bytes are not signed; they are covered by the signed index's file hashes (tested: opens, `stageFile` -> `file-hash-mismatch`).
6. Updated one obsolete test expectation (`validation.test.ts` listed minor 2 as unsupported; now minor 3).
7. No package exports/root exports were added (out of scope); apps import via relative/`packages/core/src` paths as today.

## Validation (in this worktree, WSL)
- `pnpm exec vitest run packages/core`: 38 files passed, 799 tests passed, 9 skipped (pre-existing skips).
- `pnpm check` (Biome, typecheck all workspaces, Vitest, both app builds): exit 0; 75 files / 1119 tests passed, 9 skipped.
  Biome reports only pre-existing CSS warnings in apps.
- New adversarial tests: `deployment/signing/signing.test.ts` (round trip with/without branding, byte-exact HTTP range plan with the
  128-byte offset, every header/signature/index byte flip, payload tamper, truncation at every boundary, trailing byte, other-key
  signature, index swap with recomputed hash, downgrade to 1.0/1.1, unsigned with/without key, malformed keys, serverId mismatch,
  sequence rules, writer input rules, rollback matrix) and `server-config/index.test.ts` (signing block).
- Not run: Windows, real Drive, packaged apps, `pnpm smoke`.

## For SIGN-STUDIO-01 / SIGN-LAUNCHER-01
- Studio: pass `sign: createEd25519Signer(key)` and incremented `sequence`; write `signing` into the exported server config using
  `deriveEd25519PublicKey`.
- Launcher: pass `trustedPublicKey: config.signing.publicKey`; build `{sequence: index.sequence, deploymentId, indexSha256: header.indexSha256}`
  and call `decideRollback` before applying; persist only after a successful apply. Map the new reader codes to status/i18n.
