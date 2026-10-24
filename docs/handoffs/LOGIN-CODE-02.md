# LOGIN-CODE-02 (launcher device-code modal and shared helper)

Worker agent-1, branch `feat/login-code-launcher` (main with the Studio change from STUDIO-LOGIN-01).

## Change
- `packages/desktop-auth/src/device-code.ts`: `DeviceCodePresenter` (no Electron imports): validates the code format (`HostAuthenticationError('browser_failed')` otherwise), holds the one pending code, notifies subscribers, opens the fixed `https://www.microsoft.com/link` through an injected opener, waits for the abort signal, clears in `finally` (only its own code), `copy()` through an injected clipboard (false without a code). Exported from the package index; unit tests in `device-code.test.ts`.
- Studio (`apps/admin/src/main/test-auth.ts`) now uses it and mirrors `presenter.code` into the runner state (`setLoginCode`); merged Studio behaviour and tests unchanged.
- Launcher main: `public-java-electron.ts` has no BrowserWindow any more; `loginDeviceCode` (shell.openExternal, clipboard.writeText) backs `showCode`. `ProductHost.deviceCode` mirrors the code into `ProductState.loginCode?: string` (present only while a login waits; cleared on success, cancel, failure, logout, quit; never in logs). New no-payload product command `copy-login-code` (exact-field validated by `parseProductCommand`, trusted frame via the existing handler, not an operation so it works while login is pending; `invalid-request` without a code).
- Launcher renderer: `LoginCodeDialog` using the existing `Modal`, tokens and ko/en catalog: title 로그인, large code with aria-label, spinner + 로그인을 기다리는 중, 코드 복사 with a small confirmation, 취소 = the existing `cancel` command; Esc cancels; the app shell is inert behind it. `useProduct` lets `copy-login-code` bypass the in-flight guard like `open-logs`.
- The security note of STUDIO-LOGIN-01 applies: the short-lived user code now crosses IPC (to the trusted frame only), tokens and auth results do not.

## Validation (WSL2, DISPLAY=:0)
`pnpm check` exit 0 (lint 0 errors, 39 warnings; 102 test files / 1428 tests passed, 4 files / 9 tests skipped); `pnpm build` ok; `node scripts/smoke.mjs` both apps pass; `node apps/admin/scripts/smoke-functional.mjs` pass; launcher `renderer-functional-smoke.mjs` pass (modal absent normally, one BrowserWindow, injected `loginCode` state shows the dialog and clearing it closes it, copy rejected without a code); launcher `branding-smoke.mjs` pass. `scripts/smoke.mjs` bridge lists unchanged (the command uses the existing channel).
New tests: helper (7), launcher service/IPC (state mirroring and clearing, copy only while a code waits, exact-field parsing), launcher renderer (dialog markup, wiring).

## Real Microsoft login: 미실행. Manual checks
Launcher: 1) run the launcher with a real server config, press the login button on Home. 2) The browser opens https://www.microsoft.com/link and the launcher shows the 로그인 modal with the code and no extra window. 3) 코드 복사 and paste in the Microsoft page: "코드를 복사했습니다" appears. 4) Finish sign-in: the modal closes and the account shows. 5) Repeat and press 취소 or Esc: the modal closes, no stuck state. 6) Repeat and quit the app during the wait: no leftover window/process.
Studio: as in STUDIO-LOGIN-01 (테스트 실행 > Microsoft로 로그인, same steps).
