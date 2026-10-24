# TESTRUN-UI-01b handoff

## 작업 정보

- 세션/모델: Codex 구현 작업자, GPT-6 기반(정확한 런타임 변형은 도구에서 노출되지 않음). 코디네이터 #0 아님.
- 작업 ID: `TESTRUN-UI-01b` (현재 배정인 TESTRUN-UI-01의 화면 구현 후속으로 식별).
- Worktree / 브랜치: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-1`, `feat/testrun-ui-01b`.
- 기준 커밋: `6dd1ca6` (`main`, TESTRUN-UI-01a 및 STUDIO-SMOKE-01 통합 후).
- 구현 커밋: `82b037b` (`feat(studio): implement test run interface`).
- 인계 문서 커밋: 이 파일을 포함하는 후속 커밋. 정확한 해시는 `git log -1 -- docs/handoffs/TESTRUN-UI-01b.md`로 확인한다. main에는 통합하지 않았다.
- `git diff --stat 6dd1ca6...HEAD`: **8 files changed, 1,282 insertions(+), 14 deletions(-)** (renderer, Studio 기능 smoke 및 이 handoff).
- 기존 미커밋 변경 없이 시작했다. 작업 중 생성된 빌드 출력과 스크린샷은 기존 ignore 규칙 아래 있으며 커밋 범위에 포함하지 않았다.

## 구현

- TESTRUN-UI-01a의 `test` placeholder를 실제 테스트 페이지로 교체했다. 시작 화면에 현재 Minecraft/로더·소스 상태, Microsoft 계정 상태, 로그인, 시작 조건과 버튼을 표시한다. 안전 저장소가 없거나 로그인·소스가 빠지면 해당 이유를 한국어/영어로 안내하고 시작을 막는다.
- 메인 프로세스의 750ms 상태 폴링을 이용해 준비·설치·동기화·실행·분석 단계, 진행 수치, 최대 N줄 로그, 로그 절단 상태를 표시한다. 로그는 끝으로 자동 이동한다. 준비·실행 중 취소/중지 버튼은 인앱 `Modal` 확인을 거쳐 `testStop`을 보낸다.
- `testStart`가 진행 중이어도 `testStop`과 `testLogout` 요청은 renderer 명령 직렬화 잠금의 영향을 받지 않도록 `useStudio.testCommand`를 추가했다. 진행 중 전역 취소는 로그인/준비에 사용할 수 있고, 실제 게임 실행 중에는 우회 취소 버튼을 숨겨 실행 페이지의 종료 확인을 거치게 했다.
- 실패 상태에는 정화된 오류 코드의 i18n 문구, 최근 로그, 재시도와 인스턴스 초기화를 제공한다. 종료 결과에는 호환 보고서(심각도·분류·번역된 요약·모드/파일 ID·근거 줄), 모드 메타데이터와 영향 표시, 설정 추출 요약, 모드 설정 후보로 가는 링크를 표시한다. 분석 코드가 알 수 없는 값이면 원문 코드를 보여주지 않고 일반 오류 번역으로 대체한다.
- “다시 실행”은 결과 카드에, 플레이어 옵션은 플레이어 설정 페이지로 연결했다. `settingsImportOptions`의 기존 출처(`test` 또는 `file`) 선택과 오류 세부 코드 표시는 TESTRUN-MAIN-02/TESTRUN-UI-01a 구현을 그대로 사용한다. 테스트 종료 자체는 프로젝트 설정을 수정하지 않는다.
- 인스턴스 초기화와 게임 종료 확인은 기존 `Modal`만 쓴다. 테스트 리셋 IPC에는 `{action:'testReset', confirmed:true}`만 전송한다. `noNativeDialogs.test.ts`는 변경하지 않았다.
- 문구는 Studio i18n 사전 ko/en에 함께 추가했다. 본문/로그 글꼴은 번들 Pretendard Variable, 워드마크는 기존 Pixelify Sans를 유지하며 외부 글꼴을 추가하지 않았다.

## 공개 계약 / 다음 작업자가 알아야 할 점

- 새 bridge나 IPC 채널은 없다. 렌더러는 기존 `window.torchlauncher.request(...)`만 사용한다.
- 테스트 명령은 메인에서 확정된 계약을 소비한다: `{action:'testLogin'|'testLogout'|'testStart'|'testStop'}`, `{action:'testReset',confirmed:true}`. 장시간 로그인/시작 Promise가 대기 중이어도 App의 `cancel` 및 테스트 페이지의 확인 후 `testStop`은 메인으로 전달된다.
- 테스트 상태는 `StudioState.account` 및 `StudioState.testRun`을 폴링한다. report 요약은 고정 i18n 매핑을 사용한다. 로그·근거는 메인/코어에서 정화된 값만 렌더링한다.
- 플레이어 설정 옵션 가져오기는 기존 `{action:'settingsImportOptions',source:'test'|'file'}` 계약과 `detail.code`의 `NO_TEST_RESULT`/`TEST_OPTIONS_MISSING` 처리를 사용한다. 모드 설정 후보는 기존 `settingsTestConfigs` 경로가 갱신한다.
- `TestLogin.dc.html`의 코드는 TESTRUN-MAIN-01이 제공하는 메인 프로세스 소유의 앱 자식 BrowserWindow에 보인다. renderer에는 로그인 시작과 공용 취소 동작을 연결했다. 따라서 별도 renderer 인라인 코드 모달 시안과 픽셀 단위로 같지는 않다. 그 BrowserWindow의 `system-ui` 글꼴은 메인 소유 파일이며 이 renderer 독점 범위에서 변경하지 않았다. #0이 글꼴 규칙까지 통일하려면 `apps/admin/src/main/test-auth.ts` 및 `apps/admin/src/shared/test-auth-text.ts` 작업 범위를 별도로 조정해야 한다.
- 실제 Microsoft 로그인, 게임 설치/실행, 실모드 분석은 미실행이다. 계정/실게임 수동 확인은 `docs/handoffs/TESTRUN-MAIN-01.md`의 수동 절차를 따른다.

## 검증 (실행 결과)

실행 환경은 Linux/WSL x64, `DISPLAY=:0`, Node 24 / pnpm 10.34.7이다. Electron 실행 파일은 main checkout의 Electron 44.9.1을 `ELECTRON_OVERRIDE_DIST_PATH`로 읽기 전용 사용했다.

- `PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm check`: **exit 0**. Biome 373개 파일, 경고 36개·정보 3개·오류 0개; 타입 검사 4 workspace 통과; Vitest **96개 파일 통과/4개 skip, 1,394개 통과/9개 skip/0 실패**; 런처와 Studio 빌드 통과. 전체 로그 `/tmp/testrun-ui-01b-check-final.log`.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=/mnt/d/Projects/mclauncher/node_modules/electron/dist PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH node apps/admin/scripts/smoke-functional.mjs`: **exit 0**. 테스트 진입 화면, 로그인/시작 비활성 조건(미로그인), 초기화 모달 취소, 페이지 페인트·가로 넘침 없음(760px/1100px), 기존 Studio 기능, 앱 격리를 확인했다.
- 같은 환경의 `node scripts/smoke.mjs`: **exit 0**. TorchLauncher와 Studio renderer/navigation/IPC/isolation 및 760px/1100px 확인 통과.
- `pnpm --filter @torchlauncher/studio typecheck`: 통과(Studio main/renderer TypeScript).
- `pnpm exec vitest run apps/admin/src/renderer/src/i18n/catalog.test.ts apps/admin/src/renderer/src/noNativeDialogs.test.ts apps/admin/src/renderer/src/pages/Pages.test.ts`: **3개 파일 / 4개 테스트 통과, 실패 0**. 전체 `pnpm check`에서도 전체 noNativeDialogs 포함 검사 통과.
- `git diff --check`: 통과.
- 최초 smoke 한 번은 이전 `out` 빌드를 사용해 출력 없이 대기하여 Ctrl-C(exit 130)로 중단했다. `pnpm --filter @torchlauncher/studio build` 후 smoke를 재실행했고, 위 통과 결과는 최신 빌드에 대한 것이다.

