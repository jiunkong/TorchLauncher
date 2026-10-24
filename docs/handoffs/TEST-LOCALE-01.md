# TEST-LOCALE-01 handoff

- Worker: #1, branch `fix/launcher-test-locale`, worktree `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-1`.
- Initial baseline: `0eb01fd`; first commit `4978924` was integrated into main as `562764a`.
- Scope: made the SSR fixtures in `pages.test.ts` and `shell.test.ts` explicitly select Korean through mocked test-only storage. Each test receives a clean preference and `afterEach` restores the prior `localStorage` global and clears fixture values. Production automatic locale selection was not changed.
- Validation (Node `v24.21.0`, pnpm `10.34.7`):
  - Targeted Vitest without locale override: 2 files, 39 tests passed.
  - `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` targeted Vitest: 2 files, 39 tests passed.
  - `LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8` targeted Vitest: 2 files, 39 tests passed.
  - Targeted Biome on the two tests: clean.
- Follow-up: root smoke now launches both apps with `--lang=ko`; launcher functional smoke also sets `--lang=ko`. These are Korean-start smoke scenarios; existing automatic and English language-switch checks remain in place. No product code changed.
- Follow-up validation: targeted Biome on both smoke scripts and `git diff --check` passed. The coordinator will rerun Electron smokes after this commit.
- Limitations: worker did not run Electron smokes or full workspace check; coordinator owns integrated validation.
- Commits: `4978924` initial test fixture change; follow-up pending.
