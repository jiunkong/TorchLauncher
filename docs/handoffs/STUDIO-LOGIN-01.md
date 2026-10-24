# STUDIO-LOGIN-01

Worker agent-1, branch `feat/login-code-modal` (from main 3145c61).

## Change
- Main (`test-auth.ts`): `showCode` no longer opens a child BrowserWindow. After the unchanged code-format check it publishes the code with `StudioTestRunner.publishLoginCode`, opens `https://www.microsoft.com/link` with `shell.openExternal`, and waits for the signal to abort (finish, cancel, failure, logout, shutdown). The code is cleared in a `finally` there, again in `login()`'s `finally` and on logout; it is never logged. `shared/test-auth-text.ts` and its test were removed.
- Shared: `StudioAccount.login: { code: string } | null` (non-null only while a login waits) and command `{action:'testLoginCopyCode'}` (no payload).
- `testLoginCopyCode`: exact-field validation, trusted sender/frame via the existing IPC handler, allowed while the login command is pending, writes the code with `clipboard.writeText` (new optional `StudioDialogs.copy`, implemented in `index.ts`), `INVALID` when no code is waiting. The renderer never uses `navigator.clipboard`.
- Renderer: `LoginCodeDialog` (in-app Modal like `TestLogin.dc.html`: title, code in large mono text with aria-label, spinner + "로그인을 기다리는 중", `코드 복사` with a small non-blocking "코드를 복사했습니다", `취소` = the page's `run('cancel')`, Esc cancels). It is shown by `App` only while `state.account.login` exists and closes when polling sees the login end. No countdown: the state has no expiry. ko/en catalog keys `login.*`.

## Security note
TESTRUN-MAIN-01 said device codes never cross IPC. That no longer holds for this single user-facing code. It is acceptable because it is the short-lived code the user types into the Microsoft page anyway, it is delivered only to the trusted main frame through the existing validated channel, it exists only while the login waits and is cleared on every end path, and tokens/auth results still never cross IPC or logs.

## Validation (WSL2, DISPLAY=:0)
`pnpm check` exit 0 (lint 0 errors, 39 warnings; 100 test files / 1416 tests passed, 4 files / 9 tests skipped); `pnpm build` ok; `node scripts/smoke.mjs` both apps pass; `node apps/admin/scripts/smoke-functional.mjs` passes (modal absent in normal states, exactly one BrowserWindow, copy command rejected without a login).
New tests: main (`test-run.test.ts`: code only during login, cleared after cancel/success/failure/logout, copy behaviour, extra fields, untrusted sender) and renderer (`LoginCodeDialog.test.ts`: markup, no countdown, shown only with state, cancel/copy wiring).

## Real Microsoft login: 미실행
Manual check: 1) `pnpm dev:studio` on a machine with a secure keyring, open a project. 2) 테스트 실행 > "Microsoft로 로그인": the browser opens https://www.microsoft.com/link and the Studio window shows the modal with the code and no second window. 3) 코드 복사, paste into the Microsoft page: the "코드를 복사했습니다" note appears. 4) Finish sign-in: the modal closes and the account card shows the name. 5) Repeat and press 취소 / Esc: the modal closes, no error banner stays. 6) Repeat and close the app during the wait: no leftover window or process.