## 한계 / 미실행

- 실제 로그인·로그아웃·로그인 도중 취소, 게임 설치/시작/중지, 실제 분석 결과의 renderer 노출은 계정 및 실게임이 필요해 미실행이다. UI smoke에서는 로그인 요청/게임 다운로드를 시작하지 않았다.
- 기능 smoke는 시작 전 페이지와 reset 확인 취소 경로까지 검증했다. 실행 중 프로세스·진행률·로그 및 분석 카드의 실데이터 UI는 기존 TESTRUN-MAIN-01의 가짜 서비스 테스트로 main 쪽 계약을 검증했지만, renderer에 동일 fixture 상태를 주입하는 UI 검증은 없다.
- TESTRUN-MAIN-01 인계의 설정 추출 한계(ASCII `.properties`/`.txt` 중심, 나머지 설정 형식 제한), 로그인 환경 제한, 실제 Windows 확인 필요 사항은 유지된다.
- 메인 소유 Microsoft 코드 창은 기존 TESTRUN-MAIN-01 구현이라 bundled Pretendard 대신 `system-ui`를 사용한다(위 API 메모). renderer 글꼴 규칙과 구분되는 미통합 디자인 이슈다.

## 시안 화면 대조표

`docs/design/studio/`의 화면 HTML 27개를 모두 나열했다. 기존 통합 화면은 현재 `main` 기준으로 유지되는 동작을 표시하고, 이번 변경은 테스트 실행 화면 8개 및 옵션 설정 연결에 집중했다.

