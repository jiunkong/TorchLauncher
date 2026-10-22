# BRAND-ICON-01 handoff

Worker #1 implemented shared native icons on branch `feat/app-icon` in
`.agents/worktrees/agent-1`, based on `12263e9`. The root `icon.ico` supplied by the user
remains untouched and untracked in the coordinator checkout. Its exact bytes are copied to
`assets/branding/icon.ico`; the existing 256x256 PNG entry is extracted byte-for-byte to
`assets/branding/icon.png`.

Both applications now use the PNG in their BrowserWindow configuration. Development resolves it
from the app root to the repository's shared asset; packaged apps resolve it under
`process.resourcesPath/branding/icon.png`. The shared electron-builder config embeds the PNG as an
extra resource, uses the ICO for Windows executables, and uses the PNG for Linux packages.

Validation on Linux/WSL:

- `pnpm exec biome check electron-builder.base.cjs apps/launcher/src/main/index.ts apps/admin/src/main/index.ts` passed.
- Studio typecheck and production build passed.
- Launcher typecheck and build could not complete because this worktree lacks the existing
  `prismarine-auth` dependency (`TS2307` and unresolved Vite import); this is an environment
  dependency issue, not an icon-related source error.
- `pnpm --filter @torchlauncher/studio package:dir` passed. The generated
  `apps/admin/dist/linux-unpacked/resources/branding/icon.png` exists and is the same 29,930-byte
  PNG source.
- Both app-relative builder resource/icon paths resolve to existing files. `file` identified the
  ICO as six entries up to 256x256 and the extracted PNG as RGBA 256x256. SHA-256 for the supplied
  ICO and committed copy matched: `6fdf5f071bf883186afbafbf7801530cae34a7ba57011331abd77a5cf786ed8f`.

Windows executable packaging/native Windows display were not tested. No GUI smoke was requested.
