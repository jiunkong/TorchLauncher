# BRAND-SMOKE-01 — existing smoke bridge alignment

2026-10-23. Worker #1 `branding_contracts` reused; branch `test/branding-smoke-api`,
worktree `.agents/worktrees/agent-1`, baseline `8ebb64d`. #0 assigned only
`scripts/smoke.mjs` and this handoff. Implementation commit is this handoff's adding commit
(`git log -1 --format=%H -- docs/handoffs/BRAND-SMOKE-01.md`). No integration performed.

Updated the launcher's exact ordered bridge whitelist to include getBranding/onBranding,
keeping the existing deep equality assertion. The unbranded fixture now asserts its exact
`{revision:0,appName:'TorchLauncher',icon:null,background:null}` snapshot and that ProductState
has no branding property. Two subscriptions through the public isolated bridge receive a
fixed default test event; after removing one, only the acknowledgement subscription receives
the second event. Both are cleaned up without changing product state or production code.
Studio checks and the rest of the existing smoke remain unchanged.

Validation on Node 24.21.0, pnpm 10.34.7:

- `pnpm exec biome check scripts/smoke.mjs`: passed after formatting, one file, no fixes.
- `node scripts/smoke.mjs`: passed for **TorchLauncher and TorchLauncher Studio**:
  renderer/navigation/IPC/isolation and 760px/1100px layouts. Used existing production out
  bundles, temporary fixture config/userData and local status socket; no private config accessed.
- `git diff --check`: passed. No full check repeated for this test-only alignment.

No product/admin/core/config/dependency/lockfile changes. No processes remain running.
#0 owns review, integration and rerunning the existing script on main.