| 시안 파일 | 상태 | 근거 / 차이 |
| --- | --- | --- |
| `Splash.dc.html` | 구현함 | 기존 시작 애니메이션, 번들 폰트 사용. |
| `Main.dc.html` | 구현함 | 기존 프로젝트 시작/열기 화면 유지. |
| `DialogUnsaved.dc.html` | 구현함 | 기존 앱 안 저장 확인 모달 유지. |
| `Overview.dc.html` | 구현함 | 기존 개요 페이지 유지. |
| `Server.dc.html` | 구현함 | 기존 서버 정보 편집 화면 유지. |
| `Brand.dc.html` | 구현함 | 기존 브랜딩 화면 유지. |
| `SettingsMods.dc.html` | 구현함 | 설정 후보 목록/정책 화면 유지, 테스트 발견 config 링크 연결. |
| `SettingsPacks.dc.html` | 구현함 | 리소스팩 독립 화면 및 추가/순서/정책 동작 유지. |
| `SettingsShaders.dc.html` | 구현함 | 셰이더 선택/팩 설정 화면 유지. |
| `Files.dc.html` | 구현함 | 파일 정책/상태 화면 유지. |
| `TestStart.dc.html` | 구현함 | 계정 상태, 환경·소스 요약, 로그인 및 조건부 시작 버튼. |
| `TestLogin.dc.html` | 부분 구현 | 로그인 버튼·취소가 연결됨. 인증 코드는 main 소유 자식 BrowserWindow에 표시되고 인라인 renderer 모달/시안 폰트와 다름. |
| `TestPreparing.dc.html` | 구현함 | 준비/설치/동기화 단계, 실제 진행값, 최근 로그, 취소 확인. |
| `TestFailed.dc.html` | 구현함 | 정화된 오류 설명, 최근 로그, 재시도 및 인스턴스 초기화. |
| `TestRunning.dc.html` | 구현함 | 최근 로그와 종료 확인 버튼. 게임 실행 중 계정/다른 동작 컨트롤을 숨김. |
| `DialogStopTest.dc.html` | 구현함 | 게임 종료 확인을 인앱 `Modal`로 구현. |
| `TestResultProblems.dc.html` | 구현함 | severity·category·mod/file·근거 줄·모드 목록 및 추출 미리보기. |
| `TestResultOk.dc.html` | 구현함 | 문제 없음/미완료 요약, 비보증 문구, 단축키·옵션 추출 수와 설정 이동. |
| `DialogReset.dc.html` | 구현함 | 인앱 확인 후 `confirmed:true`만 전송. 취소는 아무 명령도 보내지 않음. |
| `SettingsEmpty.dc.html` | 구현함 | 테스트 결과와 `options.txt` 두 가져오기 출처 유지, 테스트 페이지 링크 연결. |
| `Settings.dc.html` | 구현함 | 가져온 값/출처 표시, test/file 명시적 재가져오기 유지. |
| `DialogPreset.dc.html` | 부분 구현 | 기존 앱 내 대화상자와 파일/폴더 선택기 유지. 옵션 가져오기는 별도 `settingsImportOptions` 동작 사용. |
| `DeployChanged.dc.html` | 구현함 | 기존 배포 변경 상태 화면 유지. |
| `DeployReady.dc.html` | 구현함 | 기존 최신 배포 상태 화면 유지. |
| `Export.dc.html` | 구현함 | 기존 내보내기 화면 유지. |
| `ExportBlocked.dc.html` | 구현함 | 기존 내보내기 차단 설명 유지. |
| `ExportDone.dc.html` | 구현함 | 기존 내보내기 완료 화면 유지. |

통합 및 완료 판정은 #0에게 맡긴다.
