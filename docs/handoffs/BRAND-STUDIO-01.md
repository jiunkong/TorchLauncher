# BRAND-STUDIO-01 — Studio branding functions, UI deferred

2026-10-23. Worker #2 `studio_branding`, requested Sol medium (actual runtime model/effort not independently verified).
Worktree `.agents/worktrees/agent-2`, branch `feat/studio-branding-functions`, baseline `907f7d7`.
Implementation commit: obtain with `git log -1 --format=%H -- docs/handoffs/BRAND-STUDIO-01.md`.
No merge or integration performed. #0 owns review/integration/full workspace validation.

## Implemented and downstream UI API

No renderer/UI files changed. Existing preload request transport and trusted sender/frame checks are reused.
`apps/admin/src/shared/studio.ts` exports `StudioBrandingCommand` and `StudioRequest`:

```ts
await window.torchlauncher.request({ action: 'brandingSelect', role: 'icon' });
await window.torchlauncher.request({ action: 'brandingSelect', role: 'background' });
await window.torchlauncher.request({ action: 'brandingRemove', role: 'background' });
await window.torchlauncher.request({ action: 'brandingName', appName: '운영자 런처' });
await window.torchlauncher.request({ action: 'brandingName', appName: null });
```

- `brandingSelect` opens a native main-process file dialog. The renderer supplies only a closed role, never paths/URLs/bytes.
  PNG icon ≤1MiB/512×512; PNG/JPEG background ≤8MiB/3840×2160 and core pixel limits. Both header inspection and
  actual Electron `nativeImage` decode/`toBitmap()` size agreement must succeed. Failed/cancelled imports preserve selection.
- `brandingRemove` records explicit `null`, so the next pack instructs the runtime to use its default image.
- `brandingName` uses the core profile appName rule; `null` or empty string removes the override. The app name is profile-only,
  never remote metadata. No exe, identity, user-data path, startup logo or authentication behavior changes.
- Public `StudioProject.branding` contains optional `appName`, and optional icon/background metadata
  `{sha256,length,mediaType}` or `null`. `StudioState` contains no image bytes/base64/source paths. Existing `update`
  must preserve the complete branding summary; mutations require dedicated commands. Existing UI spreads preserve it.
- `StudioCommand` retains the existing UI button union. `StudioRequest = StudioCommand | StudioBrandingCommand`
  is accepted by `StudioApi.request`. New dialog text is collected in `brandingDialogText` for future UI reuse.
- All new commands have exact argument schemas and existing safe error codes. Normal busy/cancel/close serialization applies.
  The optional third `StudioService` constructor dependency is a synchronous `ImageDecoder`; production injects the native
  implementation. Omission fails closed for image import/open while preserving unbranded service compatibility.

## Durable snapshots and output

Approved by #0 before major edits: project v1 JSON gains optional branding; non-null disk descriptors contain an additional
canonical `base64` snapshot. Public summary parser and stored snapshot decoder are separate. Project read limit is 20MiB;
encoded roles are bounded before allocation, then length/hash/magic/header/dimensions/native pixels are checked.
A successful open atomically replaces project plus private snapshot map only after all roles validate. Legacy project JSON
remains readable; source-root selection still must be repeated after reopening. Save/Save As persists snapshots without
reading original image paths. Images remain private bytes in the main service between commands.

The same selected bytes feed core writer inputs and folder export, even after original source replacement. Image roles
stay outside game `files`. Untouched/unbranded and appName-only projects emit existing v1.0 packs; specified image or null
roles emit v1.1. Unspecified roles retain legacy remote behavior. Export checks remote server/game plus every specified
role's hash/original length/media type or explicit null; a stale pack produces `MISMATCH` before output writes.

Folder export copies the original binary unchanged, writes role bytes to fixed `branding/icon.png` and
`branding/background.png` or `.jpg`, and records matching local path/hash/length/type plus appName in server JSON.
Null roles produce no shipped sidecar. Export preflights fixed paths and snapshot length/hash before writing, requires
an empty output directory, creates entries exclusively, and checks resulting identities. On failure it removes only
entries whose inode/device and safe ancestry still match, including the created branding directory only when empty.
A replaced directory or foreign entry is retained. ZIP generation remains deferred.

`safeRead` now rejects symlink parents/targets and hardlinks, captures ancestor and target device/inode identities before
open, compares the opened handle, reads at most the bounded file size plus one detection byte, and rechecks ancestry,
handle size/mtime/ctime/nlink, and current target identity. These are portable filesystem checks, not a guarantee against
an adversarial OS changing entries between individual syscalls.

## Validation

Node `v24.21.0`, pnpm `10.34.7` (existing own worktree dependencies; no dependency install/change).
Commands run from this worker checkout with `/tmp/torchlauncher-tools/node_modules/.bin` added to PATH:

- `pnpm exec biome check --write apps/admin/src/main apps/admin/src/shared apps/admin/scripts/branding-smoke.mjs` — passed.
- `pnpm exec vitest run apps/admin/src/main` — 3 files / 20 tests passed.
- `pnpm --filter @torchlauncher/studio typecheck` — node and web passed, including unchanged renderer compatibility.
- `pnpm --filter @torchlauncher/studio build` — main/preload/renderer production build passed.
- `node apps/admin/scripts/branding-smoke.mjs` — actual Linux Electron passed: native generated PNG and JPEG,
  icon JPEG rejection, truncated PNG rejection, service selection/save/reopen, failed import preserves state.
  Probe bundles production modules with existing Vite, uses only temp fixtures and temp userData/sessionData, and exits.
- `git diff --check` — passed.

New tests cover legacy/appName-only output, both role snapshots, explicit removal and remote mismatch, strict arguments,
invalid names/forged update, bounded/corrupt/noncanonical snapshots, decoder failure/dimension mismatch, source replacement,
actual core writer/staging plus sidecar JSON/hash equality, cancel preservation, hardlinks/parent symlinks,
late export abort cleanup, fixed-path/hash preflight, and replacing the branding directory during failure cleanup.
Existing main/project/IPC tests remain unchanged and passing.

An initial smoke harness used top-level await for Electron readiness and timed out (tool harness defect, corrected to
whenReady callback). One earlier passing run emitted a read-only Electron GPU cache diagnostic; the final probe now
isolates userData/sessionData in its temp root. No real files, credentials, private URLs or remote servers were used.

## Pending / limitations / resume

UI selection/removal/name controls and previews are intentionally not implemented. There is no preview image transfer API;
future UI can consume summary fields and these commands, and a bounded preview channel can be designed separately if needed.
No launcher/core changes, dependencies, root settings, ZIP packaging, Windows native evidence or actual public upload.
Full integrated `pnpm check` and Windows native dialogs/reparse behavior remain #0/user validation work.
No task processes remain after the recorded checks. No user action is required to review/integrate this commit.
