# TESTRUN-UI-01a handoff

## 작업 정보

- 세션/모델: Codex 구현 작업자, GPT-6 기반(정확한 런타임 변형은 도구에서 노출되지 않음). 코디네이터 #0 아님.
- 작업 ID: `TESTRUN-UI-01a`.
- Worktree / 브랜치: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-1`, `feat/studio-nav-split`.
- 기준 커밋: `afb9a02`.
- 구현 커밋: `e6b27d9` (`feat(studio): split game and player settings navigation`).
- 통합 여부: 작업자 브랜치에만 커밋. main 통합 및 완료 판정은 하지 않음.
- 구현 커밋 범위(`git diff --stat afb9a02...e6b27d9`):

  ```text
  apps/admin/scripts/smoke-functional.mjs            |  56 +++-
  apps/admin/src/renderer/src/components/Sidebar.tsx |  45 ++-
  apps/admin/src/renderer/src/hooks/useStudio.ts     |  10 +-
  apps/admin/src/renderer/src/i18n/catalog.ts        |  96 +++---
  apps/admin/src/renderer/src/pages/FilesPage.tsx    |  26 +-
  apps/admin/src/renderer/src/pages/Pages.tsx        |  23 +-
  apps/admin/src/renderer/src/pages/SettingsPage.tsx | 348 +++++++++++++--------
  apps/admin/src/renderer/src/pages/types.ts         |  19 +-
  apps/admin/src/renderer/src/settings/state.ts      |   4 +-
  apps/admin/src/renderer/src/styles.css             |  47 ++-
  10 files changed, 471 insertions(+), 203 deletions(-)
  ```

## 구현

- 사이드바 순서를 시안에 맞춰 개요·서버 정보·브랜딩, 게임 구성(모드 설정·리소스팩·셰이더·파일), 테스트(테스트 실행), 플레이어 설정(단축키 · 옵션), 배포(배포·내보내기)로 나눴다. 그룹 이름은 `.mg`, 메뉴 항목 높이는 38px다. 파일 변경·서버 입력 필요·배포 다시 만들기 상태 태그를 유지했다.
- 모드 설정, 리소스팩, 셰이더를 독립 페이지로 만들고 기존 페이지 안의 프리셋 바와 5개 탭을 제거했다. 옵션 화면은 단축키/소리 · 화면 탭만 사용한다. 모드 설정 진입 시 `settingsTestConfigs`로 후보를 새로 읽고, 프로젝트 설정 항목과 테스트 후보 항목별 3상태 정책을 표시한다. 지원하지 않는 후보는 형식 안내를 포함해 별도 행으로 남긴다.
- 단축키 · 옵션은 가져오기 전 시안의 두 카드(테스트 결과/ options.txt 파일)와 가져온 뒤 가져올 곳 토글/다시 가져오기로 바꿨다. 옵션은 `{action:'settingsImportOptions', source:'test'|'file'}`를 사용한다. TEST_OPTIONS_MISSING/NO_TEST_RESULT는 `reply.detail.code`에서 읽어 ko/en i18n으로 표시한다. 성공한 가져오기는 기존 메인 동작대로 프로젝트 저장 필요 상태가 된다.
- DialogPreset은 모드 설정 및 셰이더 페이지의 “폴더에서 불러오기” 보조 버튼에서 기존 `{action:'settingsImport', source:'folder'|'file'}`로 사용한다. 옵션/설정 후보를 함께 읽어야 하는 시안상 폴더 경로이므로 이 위치에 두었다. 단축키 · 옵션의 options.txt 선택은 새 `settingsImportOptions`의 file 출처가 직접 선택기를 연다.
- 파일 화면의 관리 링크는 단축키 · 옵션/리소스팩/셰이더 각 메뉴로 이동하고, 안내문 링크도 새 메뉴 이름을 쓴다. `nav.settings` 및 구 게임 설정 페이지 제목 i18n 키를 제거/교체했다.
- 테스트 실행은 메뉴에서 진입 가능하고 제목 헤더만 있는 빈 자리 표시 페이지다. 테스트 실행 기능 화면은 `TESTRUN-UI-01b` 범위다.
- 네이티브 확인창을 추가하지 않았다. 기존 `apps/admin/src/renderer/src/noNativeDialogs.test.ts` 파일은 변경 없이 유지되며 `pnpm check` 전체 테스트에서 실행됐다.

## 검증 결과

실행 환경: Linux/WSL, `DISPLAY=:0`, Node/pnpm은 저장소 설정 버전.

- `pnpm check`: 통과. Biome 372개 파일, 36개 기존 경고/3개 정보/오류 0; 전체 타입 검사 통과; Vitest 96개 파일 통과·4개 skip, 테스트 1,394개 통과·9개 skip·실패 0; 두 앱 빌드 통과.
- `DISPLAY=:0 node apps/admin/scripts/smoke-functional.mjs`: 통과. 새 메뉴의 각 페이지 진입, 옵션 파일 및 테스트 출처 가져오기, NO_TEST_RESULT 한국어 상태 메시지, 모드 폴더 가져오기, 저장·배포·내보내기, 760/1100px 실제 paint 및 가로 스크롤 없음, 격리와 네이티브 메시지 상자 호출 0을 확인했다.
- `pnpm --filter @torchlauncher/studio typecheck`: 통과(전체 검사 전 독립 실행).
- `pnpm --filter @torchlauncher/studio build`: 통과(기능 smoke 재실행 전).
- `git diff --check afb9a02...e6b27d9`: 통과.
- `DISPLAY=:0 node scripts/smoke.mjs`: 미완료/중단. 런처 렌더러·IPC·격리·760/1100px 검사는 통과 출력 후 Studio 단계에서 이전 메뉴 이름 `게임 설정`을 찾는 기존 루트 스크립트가 진행되지 않아 Ctrl-C로 중단했다. 스크립트는 지정 독점 범위(`apps/admin/scripts/*smoke*`) 밖의 `scripts/smoke.mjs`이므로 수정하지 않았다. #0이 Studio 페이지 목록을 새 메뉴로 갱신한 뒤 재실행해야 한다.
- TEST_OPTIONS_MISSING은 main 서비스 테스트에서 응답 코드가 검사되고 렌더러에서는 같은 상세 코드 매핑을 구현했으나, 기능 smoke에서 실제 완료 테스트(옵션 파일 없는 종료 결과)를 만들 수 없어 화면 표시 자체는 미실행이다. NO_TEST_RESULT 화면 문구는 기능 smoke에서 확인했다.

## 다음 작업자 / 코디네이터 메모

1. #0은 루트 `scripts/smoke.mjs`의 Studio 메뉴/페이지 기대값을 새 분리 메뉴에 맞게 조정하고 `DISPLAY=:0 node scripts/smoke.mjs`를 다시 실행한다.
2. TEST_OPTIONS_MISSING UI 문구 확인은 옵션 없는 테스트 종료 결과를 가진 실제/격리된 테스트 인스턴스로 수행할 수 있다. 현재 기능 smoke는 외부 게임 다운로드/실행을 하지 않는다.
3. 이 브랜치에는 작업자 인계 문서 전용 변경만 추가 커밋할 예정이다. 작업자는 통합하지 않는다.

## 시안 화면 대조표

| 시안 파일 | 상태 | 근거/한계 |
| --- | --- | --- |
| `Splash.dc.html` | 구현함 | 기존 시작 화면 유지, 번들 글꼴 유지. |
| `Main.dc.html` | 구현함 | 기존 프로젝트 시작/생성 화면 유지. |
| `DialogUnsaved.dc.html` | 구현함 | 기존 앱 안 저장하지 않은 변경 모달 유지. |
| `Overview.dc.html` | 구현함 | 기존 개요 페이지 유지. |
| `Server.dc.html` | 구현함 | 기존 서버 정보 페이지 유지. |
| `Brand.dc.html` | 구현함 | 기존 브랜딩 페이지 유지. |
| `SettingsMods.dc.html` | 구현함 | 분리 페이지, 설정 파일 후보/지원 안 함 형식 및 항목별 3상태 정책 표시. |
| `SettingsPacks.dc.html` | 구현함 | 리소스팩 독립 페이지와 기존 추가/순서/정책 동작 유지. |
| `SettingsShaders.dc.html` | 구현함 | 셰이더 독립 페이지와 기존 팩/선택/옵션 동작 유지. |
| `Files.dc.html` | 구현함 | 게임 구성 그룹 마지막으로 이동, 새 메뉴로 링크 변경. |
| `TestStart.dc.html` | 부분 구현 | “테스트 실행” 메뉴와 제목 헤더만 연결. 기능 화면은 01b 범위. |
| `TestLogin.dc.html` | 하지 않음(이유) | 로그인 화면은 TESTRUN-UI-01b 범위. |
| `TestPreparing.dc.html` | 하지 않음(이유) | 준비 진행 UI는 TESTRUN-UI-01b 범위. |
| `TestFailed.dc.html` | 하지 않음(이유) | 준비 실패 UI는 TESTRUN-UI-01b 범위. |
| `TestRunning.dc.html` | 하지 않음(이유) | 실행 로그/중지 UI는 TESTRUN-UI-01b 범위. |
| `DialogStopTest.dc.html` | 하지 않음(이유) | 테스트 종료 확인은 TESTRUN-UI-01b 범위. |
| `TestResultProblems.dc.html` | 하지 않음(이유) | 분석 결과 UI는 TESTRUN-UI-01b 범위. |
| `TestResultOk.dc.html` | 하지 않음(이유) | 분석 결과 UI는 TESTRUN-UI-01b 범위. |
| `DialogReset.dc.html` | 하지 않음(이유) | 테스트 인스턴스 초기화 모달은 TESTRUN-UI-01b 범위. |
| `SettingsEmpty.dc.html` | 구현함 | 테스트 결과 카드(결과 없으면 비활성/테스트 메뉴 안내)와 options.txt 파일 카드. |
| `Settings.dc.html` | 구현함 | 가져올 곳 토글, 다시 가져오기, 단축키/소리·화면 정책 일괄 변경. |
| `DialogPreset.dc.html` | 부분 구현 | 기존 앱 안 보조 dialog 및 네이티브 폴더/파일 선택 사용. 모드 설정·셰이더 폴더 불러오기 보조 경로로 배치. |
| `DeployChanged.dc.html` | 구현함 | 기존 배포 변경 상태 페이지 유지. |
| `DeployReady.dc.html` | 구현함 | 기존 최신 배포 상태 페이지 유지. |
| `Export.dc.html` | 구현함 | 기존 내보내기 페이지 유지. |
| `ExportBlocked.dc.html` | 구현함 | 기존 내보내기 차단 안내 유지. |
| `ExportDone.dc.html` | 구현함 | 기존 내보내기 완료 화면 유지. |

이 작업은 TEST_OPTIONS_MISSING 화면 검증과 루트 공통 smoke 갱신을 남긴 채 작업자 브랜치에 전달한다. 통합/완료 선언은 #0이 수행한다.
