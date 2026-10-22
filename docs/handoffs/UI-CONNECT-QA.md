# UI-CONNECT-QA handoff

- Session: launcher develop #2 (UI-CONNECT-QA)
- Branch/worktree: `test/ui-connect-smoke`, `.agents/worktrees/agent-2`
- Baseline: `9f83908` (`docs: record active delegated UI integration`)
- Scope: `scripts/smoke.mjs` and this handoff only

Updated the Electron smoke script for the current app contracts. It checks the exact launcher and Studio bridge surfaces, renderer isolation, app info and navigation. Launcher starts with a temporary valid server config via `TORCH_SERVER_CONFIG`; smoke reads state and verifies the launch gate without invoking status, authentication, synchronization, or game actions. Studio state and malformed request validation are exercised through IPC, then the UI creates a project and saves it to a temporary path through a stubbed native save dialog. Studio's message dialog is stubbed for clean shutdown. Both apps retain 760px screenshots and checks and add 1100px layout assertions/screenshots. The fixture URL is `example.invalid`; no live server or account is used.

Validation run:

- `node --check scripts/smoke.mjs` — passed.
- `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH pnpm exec biome check scripts/smoke.mjs` — passed.
- `git diff --check` — passed.
- Electron smoke was not run in this worker, per coordinator instruction to run it after integration.

Integrated behavior, screenshot output, and renderer/main compatibility remain pending #0's integrated smoke run.
