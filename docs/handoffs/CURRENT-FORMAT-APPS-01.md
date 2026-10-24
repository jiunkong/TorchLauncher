# CURRENT-FORMAT-APPS-01

Worker: launcher develop #2 / current_formats_apps. Branch `feat/current-formats-apps`, worktree `.agents/worktrees/agent-2`. Baseline updated from `66ed90b` to integrated main `79055d7`. Scope: `apps/**`, `scripts/**`, this handoff only. No packages, manifests, lockfile, shared specifications, or progress tracker edits.

## Implemented

- Launcher always passes the configured Ed25519 public key, requires a verified reader, checks rollback state before staging, and records sequence after successful application. Removed unsigned profile/runtime bypasses and obsolete signature-required UI mappings.
- StudioService requires a SigningKeyStore dependency. Every build reserves a sequence and signs; unavailable secure storage still rejects the build without unsigned output. Tests inject isolated real signing stores with test-only reversible storage.
- Studio URL checks validate current identity/source fields and verify the remote deployment with the project's existing public key. Export cannot bless a historical/unsigned container or a mismatched signature.
- Current project validation uses shared narrow identity/branding parsers, current synthetic torchpack 1.2 index fields, and numeric last-build sequence. Unbuilt projects may legitimately lack a sequence; optional memory, ordinary options.txt payloads and third-party Minecraft formats remain valid.
- Updated app/server profile fixtures and root/app scripts for required signing. Replaced legacy export-upgrade coverage with verified export, tampered signature, and historical 1.0/1.1 header rejection. The real game smoke launch mode requires `--signing-public-key`; install-only mode does not.
- Current result contracts require a numeric build sequence and literal `signed: true`; renderer always shows the signed sequence. Removed obsolete historical-format comments/branches and renamed close-only preferences coverage to reflect current optional settings.

## Validation

Environment: Node v24.21.0, Corepack pnpm 10.34.7, Linux/WSL, DISPLAY=:0. No credentials or private URLs were used.

- `corepack pnpm exec vitest run apps/admin apps/launcher --reporter=dot`: 61 files, 442 tests passed. `/tmp/current-app-integrated-tests.log`.
- Final affected followup: deployment-trust, launch, bootstrap, signing suites: 4 files, 36 tests passed. `/tmp/current-app-focused-final.log`.
- Both app TypeScript checks passed: `/tmp/current-app-types-final.log`.
- Both app builds passed: `/tmp/current-app-build.log`.
- Biome apps/scripts passed with existing 43 warnings and 2 infos; `git diff --check` passed. `/tmp/current-app-lint-final.log`.
- Root two-app Electron smoke passed; Studio functional smoke, launcher functional smoke and Studio native branding smoke passed. Logs `/tmp/current-app-smoke.log`, `/tmp/current-studio-smoke.log`, `/tmp/current-launcher-smoke.log`, `/tmp/current-studio-branding-smoke.log`.
- Launcher branding smoke followup status recorded below before commit.

Initial typecheck was started while the baseline fast-forward was still applying; its missing-export/old-core diagnostics were environment ordering, then the final check passed. No full workspace check was run by this worker; #0 owns integrated verification. No real Microsoft login, game launch, target Windows/native portable package or live hosting replacement was executed.

Launcher branding smoke passed after two fixture fixes: explicit Korean Electron startup language for its Korean selectors (both initial/restart), and awaiting resize plus centering the copy control before measuring toast/path overlap. The overlap assertion is retained and validates the centered target only. The original 760px minimal-scroll placement near the viewport bottom can be overlaid by the toast; no product UI fix is included, and this is a separate known limitation rather than a format regression. Log `/tmp/current-launcher-branding-smoke.log`.

Final baseline is `79055d7`; branch has no pending required app validation. No task processes remain running. #0 should review the worker commit, integrate, then run its full workspace check. No pending user action is required. Temporary logs, test keys and build outputs are environment-specific and must not be treated as portable release validation.
