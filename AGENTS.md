# Repository Guidelines

## Project Status & Architecture

TorchLauncher is a server-specific Minecraft launcher built with Electron, TypeScript, and React. The pnpm monorepo contains independent player and Studio apps with shared contracts. Support Windows and Linux (macOS is deferred by user decision, 2026-10-22; Linux ARM64 is not supported), with both Fabric and NeoForge; validate Minecraft 1.21.1 first. Desktop shells, product UI wiring, loader installation, deployment signing, Studio ZIP export, synchronization and authentication are implemented. Full end-to-end validation of the latest build and native verification remain pending; consult `docs/progress.md` for current evidence.

## Agent Coordination & Merge Ownership

The user-designated **#0 agent** (currently `launcher develop #0`) is the project coordinator. Other sessions act as implementation workers unless the user changes their role.

#0 manages planning, documentation, review, Git integration, and integrated validation; product implementation belongs to other sessions. Read local `docs/work-distribution.md` for assignments when present; otherwise use the coordinator’s explicit assignment. Shared-file implementation must be assigned to one worker rather than implemented by #0.

- Only #0 updates `docs/progress.md`, assigns tasks and exclusive file scopes, and records integration results.
- Only #0 integrates work into `main` or another designated integration branch, including merges, cherry-picks, integration conflict resolution, and completion decisions.
- Workers use separate branches/worktrees, commit their assigned changes, and report their session name, task ID, commit, and validation in a PR or `docs/handoffs/<task-ID>.md`. They do not edit the tracker or integrate their own work into the integration branch.
- Workers may update their own branches from the integration baseline. Shared configuration, manifests, lockfile, exports, and IPC changes must be coordinated with #0.
- #0 reviews handoffs, integrates in dependency order, and marks tasks complete only after integrated verification.

Coordination documents (worker handoffs, assignments, prompts, and tool-switch notes) are local-only
and ignored by Git. Keep them on disk; do not force-add them. Share worker results through a PR or
transfer the relevant local handoff when another checkout or tool needs it. Product specifications
and `docs/progress.md` remain tracked. Shared local copies are available in the coordinator checkout
at `.agents/local-docs/docs/`; workers can read that directory regardless of their branch. Use it when
a worktree copy is absent. Before integrating the tracking removal in another checkout, preserve its
local records and restore them afterward if Git removes the previously tracked copies.
To give a worker only the documents it needs, run
`node scripts/copy-agent-docs.mjs <worktree> <docs-relative-path>...` from any checkout; it copies from
the coordinator checkout's `docs/` into the worker's `docs/`. The copies stay ignored by Git.

## Resuming in Another Tool

These repository rules apply equally to Codex, Claude Code, and other development tools. Chat history,
session IDs, model names, and tool-specific messaging are not required to resume the work.

- Start by reading this file and `docs/progress.md`, then local `docs/work-distribution.md` and
  the latest `docs/tool-handoff.md` when present. Read relevant specifications and available local
  `docs/handoffs/` reports.
- Inspect `git status --short --branch`, `git worktree list`, and recent commits in both the coordinator
  checkout and the assigned worker checkout. Preserve uncommitted and untracked work; never reset,
  clean, or recreate a worktree simply because the previous tool stopped.
- Retain the user-designated coordinator/worker roles and exclusive file scopes. Resuming in a new
  tool does not authorize merging worker work or starting overlapping implementations. If agent
  messaging is unavailable, use repository handoff files and separate terminals/worktrees instead.
- Before a usage limit or tool switch, record the task, role, branch/worktree, baseline/current commit,
  dirty paths, decisions, exact validation results, running processes, pending user actions, blockers,
  and next commands. #0 maintains `docs/tool-handoff.md`; workers update their assigned handoff.
  Distinguish implemented, tested, integrated, and pending work. Do not rely on conversation memory.
- Keep credentials and private URLs out of tracked handoffs. Reference ignored local artifacts or
  environment variable names, and state when an artifact must be regenerated or requested again.
- Treat temporary toolchains, dependencies, process IDs, and old test results as environment-specific.
  Check prerequisites and process state before resuming; rerun only checks affected by new changes or
  unresolved failures. Report usage/tool failures separately from product defects.
- Apply the task-based model policy using the capabilities available in the new tool; Codex-specific
  model names and messaging APIs are examples, not prerequisites for continuing the project.

## Project Structure & Module Organization

Use these module boundaries; applications must not import each other:

- `apps/admin/`: server configuration, branding assets, deployment generation, and portable launcher export.
- `apps/launcher/`: authentication, synchronization, server status, game launch, and user mod management.
- `packages/core/`: shared installation, deployment format, download, and integrity logic.
- `mods/`: contains only a notice that the Fabric and NeoForge companion mod plan was withdrawn (2026-10-21); no Java build exists or is scheduled.
- `docs/`: architecture and deployment specifications.

Keep tests beside their modules as `*.test.ts`; place reusable fixtures in dedicated `fixtures/` directories. Store bundled images with their owning application.

## Build, Test, and Development Commands

Use Node.js 24 and pnpm 10.34.7 with the committed lockfile.

- `pnpm install --frozen-lockfile`: install workspace dependencies.
- `pnpm dev:launcher` / `pnpm dev:studio`: run either application. Renderer dev ports default to 5173/5174; override with `TORCH_LAUNCHER_DEV_PORT` / `TORCH_STUDIO_DEV_PORT` (integer 1024-65535 and not a Chromium-blocked port such as 6000 or 6665-6669; invalid values fail fast; e.g. 6100/6101 if 5173/5174 are in a Windows excluded range).
- `pnpm check`: Biome, TypeScript, Vitest, then both app builds.
- `pnpm format`: apply lint fixes and formatting.
- `pnpm smoke`: build and launch both apps to check IPC and isolation; requires a display or Xvfb.
- `pnpm package:launcher` / `pnpm package:studio`: package for the host OS.

Individual `build`, `typecheck`, `lint`, and `test` scripts are also available. Verify portable packages on each target OS; CI configuration alone is not evidence of successful execution.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, camelCase for functions and variables, and PascalCase for React components and types. Biome enforces formatting and lint rules. Prefer explicit interfaces between applications and shared packages. Expose privileged Electron operations through narrow, validated IPC interfaces.

## Testing Guidelines

Use Vitest for unit tests and Playwright for Electron smoke checks. No coverage threshold is set. Prioritize behavioral tests for byte-range downloads, malformed indexes, hashes, interrupted updates, file ownership, personal settings, and scoped deletion. Add integration checks for both loaders and Drive file-version replacement as those features are implemented.

## Commit & Pull Request Guidelines

Use imperative, scoped messages such as `feat(core): validate range responses`, following the initial workspace commit. Describe behavior, validation, and limitations in pull requests. Link relevant issues and include screenshots for UI changes.

## Configuration & Data Safety

Never commit tokens, credentials, or private configuration. Keep game data in server-specific OS user-data directories. Track user-added mods through the launcher. Adapt public-download logic from gdown with its MIT notice and source commit recorded; do not add Google account integration. Validate paths and hashes before applying remote files.

## Development-Phase Compatibility

Until the first release, backward compatibility is not required (user decision, 2026-10-23). Do not add or keep migration paths, legacy format readers, or version-negotiation shims for earlier project, deployment, or settings-policy formats; change formats directly and update the specs and tests. Revisit this rule before the first public release.

Current format inventory is in `docs/current-formats.md`. Only signed torchpack 1.2 and server configurations with `signing` are supported; keep old-format rejection tests rather than compatibility readers or migration helpers.
