# STUDIO-POLISH-01 handoff

Worker agent-1, branch `polish/studio-ui-fidelity` (from main a00c001). Scope: `apps/admin/src/renderer/**`, `apps/admin/scripts/smoke-functional.mjs`, this file. No main/shared/preload/core or root `scripts/smoke.mjs` change.

## Items (before -> after)
| # | Before | After | Status |
| --- | --- | --- | --- |
| 1 Sidebar | scrollbar at 1100x800, top cut | compact card/menu/footer (12px padding, 6px gaps, 38px items, `.mg` captions, 28px footer buttons); smoke asserts `scrollHeight == clientHeight`, top and foot visible at 1100x800; at 580px height it scrolls (`overflow-y: auto`) | done |
| 2 Stale message | banner stayed on every page | navigation clears the command message (`App` `setPage`); background reads (`settingsTestConfigs` on entering 모드 설정, options imports) are `quiet` and report through `lastRun`/in-page notes only; smoke checks | done |
| 3 Icons | shared icons | sliders / layers / sun / keyboard / box / play added; smoke asserts all menu icons are distinct; player-settings test card uses play | done |
| 4 Import bar | wrapped toggle, big red button | one `.preset` row: `.seg` toggle, summary + source, [테스트 실행] and plain [다시 가져오기]; empty state is the two mockup cards (play / file icons, status line, primary 테스트 실행으로 이동) | done (summary shows counts and source name; the API gives no file path) |
| 5 모드 설정 | one list | two panes: file list (unsupported formats dimmed with `지원 안 함` chip from `configPreview.skippedConfigs`) and the selected file's items with search, `전체 해제`, 3-state controls; wiring unchanged | done (unsupported rows covered by unit test; the smoke fixture has no test-run preview) |
| 6 Test start | single card, sentences, floating login | `테스트 환경` kv card + `계정` card (login/logout inside), primary `테스트 실행` bottom-left; prerequisite sentences are only the disabled button's `title`; reset is a small ghost button in the environment card (small row after done/failed) | done; mockup row "테스트 폴더" replaced by "소스 폴더" (no instance path in state) |
| 7 Code | one 970-line switch | `pages/settings/{PlayerSettingsPage,ModSettingsPage,PackSettingsPage,ShaderSettingsPage,shared}`; `hooks/errors.ts` is the single detail-code mapping (useStudio + player import); `managedPage()` replaces the nested ternary in FilesPage | done |
| 8 Tests | - | `TestPage.test.ts` (start signed out / in / no source, preparing, running only log + stop, result problems, no-problems sentence, failed, stop/reset only via the in-app Modal), `settings/settings.test.ts` (player empty/loaded, mod panes, unsupported), `hooks/errors.test.ts`, `filePaths.test.ts` | done / partly: no DOM library is allowed, so "no command on click" is a source-structure test (open handlers only call `setConfirm`; `testReset`/`testStop` appear once, inside the Modal confirm) plus a render test that sends no command |

Running view: header pill, one log card, `종료` button (no progress card). Other phases unchanged.

## Validation (WSL2, DISPLAY=:0)
`pnpm check` exit 0 (lint 0 errors, 39 warnings; 99 test files / 1411 tests passed, 4 files / 9 tests skipped); `pnpm build` ok; `node scripts/smoke.mjs` both apps pass; `node apps/admin/scripts/smoke-functional.mjs` passes. Smoke cleanup now races `app.close()` with a 5 s kill, so a failing step reports its error instead of hanging.

## Screenshots (`.cache/smoke/`, not committed)
1100px: `studio-1100-모드설정.png`, `-리소스팩`, `-셰이더`, `-테스트실행`, `-단축키·옵션`, `-파일`, `-개요`, `-서버정보`, `-브랜딩`, `-배포`, `-내보내기`; focused: `studio-polish-mods.png`, `studio-polish-player-settings.png`, `studio-polish-test-start.png`. (`studio-1100-게임설정.png` is a stale file from an older run.)

## Not done / notes
Running timer, preparing step list and the other Test* mockups (login dialog, result cards) were out of the listed scope and are unchanged. The test run still has no instance path to show.
