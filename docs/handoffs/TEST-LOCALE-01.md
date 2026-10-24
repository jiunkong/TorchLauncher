# TEST-LOCALE-01 handoff

- Worker: #1, branch `fix/launcher-test-locale`, worktree `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-1`.
- Baseline: `0eb01fd`.
- Scope: made the SSR fixtures in `pages.test.ts` and `shell.test.ts` explicitly select Korean through mocked test-only storage. Each test receives a clean preference and `afterEach` restores the prior `localStorage` global and clears fixture values. Production automatic locale selection was not changed.
- Validation (Node `v24.21.0`, pnpm `10.34.7`):
  - Targeted Vitest without locale override: 2 files, 39 tests passed.
  - `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` targeted Vitest: 2 files, 39 tests passed.
  - `LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8` targeted Vitest: 2 files, 39 tests passed.
  - Targeted Biome on the two tests: clean.
- Limitations: full workspace check and app builds were not run; coordinator owns integrated validation.
- Commit: pending.
