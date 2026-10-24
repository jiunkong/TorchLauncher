# CURRENT-FORMAT-CORE-01

Worker #1 `current_formats_core`, branch `feat/current-formats-core`, worktree
`.agents/worktrees/agent-1`, baseline `66ed90b`. Product scope: packages only. Coordinator
owns integration and active specifications. Implemented and tested; not yet integrated.

- Torchpack accepts/emits only 1.2. Removed the historical branding/signed version constants,
  minor negotiation, unsigned verification state and signature-required error. Use
  `DEPLOYMENT_FORMAT_VERSION` (1.2); `deploymentIndexStart()` takes no arguments (128).
- Index sequence and branding are required. Writer sequence/sign callback are required;
  absent branding defaults to {}. Every output contains a signature block. Reader public key
  remains optional for structural inspection (`unverified`); a supplied key yields `verified`
  only after authentication. Old header minors 0/1 fail as `invalid-header` before any
  signature/index/payload request, preserving the public header error boundary.
- ServerConfig signing is required and validated. Optional game remains the current pre-index
  display hint; optional branding remains a current feature, as agreed with coordinator.
- Removed lock owner v1 parsing/type/evidence. Obsolete owner JSON is invalid unknown input;
  lock inspection remains uncertain/protected and automatic recovery stays blocked. Explicit
  user-confirmed uncertain recovery retains its existing safe boundary.
- Updated deterministic test signer fixtures and all package writer consumers. Corrected
  synthetic sync path-validation indexes and transport payload offsets for the 128-byte prefix.
  Rejection, current signed roundtrip, payload integrity, rollback, cancellation and lock
  protection tests remain exercised.

Audit: no other historical own-format readers or negotiation shims found in packages.
Current version-1 auth session, sync journals/ledgers, user-mod registry, ownership markers,
settings policy and test-instance formats remain current and strict. Minecraft settings-version
profiles, third-party loader/Mojang parsing and optional user settings are legitimate support,
not historical TorchLauncher formats, and remain intact. Branding reader injection interfaces
are retained for current isolated mocks; they do not read historical persisted formats.

Validation on Linux/WSL, Node v24.21.0, local node_modules binaries:

- `node_modules/.bin/vitest run packages/core`: 43 passed files, 4 skipped; 945 passed tests,
  9 skipped; `/tmp/current-formats-core-final.log`.
- `node_modules/.bin/tsc -p packages/core/tsconfig.json --pretty false`: passed;
  `/tmp/current-formats-core-types.log`.
- `node_modules/.bin/biome check --write packages/core`: passed;
  `/tmp/current-formats-core-lint.log`.

The Windows pnpm shim failed with WSL vsock error; used installed local Linux tool binaries.
No root check/build was run, per coordinated scope. No dependencies changed, no live credentials,
URLs, downloads or native Windows validation. No user action pending. No persistent test process.
Next: coordinator reviews/integrates this commit, then apps/script workers consume the current
contracts; coordinator performs integrated workspace validation. Temporary logs/toolchains are
environment-specific and should be regenerated only if needed.
