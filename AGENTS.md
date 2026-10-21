# Repository Guidelines

## Project Status & Architecture

TorchLauncher is a server-specific Minecraft launcher built with Electron, TypeScript, and React. The pnpm monorepo contains independent player and Studio apps with shared contracts. Support Windows, macOS, and Linux, with both Fabric and NeoForge; validate Minecraft 1.21.1 first. Product features remain planned; the initial desktop shells are implemented.

## Agent Coordination & Merge Ownership

The user-designated **#0 agent** (currently `launcher develop #0`) is the project coordinator. Other sessions act as implementation workers unless the user changes their role.

#0 manages planning, documentation, review, Git integration, and integrated validation; product implementation belongs to other sessions. Read `docs/work-distribution.md` for assignments. Shared-file implementation must be assigned to one worker rather than implemented by #0.

- Only #0 updates `docs/progress.md`, assigns tasks and exclusive file scopes, and records integration results.
- Only #0 integrates work into `main` or another designated integration branch, including merges, cherry-picks, integration conflict resolution, and completion decisions.
- Workers use separate branches/worktrees, commit their assigned changes, and report their session name, task ID, commit, and validation in a PR or `docs/handoffs/<task-ID>.md`. They do not edit the tracker or integrate their own work into the integration branch.
- Workers may update their own branches from the integration baseline. Shared configuration, manifests, lockfile, exports, and IPC changes must be coordinated with #0.
- #0 reviews handoffs, integrates in dependency order, and marks tasks complete only after integrated verification.

## Resuming in Another Tool

These repository rules apply equally to Codex, Claude Code, and other development tools. Chat history,
session IDs, model names, and tool-specific messaging are not required to resume the work.

- Start by reading this file, `docs/progress.md`, `docs/work-distribution.md`, and the latest
  `docs/tool-handoff.md` if present. Then read the relevant specifications and `docs/handoffs/` reports.
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
- `mods/`: planned Fabric and NeoForge companions; no Java build exists yet.
- `docs/`: architecture and deployment specifications.

Keep tests beside their modules as `*.test.ts`; place reusable fixtures in dedicated `fixtures/` directories. Store bundled images with their owning application.

## Build, Test, and Development Commands

Use Node.js 24 and pnpm 10.34.7 with the committed lockfile.

- `pnpm install --frozen-lockfile`: install workspace dependencies.
- `pnpm dev:launcher` / `pnpm dev:studio`: run either application.
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
