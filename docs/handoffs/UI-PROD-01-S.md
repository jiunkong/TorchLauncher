# UI-PROD-01 Studio handoff

Task: Studio functional workflow (`UI-PROD-01`)
Worker: `launcher develop #1` / Codex
Branch/worktree: `feat/ui-prod-studio-flow` / `.agents/worktrees/agent-1`
Baseline: `01041c5`

Implemented the Studio project flow as navigable steps: server and game setup, source/files/policies and torchpack generation, then public URL entry/check and launcher folder export. The URL is optional through project creation and pack generation. Server name/address and game/loader version errors appear beside their fields; URL checks and export enable only after the exact existing server-config parser accepts the URL. Invalid drafts remain editable, and new/open/cancel actions remain available after failures. The overview links directly to each stage and reports readiness without claiming an upload or check succeeded. Operation labels distinguish selection, saving, building, checking and exporting; byte counts appear only for pack generation and binary copying. Duplicate renderer actions are locked while an action is pending.

Updated the shared Electron smoke navigation labels for the Studio export page and launcher troubleshooting page. The launcher logged-out CTA check now waits until it is enabled after startup restoration. The smoke hosts a temporary loopback TCP listener on an ephemeral port and closes each status connection, so startup status checks never contact a user server or the network.

Validation in this worktree:

- `pnpm exec biome check apps/admin/src/renderer/src apps/admin/scripts/smoke-functional.mjs scripts/smoke.mjs` — passed.
- `pnpm exec vitest run apps/admin/src/main/studio.test.ts apps/admin/src/renderer/src/pages/Pages.test.ts` — 15 passed.
- `pnpm --filter @torchlauncher/studio typecheck` — passed.
- `pnpm --filter @torchlauncher/studio build` — passed.
- `node --check apps/admin/scripts/smoke-functional.mjs` and `node --check scripts/smoke.mjs` — passed.
- `git diff --check` — passed.
- Electron functional smoke was attempted, but this worktree has no Electron executable; Playwright waited during runtime startup and the command was stopped. Run `node apps/admin/scripts/smoke-functional.mjs` and root `node scripts/smoke.mjs` with #0's available Electron executable during integrated validation.

Follow-up smoke change for the launcher startup status query: root smoke uses the temporary local TCP fixture described above and accepts `unknown`, `online`, or `unavailable` while the one-shot query settles. It tracks accepted sockets and destroys any that remain in `finally` before closing the listener, so cleanup cannot wait for a peer to consume the half-closed connection. No real server status is treated as verified.

Implemented and locally checked; not integrated. Windows native validation and integrated 760/1100px Electron smoke remain pending with #0. No server URL, account, or server connection was used.
