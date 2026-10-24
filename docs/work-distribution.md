# 병렬 개발 작업 분배

## 역할과 현재 배정

2026-10-24 STUDIO-FILES-01 시작: 사용자 지시로 배정서의 모드·기타 파일 페이지 작업만 착수한다.
#1 `studio_mods_files`, `gpt-6-luna` low, `feat/studio-mods-files`, `.agents/worktrees/studio-mods-files`,
initial baseline `42483a6`, docs fast-forward `570b0c4`. 독점 범위와 완료 조건은 [studio-files-task.md](studio-files-task.md). 개발 빌드 모드도 따르는 가운데
기존 모드 설정 편집기를 모드 페이지 두 번째 섹션으로 유지한다. #0만 tracker·통합·통합 검증을 맡는다.
STUDIO-EXPORT-01은 병렬로 시작하지 않는다. GitHub owner/repo 결정이 필요하고 사용자 지시가 아직 없다.
추가 범위: `.jar` picker filter/title locale을 위해 Studio main `native-dialogs.ts`·`i18n.ts`·`native-dialogs.test.ts` 포함(`#0`, kickoff scope update).

2026-10-24 STUDIO-VERSION-SELECT-02 사용자 후속 결정: 최소 Minecraft 드롭다운 버전을 1.14로 상향.
#1 `studio_version_select_low`, `gpt-6-luna` low, 기존 `.agents/worktrees/studio-version-select`와
`feat/studio-version-select`를 이어서 사용하며 `7536aee` 기준. 독점 범위는 고정 버전 카탈로그·테스트와
`docs/handoffs/STUDIO-VERSION-SELECT-01.md`; #0은 진행 문서와 통합을 맡는다. Fabric stable 필터는 이 후속에서
변경하지 않는다. 현재 공식 Meta API는 해당 MC 버전에 호환되는 loader 전체를 제공하지만, 코드는 `stable:true`만
남기므로 최신 안정판 하나만 표시한다. 사용자에게 설명하고 전체 호환 버전 노출 여부를 별도로 확인한다.

2026-10-24 STUDIO-VERSION-SELECT-01: Studio 서버 설정의 게임/로더 버전 드롭다운.
#1 `studio_version_select`, `gpt-6-luna` low, `.agents/worktrees/studio-version-select`,
`feat/studio-version-select`, baseline `0a966ac`. 모델은 고정 메타데이터 목록과 온라인 로더 카탈로그의 범위가
명확한 Studio UI/IPC 작업이라 최소 모델 Luna·low로 배정했다. 최초 Luna·medium 배정은 사용자 피드백에 따라
파일 변경 전 중단했고, 실제 구현은 Luna·low 작업자가 완료했다. 독점 `apps/admin/**` 및
`docs/handoffs/STUDIO-VERSION-SELECT-01.md`; #0만 `docs/progress.md`와 이 문서를 수정하고 통합한다.
안정 Minecraft 릴리스는 공식 manifest에서 1.7.10 이상을 1회 가져와 저장하고 런타임 Minecraft 목록 요청은 하지 않는다.
선택한 게임/로더 조합에 맞는 Fabric/NeoForge 버전은 공식 온라인 메타데이터에서 가져온다.
선택 변경 때 호환되지 않는 로더 버전을 유지하지 않는다. 드롭다운 제공 범위와 실제 설치 검증 범위를 혼동하지 않는다.
- 완료: catalog/i18n/test `85a4564` → main `fa5daf3`; 오래된 테스트 수정 `edc5a66` → main `d114116`.
  통합 Vitest 4 files/10 tests, diff check 통과. 작업자 Studio typecheck/build 및 집중 Biome 통과.
  전 버전 호환 설치는 검증하지 않았다. 전체 Fabric compatible 목록 노출 여부는 별도 사용자 결정 대기.
- 완료: `7536aee` → main `02918a0`. 관련 Vitest 4 files/12 tests, Studio typecheck/build/기능 smoke 통과;
  작업자 Biome 오류0(기존 CSS warning31). 전체 `pnpm check`와 새 버전 조합 실설치는 미실행. [인계](handoffs/STUDIO-VERSION-SELECT-01.md).

2026-10-24 CURRENT-FORMAT 정리 사용자 승인: 개발 중 과거 호환 reader/writer/전환 경로 삭제, 현재 규격만 유지.
- #1 `current_formats_core`, gpt-6.1-sol medium, agent-1 `feat/current-formats-core`, baseline `66ed90b`.
  독점 `packages/**` 및 `docs/handoffs/CURRENT-FORMAT-CORE-01.md`. torchpack1.2 단일화, sign/sequence 필수,
  server signing 필수, lockv1 판독 제거와 unknown fail-closed 유지, 관련 packages 소비자/fixture/tests.
- #2 `current_formats_apps`, gpt-6.1-sol medium, agent-2 `feat/current-formats-apps`, 같은 baseline.
  독점 `apps/**`, `scripts/**`, `docs/handoffs/CURRENT-FORMAT-APPS-01.md`. 새 core 계약 연결,
  무서명 launcher/Studio fallback·옛 형식 fixture 제거, 앱/스크립트 회귀 검증.
- 현재 torchpack1.2: index branding/sequence 필수, writer sign/sequence 필수; reader key 없는 구조 검사는
  도구용 unverified로 유지하되 launcher는 항상 구성 키로 verified만 사용. server config signing 필수.
- 선택적 브랜딩/게임 표시 hint/메모리 값은 현재 기능이며 유지. Minecraft·외부 포맷 지원은 과거 앱 호환과 구분.
- #0은 명세·현행 안내 갱신/검토/통합·전체 검증. manifest/lockfile 변경은 배정하지 않음. core 통합 후 apps 검증.
  cross-package 계약 변경 규모 때문에 Sol medium 두 명; 추가 에이전트/고사양 상향 없음.
- 완료: core `01291c4`/`a4d28e4`/`42dc247`, apps `41cc46f`를 #0이 `f7845c8`/`79055d7`/`6bd67a2`로 통합.
  main check1477passed/9skip·전체 타입/두 빌드·공통+두 기능+두 branding smoke 성공. 작업자 종료/브랜치 정리.
  Windows/live 신규 검증 없음. 760px 하단 경로 toast 겹침은 별도 기존 UI 한계로 progress에 기록(중앙 target smoke만 검증).


2026-10-24 STUDIO-START-LINE-01: 사용자 시작페이지 상단 검은 선 보고. #1 `studio_start_line`, gpt-6-luna medium,
agent-1 `fix/studio-start-top-line`, baseline `9b61d66`. 실제 Electron 재현/paint/layout 원인 확인 후 최소 수정.
독점: admin renderer styles.css/App.tsx/components/MenuBar.tsx/pages/StartPage.tsx, 필요시 앱 로컬 smoke의 해당 화면 검증,
`docs/handoffs/STUDIO-START-LINE-01.md`. native frame·메뉴/단축키 유지. main/native menu 변경 필요시 #0 범위 조정 선행.
#0은 검토·통합·검증·진행 문서 담당. core/IPC/manifest/루트 smoke 제외, 추가 작업자 없음.
완료: `b0c032d` → `bcf7e1e` 통합; main Studio 빌드/앱 기능 smoke 성공, 760/1100px 배경 접점·내용 여백 확인.
작업자 종료·브랜치 정리. 자세한 원인/증거는 progress 및 해당 인계 참조.


2026-10-24 #0 Codex 재개: LAUNCHER-EN-01 `f995008`, MAIN-I18N-01 `0eb01fd`는 main 병합됨. 통합 검증 대기.
TEST-LOCALE-01 #1 `launcher_test_locale`, gpt-6-luna low, agent-1 `fix/launcher-test-locale`, baseline `0eb01fd`.
독점: launcher renderer `pages.test.ts`, `shell.test.ts`, `docs/handoffs/TEST-LOCALE-01.md`만.
테스트 전용 저장 선호로 한국어를 명시하고 mock을 복원한다. 제품 자동 언어/설정/IPC는 변경하지 않는다.
영어·한국어 환경에서 해당 테스트 및 Biome 후 커밋·인계. #0은 검토·병합·main 전체 검사/smoke·기록 담당.
후속 범위 추가: `scripts/smoke.mjs`, launcher `scripts/renderer-functional-smoke.mjs`의 Electron 시작 언어만 ko로 명시.
영어 기본 환경에서 한국어 시작 selector timeout 확인; 내부 자동/영어 전환 검증은 유지한다.
추가 허용: 런처 확인창 synthetic handler에서 set-language를 별도 기록하고 영어 IPC 수신을 검증한다.
완료: `4978924`/`24a1ffd`/`2c37df9` → `562764a`/`95a8639`/`5f30df3` 통합.
main 영어 pnpm check 1470 passed/9 skipped, 타입/Biome/두 빌드 성공; 공통 두 앱·Studio/런처 기능 smoke 성공.
작업자 종료, 병합 브랜치 정리. Windows native 신규 검증 없음. 자세한 증거는 progress 및 TEST-LOCALE-01 인계 참조.


UI-FEEDBACK-01 검토 추가: 배경 자식 z-index가 부모 밖으로 빠져 홈 내용을 덮는 원인 재현.
브라우저 clipboard-write는 production deny 정책에서 denied 확인. #0이 좁은 범위 추가 승인:
launcher main/product/ipc(+test), main/index, preload, shared API 및 공통 scripts/smoke.mjs 목록 정렬.
인자 없는 copyServerDataPath IPC가 신뢰 main-frame과 정확한 인자를 검사하고 현재 서버 루트만 복사한다.
임의 문자열/경로 입력이나 전역 clipboard 권한 허용은 하지 않는다. 게임/서비스/잠금 변경은 제외한다.

UI-FEEDBACK-01 사용자 보고: 플레이에서 서버 이름/버튼까지 전부 보이지 않음, 설정 경로 복사 버튼 요청.
#1 기존 작업자 `branding_contracts`, agent-1 `fix/launcher-play-path-feedback`, 기준 `a0a4bda`.
배타적 launcher renderer 및 앱 로컬 smoke/fixture·해당 인계만. main/IPC/core/admin/루트 scripts 제외.
배경 z-index/stacking 실제 가림을 elementFromPoint·화면으로 재현하고 수정한다(원인 확정 전).
긴 경로 전체를 clipboard로 복사하는 버튼·성공/실패 i18n·760/1100 표시를 확인한다.
기존 smoke의 DOM 존재 검사와 실제 시각/클릭 가능 검증을 구분한다. #0만 통합/전체 검사한다.

운영자 브랜딩 구현·통합 검사 완료(Windows/실배포 확인은 대기).
- core `7281829` → `df2af4d`, Studio 기능 `33e038b` → `179dc91`, 런처 `499d53d` → `8ebb64d`.
- 검증 스크립트 정렬 `9ef99cd` → `553a072`: 새 API exact 목록/기본값/실제 구독 해제를 추가했다.
- main 전체 검사 **1051개 통과/9 skip**, 전체 타입·두 앱 빌드·Biome(기존 CSS 경고 8개).
  제품 변경 이후 전체 검사 성공, 이후 smoke-only 수정은 해당 검사로 검증했다.
- main에서 두 branding smoke 및 기존 두 앱 smoke 성공: native PNG/JPEG·원격 역할 변경/실패 유지·
  이미지 제거 후 실제 재시작·브라우저 디코드/페이드/reduced-motion·760/1100·IPC 격리 확인.
- Studio UI는 요청대로 변경하지 않았다. 기능 API/저장 방식은 [Studio 인계](handoffs/BRAND-STUDIO-01.md),
  런처 표시/갱신/캐시는 [런처 인계](handoffs/BRAND-RUNTIME-01.md). 자동 ZIP은 미구현이다.
- L1~L3 런처 구현 범위는 통합됨. Windows 네이티브·실제 호스팅 이미지 버전 교체는 아직 검증하지 않았다.
  스킨/이전 기능의 사용자가 보고한 Windows 성공과 이번 새 브랜딩 검증은 구분한다.

BRAND-RUNTIME-01 `499d53d` → `8ebb64d` 통합 완료. main pnpm check 성공:
1051개 통과/9 skip, 전체 타입·두 앱 빌드·Biome 기존 경고.
두 앱 branding-smoke도 main에서 성공(실제 native decode·런처 fade/재시작 포함).
기존 공통 smoke의 bridge exact 목록이 새 API 두 개를 누락해 실패했고,
BRAND-SMOKE-01 기존 #1에게 `scripts/smoke.mjs` 및 인계만 수정 배정했다.
agent-1 `test/branding-smoke-api`, 기준 `8ebb64d`; 제품 추가 변경 없음.

BRAND-STUDIO-01 `33e038b` → `179dc91` 통합 완료(UI 변경 없음). main pnpm check 성공:
1034개 통과/9 skip, 전체 타입·두 앱 빌드·Biome. 로그 `/tmp/torch-brand-studio-check.log`.
이미지 선택/제거·앱 이름 API, 20MiB 제한 embedded 프로젝트 snapshot/요약 상태,
동일 bytes pack/sidecar 출력과 원격 역할 mismatch 차단 구현. [인계/API](handoffs/BRAND-STUDIO-01.md).
Studio 선택 화면은 요청대로 후속. 런처 작업자는 Electron fixture 검증 통과 후 최종 커밋 준비 중이다.

사용자 추가 승인: BRAND-STUDIO-01 기능만 런처와 병렬 진행(Studio renderer/UI 수정 금지).
#2 Sol medium 요청, agent-2 `feat/studio-branding-functions`, 기준 `907f7d7`.
독점 main/shared/필요한 preload 및 전용 새 smoke. [배정](branding-studio-task.md).
#1은 launcher만, #2는 admin만 변경한다. core/루트 설정/lockfile은 양쪽 모두 제외한다.

BRAND-CORE-01 `7281829` → `df2af4d` 통합 완료. main pnpm check 성공: 1028개 통과/9 skip,
전체 타입·두 앱 빌드·Biome(기존 경고). 로그 `/tmp/torch-brand-core-check.log`.
다음 BRAND-RUNTIME-01은 같은 #1 작업자/Sol medium 요청으로 agent-1 `feat/branding-runtime`에 배정한다.
배타적 범위 `apps/launcher/**`와 해당 인계. [세부 계약](branding-runtime-task.md). Studio는 이후 순차.

BRAND-CORE-01: #0 기술 설계 검토 승인 후 기존 작업자에게 구현 재개를 지시했다.
프로파일 선택적 branding, torchpack v1.1 별도 이미지 payload/역할별 staging을 구현 중이다.
기존 v1.0 유지, 아직 코드 통합·런처/Studio 연결 완료 아님.

운영자 브랜딩 혼합 전달 승인: [동봉+원격 계약/순서](operator-branding-hybrid.md).
BRAND-CORE-01 #1 `branding_contracts`, Sol medium 요청, agent-1 `feat/branding-contracts`, baseline `4c55456`.
공용 core 계약/reader/writer만 먼저, runtime/Studio는 순차. 동시 작업자는 한 명이며 처음 기술안을 #0 검토 후 구현한다.

BRAND-PLAN-01: 사용자 운영자 브랜딩 착수 요청에 따라 자산 전달 방식을 먼저 조사한다.
#1 `branding_proposal`, Luna medium 요청, agent-1 `docs/operator-branding-proposal`, baseline `0c60ddd`.
독점: `docs/operator-branding-proposal.md`만 작성. apps/admin 내보내기·프로젝트, core server-config/배포,
launcher bootstrap/CSP/이미지 로딩을 읽기 전용 조사한다. 제품 코드/공용 형식/IPC는 아직 변경하지 않는다.
프로필 옆 이미지 동봉/원격 torchpack/별도 URL의 선택지와 권고, 업데이트·오프라인·검증·버전 호환 영향을 제시한다.
서명 없는 공통 exe는 유지, 시작 TorchLauncher 로고 고정. #0이 구체 계약안을 보고하고 사용자 승인 후 구현 배정한다.

PATH-01 사용자 피드백: 설정 서버 데이터 경로가 여러 줄로 꺾임. #1 `settings_path`, Luna low 요청,
agent-1 `fix/settings-path-ellipsis`, baseline `2725d1d`. 독점: Settings.tsx의 경로 한 줄 표시/title만,
styles.css의 설정 경로 전용 레이아웃, 기존 관련 renderer 테스트/smoke의 최소 검증,
`docs/handoffs/PATH-01.md`. 전체 경로 문자열/선택 복사를 보존하고 말줄임+툴팁, 760/1100px overflow 확인.
새 복사 버튼/IPC/공유 경로 스타일·삭제 확인 창·백엔드 변경은 하지 않는다.
완료: `e842492` → `36bbf7d`, main 전체 검사 통과(978개/9 skip, 타입/Biome/두 앱 빌드),
작업자 21개 renderer 테스트 및 긴 Windows 경로 760/1100px Electron 화면 검사 통과.
agent-1 detached·브랜치 정리, 실제 Windows 표시 재확인은 대기다.

2026-10-23 사용자 승인: L2a 후속과 L3 스킨만 병렬 진행. [배타적 범위와 계약](launcher-parallel-followups.md).
#2 `launcher_followups` / agent-2 / `feat/launcher-l2a-followups`: Astra medium 요청(삭제 안전 경계).
#3 `player_skin` / agent-3 / `feat/launcher-player-skin`: Sol medium 요청(외부 응답·캐시·아바타).
서비스/IPC/상태·공유 renderer 연동은 #2만, 스킨 모듈/표시 component는 #3만 소유한다.
실제 effort 표시는 사용자 보고를 우선하고 도구의 요청값과 구분한다. 추가 작업자/운영자 브랜딩은 제외한다.

BRAND-ICON-01: 사용자 제공 루트 `icon.ico`를 두 앱의 실행 파일·창 아이콘으로 적용한다.
#1 `app_icon`, Luna medium, agent-1 `feat/app-icon`. 독점: 새 `assets/branding/**`,
`electron-builder.base.cjs`, 두 앱 `src/main/index.ts`의 아이콘 설정만, 해당 인계.
원본 icon.ico 보존, 기존 UI/테마/기능 변경 금지. 공유 PNG는 ICO의 기존 PNG entry를 무손실 추출한다.
Windows portable 아이콘과 Linux 창/패키지 자산 경로를 구분하고 dev/build/packaged 경로를 검증한다.
`35d4f90`을 #0이 `8b2e946`으로 통합. 작업자 종료·clean. main 타입/빌드/런처 Linux 패키지 확인 성공.

I18N-01: #1 `i18n_foundation`, Luna medium, agent-1 `feat/i18n-foundation`, baseline `753e2ac`.
[localization.md](localization.md)의 공통 번역 API·사전·저장 adapter·React hook만 준비한다.
기존 UI 언어/화면 적용은 후속이며 이번에는 변경하지 않는다. 독점 범위는 상세 문서를 따른다.
`f95faf9`·`5863dce` 통합, 작업자 종료·clean, #0 전체 검사 성공(832개/9 skip). 다음 UI 작업은 Claude에 인계하며
`docs/ui-handoff.md`를 읽고 범위를 배정한 뒤 착수한다.

2026-10-22 LAUNCH-EXIT-01: #3 `close_on_launch`, `feat/launcher-close-on-game-start`/agent-3,
Sol·medium(프로세스 수명·설정 저장·잠금 경계). [close-on-launch.md](close-on-launch.md)가 상세 범위다.
launcher 앱과 Minecraft process/recovery 최소 변경을 한 작업자가 독점했다. `5a7e0c3`와 인계 `2cf254a` 통합.
작업자 종료·worktree clean. #0 전체 `pnpm check` 성공, Windows 실게임 검증은 남아 있다. 다른 기능/UI 개편은 착수하지 않는다.

2026-10-22 UI-PROD-01: [ui-production.md](ui-production.md)의 기능 우선 범위로 배정.
#4 `ui_prod_launcher` / `feat/ui-prod-launcher-flow` / agent-4: launcher renderer·app-local smoke·해당 인계.
#1 `ui_prod_studio` / `feat/ui-prod-studio-flow` / agent-1: `apps/admin/**`·공통 `scripts/smoke.mjs`·해당 인계.
둘 다 Luna·medium으로 시작하며 필요 시 작업별 재선택한다. #0은 제품 코드 수정 없이 검토/통합한다.

2026-10-22 GAME-ACTIVITY-01: #4(`install_activity`), `feat/install-activity`/agent-4,
Sol·medium(동기화/설치 이벤트 의미와 실패 전파). 독점: `apps/launcher/src/shared/product.ts`,
`apps/launcher/src/main/product/service.ts`와 대응 테스트/새 순수 activity helper,
`packages/core/src/loaders/launch-gate.ts`와 대응 테스트, `docs/handoffs/GAME-ACTIVITY-01.md`.
UI 재설계/renderer 수정 없이 종류·단계·상대 경로·개수·활성 작업을 ProductState로 전달한다.
#3은 installer.ts의 optional `onActivity`와 InstallActivity만 소유한다. 연동 계약은 작업자끼리 확인한다.
#4 추가 독점: `instance/sync/types.ts`·`engine.ts` 및 대응 테스트. 기존 onProgress 호출 시점은 유지하고
별도 optional onFileActivity로 파일 staging/apply 시작·완료를 보고한다. 계획상 다운로드 수를 실제 완료율로 쓰지 않는다.

2026-10-22 GAME-PERF-01: #3(`install_parallel`) / `perf/game-install-parallel` / agent-3.
Sol·medium(경합·중단 정리·설치 트랜잭션)으로 기본 게임/Java 파일을 제한 병렬 처리한다.
독점: `packages/core/src/minecraft/installer.ts`, 설치 관련 테스트/새 내부 helper,
`docs/handoffs/GAME-PERF-01.md`. main/preload/renderer/다운로드 계약/공유 설정은 수정하지 않는다.
첫 실패/취소 시 새 작업을 멈추고 진행 작업을 모두 회수한 후 staging/lease를 정리한다.
해시·게시·복구 계약과 진행 이벤트 호환을 유지한다. 현재 실행 중인 사용자 설치는 건드리지 않는다.

2026-10-22 기능 연결 승인: [ui-integration.md](ui-integration.md)에 계약과 독점 범위를 기록했다.
#1 UI-CONNECT-S: `feat/ui-connect-studio` / agent-1, `apps/admin/**`·`packages/core/src/server-config/**`·해당 인계.
#4 UI-CONNECT-L: `feat/ui-connect-launcher` / agent-4, `apps/launcher/**`·`packages/core/src/server-status/**`·
`packages/core/src/loaders/launch-gate.ts`와 대응 테스트·해당 인계. 둘 다 `gpt-6.1-sol` medium.
공유 smoke 스크립트는 이후 한 작업자에게만 배정한다. 공통 desktop·manifest·lockfile 변경은 사전 조정한다.

2026-10-22 UI-BASE: 사용자 승인으로 #1 단독 배정. 브랜치 `feat/ui-base-shells`,
worktree `.agents/worktrees/agent-1`. 독점 범위: 두 앱 `src/renderer/**`,
`scripts/smoke.mjs`, `docs/handoffs/UI-BASE.md`. Luna·medium으로 앱별 탐색/화면 구조,
스타일 토큰과 기본 UI 컴포넌트, 접근 가능한 빈 상태를 구현한다. 외부 의존성·공유 패키지·
main/preload/IPC는 변경하지 않는다. 준비되지 않은 제품 동작은 비활성화하고 가짜 성공/계정/서버 상태를 표시하지 않는다.
후속 UI-02/STUDIO 구현은 별도 배정한다.

`#0`은 전체 총괄로서 설계·작업 분배·검토·진행 문서·Git 통합·통합 검증만 담당한다.
제품 기능 코드는 다른 세션에서 구현한다. 공유 파일의 코드 수정이 필요할 때도 총괄이
담당 구현 세션 하나를 지정하고 그 변경을 검토·머지한다.

구현 세션은 네 개로 나누고 `launcher develop #1`부터 `#4`까지 생성·실행했다.
실제 세션 ID·진행 상태는 진행 문서에서 관리한다.

| 세션 | 장기 담당 영역 | 첫 작업 | 첫 작업 브랜치 |
| --- | --- | --- | --- |
| #1 | 배포 규격·배포 파일 생성·Studio | FMT-01: 배포 규격과 공용 계약 | `feat/fmt-01-contracts` |
| #2 | HTTP·Drive 다운로드·배포 읽기·동기화 | DL-02: HTTP Range 전송 | `feat/dl-02-http-range` |
| #3 | Java·Minecraft 설치·로더·프로세스 관리 | GAME-01: 게임 설치 코어 | `feat/game-01-installer` |
| #4 | Microsoft 인증·서버 상태·사용자 런처 | AUTH-01: Microsoft 인증 코어 | `feat/auth-01-microsoft` |

현재 상태와 실제 착수·완료 여부는 [진행 문서](progress.md)에서 관리한다.
장기 담당은 우선 배정이며 후속 작업을 자동으로 착수하라는 의미는 아니다.

### 모델 배정

사용자 지침에 따라 작업별로 필요한 최소 모델·effort를 선택한다. 총괄의 높은 설정을
모든 구현 세션에 자동 상속하지 않는다. 다음은 이 저장소의 기본 배정 정책이다.

**모델은 세션·담당자별로 고정하지 않는다.** 아래 표와 세션별 배정은 현재 작업의
시작점이며 영구 설정이 아니다. #0은 새 작업 배정 시마다, 같은 작업 안에서도 설계·구현·
검토 단계가 바뀌거나 난도가 달라지면 모델·effort를 다시 판단한다. 예를 들어 인증 담당도
단순 문서 수정에는 Luna·low를 사용하고, writer 담당도 복잡한 경합 검토에는 상향할 수 있다.

- 선택 기준은 작업의 명확성·복잡도·실패 영향·검증 가능성이다. 직전 모델을 관성적으로 유지하지 않는다.
- 어려운 구간에서 상향한 뒤 그 문제가 해결되면 다음 구간에 맞춰 다시 낮춘다.
- #0은 작업 배정·변경 시 선택한 모델·목표 effort·선택 이유를 간단히 기록하고,
  도구로 실제 변경 가능한 설정을 적용한다. 설정이 적용되지 않았다면 그 상태를 구분해 보고한다.

| 작업 성격 | 기본 모델 | 목표 effort |
| --- | --- | --- |
| 문서·진행 관리·작은 수정·확정된 UI 연결 | `gpt-6-luna` | low |
| 명세가 확정된 구현·테스트 | `gpt-6-luna` | medium |
| 인증·프로세스·복구·OS 차이를 포함하는 구현 | `gpt-6.1-sol` | medium |
| 총괄의 일상 조정 | 현재 총괄 모델 | low |
| 경합·데이터 손실·인증 경계 검토, 해결되지 않은 복잡한 오류 | `gpt-6.1-sol` 등 사용 가능한 적합 모델 | 필요한 구간만 high |

- 상향은 특정 문제를 해결하는 동안에만 적용하고 이유를 #0에게 보고한다. 기본적으로 high 이상을 유지하지 않는다.
- Luna 작업도 동일한 검토·통합 검증 기준을 적용한다. 모델 변경으로 기능 범위나 테스트 기준을 줄이지 않는다.
- 상태는 완료·차단·계약 변경 중심으로 전달한다. 전체 소스·대화·문서를 반복 조회하지 않고 변경 부분을 읽는다.
- 테스트는 변경 범위에 맞춰 실행하고, 새 변경·실패·미해결 우려가 없으면 전체 검사를 반복하지 않는다.
- 구현·인계가 끝나면 다음 배정까지 대기한다. 자동으로 추가 에이전트를 만들거나 후속 작업을 시작하지 않는다.
- 모델·effort의 요청과 실제 확인 결과를 구분한다. 현재 Codex spawn 도구는 `fork_turns: none`일 때
  `model`·`reasoning_effort`를 명시할 수 있다. 도구가 세션 이름만 반환하므로 런타임/UI 반영을 확인한 것으로
  기록하지 않는다. 사용자 화면에 다른 값이 보이면 그 보고를 우선하고 설정 불일치를 조사한다.
- 현재 2차 작업의 시작 모델: #1·#2 `gpt-6-luna`, #3·#4 `gpt-6.1-sol`; 네 세션의 목표 effort는 medium이다.
  후속 작업이나 단계 전환 시 이 배정을 그대로 고정하지 않고 재선택한다.
  총괄 목표는 일상 low·중요 검토 시 상향이다. effort는 앱/CLI의 세션 설정에서 적용·확인해야 한다.

### Claude 환경 매핑

GPT(Codex)와 Claude를 번갈아 사용한다. Codex에서는 위 표를, Claude Code에서는 이 매핑을 사용한다.
선택 기준과 재선택 원칙은 같다. **Fable은 사용하지 않기로 사용자가 결정했다.**

| 작업 성격 | 모델 | effort |
| --- | --- | --- |
| 문서·진행 관리·작은 수정·확정된 UI 연결 | Haiku | 기본값 |
| 명세가 확정된 구현·테스트 | Sonnet | medium |
| 인증·프로세스·복구·OS 차이를 포함하는 구현 | Opus | medium |
| 총괄의 일상 조정 | Sonnet | medium |
| 경합·데이터 손실·인증 경계 검토, 해결되지 않은 복잡한 오류 | Opus | 필요한 구간만 high |

- 서브에이전트의 모델은 `Agent` 도구의 `model`로 지정한다. effort는 사용자나 문서가 명시한 경우에만 지정한다.
- 총괄 세션 자신의 모델·effort는 도구로 바꿀 수 없다. 상향이 필요하면 #0이 사유와 함께 사용자에게 요청한다.
- 도구가 바뀌어도 작업 인계는 `docs/handoffs/`와 `docs/tool-handoff.md`로 한다. 이전 도구의 세션 ID·메시징에
  의존하지 않으며 기존 세션의 대화를 읽거나 재개할 필요가 없다.

참고: [공식 OpenAI 모델 안내](https://learn.chatgpt.com/docs/models?surface=app).
이 표는 프로젝트 운영 정책이며 모델별 동일 토큰 수나 일정 절감률을 보장하지 않는다.

## 브랜치와 worktree

기반 코드 기준 커밋은 `4d5b4ab`이다. 실제 착수 기준은 이 배정 문서가 반영된 최신 `main`이며,
각 작업의 인계에 실제 사용한 기준 커밋을 기록한다.

| 세션 | 작업 디렉터리 — 저장소 루트 기준 |
| --- | --- |
| #0 | 저장소 루트, `main` |
| #1 | `.agents/worktrees/agent-1` |
| #2 | `.agents/worktrees/agent-2` |
| #3 | `.agents/worktrees/agent-3` |
| #4 | `.agents/worktrees/agent-4` |

네 구현 브랜치와 worktree는 총괄이 준비한다. 각 세션은 해당 worktree를 작업 디렉터리로
사용하고 먼저 `git branch --show-current`와 `git status --short`를 확인한다.
루트 작업 디렉터리에서 구현하거나 다른 세션의 worktree를 수정하지 않는다.

- 각 worktree에서 `pnpm install --frozen-lockfile`을 실행한다. 다른 worktree의 `node_modules`를 공유하지 않는다.
- 완료한 작업이 머지되면 같은 브랜치에서 다음 작업을 이어가지 않는다. 총괄이 후속 작업의
  브랜치를 최신 `main`에서 준비하거나 재배정한다.
- 초기 개발 서버 포트는 앱별로 고정되어 있다. 같은 앱의 여러 worktree를 동시에 실행해야 하면
  포트 충돌을 총괄과 조정한다.

## 1차 병렬 작업

### #1 — FMT-01: 배포 규격과 계약

수정 범위:

- `docs/deployment-format.md`
- `packages/core/src/deployment/contracts/`와 그 안의 테스트·fixture
- `docs/handoffs/FMT-01.md`

할 일:

- 아키텍처에 맞춰 앞부분 인덱스와 독립 압축 데이터를 담는 단일 파일 규격을 정의한다.
- 포맷 버전, 배포·서버 식별자, 파일 경로·해시·위치·길이·압축 방식·적용 정책을 명세한다.
- 바이트 범위와 길이 제한, 잘못된 입력, 버전 호환성, 배포본 신뢰성 검증 정책을 명확히 한다.
- writer·reader·동기화·Studio가 사용할 최소 계약과 검증 예제를 제공한다.
- 규격 초안을 먼저 총괄에게 인계해 검토받고, 계약·검증 테스트를 작은 첫 변경으로 완성한다.

이번 작업에서는 writer·reader·Studio 화면을 구현하지 않는다. 후속 작업을 시작하기 전에
다른 세션이 참조할 계약을 먼저 `main`에 통합한다.

### #2 — DL-02: HTTP Range 다운로드

수정 범위:

- `packages/core/src/download/http/`와 그 안의 테스트·fixture
- `docs/handoffs/DL-02.md`

할 일:

- 일반 HTTPS 리소스의 특정 바이트 구간을 요청하고 결과를 검증하는 코어를 구현한다.
- `206`, `Content-Range`, 수신 길이, 취소·재시도, 버전 식별자와 원격 파일 변경을 처리한다.
- Range 무시·잘못된 범위·중단·원격 교체를 로컬 HTTP 테스트 서버로 재현한다.
- 후속 reader와 Drive 처리에서 사용할 전송 인터페이스를 먼저 인계한다.

이번 작업에서는 배포 파일 파싱이나 Drive 확인 페이지 처리를 구현하지 않는다.
DL-02 머지 후 같은 세션에 DL-01을 별도 브랜치로 배정한다.

### #3 — GAME-01: Java와 Minecraft 설치

수정 범위:

- `packages/core/src/minecraft/`와 그 안의 테스트·fixture
- `docs/handoffs/GAME-01.md`

할 일:

- 1.21.1을 첫 검증 대상으로 Java·게임·라이브러리·자산 설치 기반을 구현한다.
- OS·아키텍처별 파일 선택, 파일 검증, 설치 취소·실패 처리와 실행 인자 조립 기반을 마련한다.
- 인증 토큰은 외부에서 전달받는 계약으로 두고 인증 구현을 포함하지 않는다.
- 인증 없이 가능한 설치·인자 검증과 실제 계정·서버가 필요한 실행 검증을 구분한다.

공통 HTTP 엔진이 아직 머지되지 않았다면 필요한 네트워크 동작은 주입 가능한 경계로 두고,
다른 영역의 공통 다운로드 엔진을 중복 구현하지 않는다. 이번에는 로더와 보조 모드를 구현하지 않는다.

### #4 — AUTH-01: Microsoft 인증

수정 범위:

- `packages/core/src/auth/`와 그 안의 테스트·fixture
- `docs/handoffs/AUTH-01.md`

할 일:

- Microsoft 앱 등록 조건과 로그인·게임 소유권 확인·세션 갱신·로그아웃 흐름을 확인하고 구현한다.
- 브라우저 실행과 안전한 토큰 저장은 어댑터 경계로 나누고, Electron 연결은 후속 사용자 UI 작업에서 진행한다.
- 게임 실행에 전달할 인증 결과 계약을 먼저 인계해 #3과 맞춘다.
- 실제 앱 등록·사용자 로그인 등 외부 입력이 필요하면 총괄에게 필요한 정보와 검증 상태를 전달한다.
- 모의 응답 테스트와 실제 계정 인증 결과를 구분하고, 자격 증명을 코드·인계 문서에 남기지 않는다.

Google 계정 연동이나 오프라인 계정은 구현하지 않는다. 다른 런처의 앱 ID를 빌려 인증을 완료한 것으로 처리하지 않는다.

## 후속 분배와 통합 순서

| 시점 | #1 | #2 | #3 | #4 |
| --- | --- | --- | --- | --- |
| 1차 | FMT-01 | DL-02 | GAME-01 | AUTH-01 |
| 계약·전송 기반 통합 후 | FMT-02 writer | DL-01 일반 HTTPS·Drive, 이어서 FMT-03 reader | GAME-04 실행·로그 연결, GAME-05 크래시 복구, 이어서 GAME-02·03 로더 | AUTH-02 호스트 어댑터·실계정 검증, UI-01 서버 상태 |
| 배포·게임 코어 통합 후 | STUDIO-01, STUDIO-02 | SYNC-01, USER-01·02·03 | 설치·실행·크래시 복구 통합 검증 | UI-02 사용자 런처 통합 |
| 제품 흐름 연결 후 | STUDIO-03 내보내기 | 다운로드·업데이트 회귀 검증 | 로더·종료 회귀 검증 | 사용자 흐름·오류 처리 회귀 검증 |

후속 표는 작업 순서의 기본안이다. 실제 착수는 진행 문서의 선행 작업과 총괄 배정을 따른다.
1차 머지에서는 AUTH-01·GAME-01을 코어와 모의/fixture 검증 범위로 완료했다.
원래 제품 범위의 실제 인증·실행·로그·크래시 복구는 AUTH-02·GAME-04·GAME-05에 남겼다.
AUTH-02의 실제 인증은 자체 앱·접근 조건·계정과 호스트 어댑터가 필요하며 모의 성공으로 대체하지 않는다.
#4는 실제 로그인·동의·재시작 후 세션 확인 등 사용자 참여가 필요한 시점에 사용자에게
필요한 준비·실행 절차·확인할 결과를 요청하고 #0에도 상태를 알린다. 사용자 로그인은
시스템 브라우저에서 수행하며 비밀번호·인증 코드·토큰을 대화나 인계 문서로 수집하지 않는다.

#2의 DL-01은 Drive 전용 API로 제한하지 않는다. 일반 HTTPS 다운로드 주소와 Google Drive
공유 주소를 받는 공통 진입점을 제공한다. 일반 주소는 공통 HTTPS 전송에 연결하고,
Drive 주소만 전용 공개 링크 해석·확인 페이지 처리를 거친다. 두 경로 모두 DL-02의
Range·응답 검증·취소·원격 교체 검사 정책을 따른다. Range 미지원은 명확히 보고하며
부분 다운로드에 성공한 것으로 처리하지 않는다. 일반 HTTPS 리다이렉트와 Drive 새 버전
교체를 각각 검증한다. 운영자·Google 계정 연동은 추가하지 않는다.

후속 범위의 실제 착수는 아래의 2차 배정과 사용자의 시작 승인을 따른다.
연결 해제 시 게임 자동 종료와 이를 위한 보조 모드는 제외했다. MOD-01·MOD-02는 취소했으며 배정하지 않는다.
작업을 한 브랜치에 누적하지 않고 작업 ID별로 인계·통합한다. 실제 OS 환경이 필요한
BASE-03·04 및 QA-01·RELEASE 작업은 가능한 환경을 확인한 뒤 별도 배정한다.

총괄은 FMT-01 계약을 우선 검토·통합하고, 다른 독립 작업은 준비된 순서대로 검토한다.
계약에 의존하는 구현은 해당 계약이 `main`에 반영된 뒤 시작한다.

## 2차 작업 배정 — 2026-10-21

사용자가 시작을 승인했다. 기존 네 세션과 worktree를 재사용하고 새 작업 브랜치를
이 배정 문서가 반영된 `main`에서 생성한다. 아래 작업만 착수하며 후속 작업은 자동 착수하지 않는다.
#0은 구현하지 않고 검토·통합·진행 기록을 담당한다.

| 세션 | 작업 | 새 브랜치 | 독점 수정 범위 |
| --- | --- | --- | --- |
| #1 | FMT-02 | `feat/fmt-02-writer` | `packages/core/src/deployment/writer/**`, `docs/handoffs/FMT-02.md` |
| #2 | DL-01 | `feat/dl-01-download-sources` | `packages/core/src/download/google-drive/**`, `packages/core/src/download/source/**`, `third-party/gdown/**`, `docs/handoffs/DL-01.md` |
| #3 | GAME-04 | `feat/game-04-runtime` | `packages/core/src/minecraft/**`, `packages/core/src/download/full/**`, `docs/handoffs/GAME-04.md` |
| #4 | AUTH-02 | `feat/auth-02-host-adapters` | `apps/launcher/src/main/auth/**`, `scripts/auth-smoke.mjs`, `packages/core/package.json`의 `./auth` export만, `docs/handoffs/AUTH-02.md` |

각 범위 안의 테스트·fixture는 해당 세션 소유다. 다른 공유 파일·기존 계약·HTTP 엔진·IPC·
앱 진입점·renderer·lockfile 변경은 먼저 #0에 요청한다. #4만 공통 manifest의 auth export를
추가할 수 있다. 공개 export가 아직 없는 다른 모듈은 내부 상대 import로 검증한다.

### #1 — FMT-02: 단일 배포 파일 writer

- 확정된 v1 계약을 재사용해 입력 파일·정책에서 해시, 인덱스, 독립 gzip/비압축 데이터를 생성한다.
- NFC 경로 정규화 후 충돌·심볼릭 링크·경로 탈출·규격 제한을 검사한다. 입력 변경 중 생성도 안전하게 처리한다.
- 대용량 전체를 메모리에 모으지 않으며, 임시 파일을 사용해 취소·실패 시 기존 결과물을 보존한다.
- 작은 독립 검증기로 헤더·인덱스 해시·바이트 범위·압축 해제 결과를 확인한다. 제품 reader와 Studio는 구현하지 않는다.

### #2 — DL-01: 일반 HTTPS·Drive 다운로드 소스

- 일반 HTTPS 주소와 공개 Drive 공유 주소를 받는 공통 소스 인터페이스를 먼저 제안한다.
- 일반 링크는 DL-02를 재사용하고 Drive만 공개 주소 해석·확인 페이지·쿠키 등 필요한 처리를 적용한다.
- gdown 이식 부분의 MIT 고지와 정확한 원본 커밋을 `third-party/gdown/`에 기록한다. Google 계정 연동은 없다.
- 리다이렉트·페이지 크기·호스트·민감한 헤더/쿠키 범위·취소를 검증한다. Range 미지원은 명확히 실패한다.
- 만료 주소 갱신 시 이전 요청을 취소·종료한 뒤 다시 인덱스를 읽도록 계약화해 다른 배포본의 구간을 섞지 않는다.
- 일반 HTTPS와 Drive 모의 응답을 구분하고 실제 Drive 링크·버전 교체가 필요하면 사용자에게 요청한다.
  자동·수동 증거가 없으면 실제 Drive 업데이트 성공으로 기록하지 않는다. 배포 reader는 다음 작업이다.

### #3 — GAME-04: 전체 다운로드·설치·프로세스 관리

- 전체 HTTPS 응답용 어댑터를 추가해 기존 설치기의 취소·수신 상한·안전한 리다이렉트·재시도 계약을 충족한다.
- shell 없이 Java를 실행하고 시작 실패·종료 코드·취소·실행 중 서버 데이터 잠금을 관리한다.
- stdout/stderr를 제한된 로그로 수집하고 토큰을 제거한다. 계정 정보·원본 argv는 로그로 남기지 않는다.
- 1.21.1 실제 설치와 설치된 Java 실행을 검증하고 네트워크 다운로드량·필요 환경을 인계한다.
  인증된 게임 접속은 AUTH-02와 로더 연결 후 검증하며 mock을 실제 접속으로 기록하지 않는다.
- 설치 크래시 자동 복구(GAME-05), 로더·구버전 설치·보조 모드·UI는 이번 범위가 아니다.

### #4 — AUTH-02: 브라우저·OS 안전 저장 어댑터

- AUTH-01에 맞춰 loopback listener를 먼저 바인딩하고 시스템 브라우저를 연다. 콜백 제한·취소·시간 초과 시 자원을 해제한다.
- Electron main 프로세스에서 OS 암호화 저장을 사용하고 원자적으로 기록한다. Linux에서 안전한 backend가
  없으면 평문 fallback 없이 실패한다. 테스트 가능한 경계와 실제 Electron 검증용 harness를 제공한다.
- 아직 제품 UI/IPC는 연결하지 않는다. harness는 client ID를 명시적으로 받아 로그인·재시작·갱신·로그아웃을 확인한다.
- 사용자 참여가 필요한 시점에 준비 사항·실행 절차·확인 결과를 사용자에게 직접 요청하고 #0에도 알린다.
  비밀번호·인증 코드·토큰을 채팅에 요청하지 않는다. 실제 계정 검증이 남으면 AUTH-02 전체 완료로 보고하지 않는다.

## 공유 파일 변경과 검토 규칙

### AUTH-03 — 임시 공개 Java Title ID 인증

사용자가 자체 앱 ID의 API 승인·연결을 최종 단계로 미루고 임시 공개 ID 사용을 승인했다.
이는 기존의 자체 앱 ID만 사용한다는 정책에 대한 명시적 변경이다. AGENTS.md의 기존 문구보다
이후 사용자 지시를 우선하며, 최종 배포 전 자체 앱 ID 전환·승인을 별도 추적한다.

#4 단독 담당, 최신 main의 `feat/auth-03-public-java`를 사용한다. 프로토콜·수명주기·암호화
캐시 설계는 Sol로 진행하고, 계약이 확정된 단순 수정은 작업별로 Luna 전환을 재평가한다.
다른 세션은 병렬 착수하지 않는다. 먼저 최소 설계·라이브러리 경계·취소 방식을 #0에 알린다.

독점 범위:

- `apps/launcher/src/main/auth/**`, `scripts/auth-smoke.mjs`
- `apps/launcher/package.json`, `pnpm-lock.yaml`의 필요한 의존성 변경
- 필요한 worker 진입점 출력을 위한 `apps/launcher/electron.vite.config.ts`
- 필요한 경우 공유 `MinecraftAuthResult` 설명·export만 `packages/core/src/auth/contracts.ts`, `index.ts`
- `docs/handoffs/AUTH-03.md`, `third-party/prismarine-auth/**`

완료 기준과 제한:

- 공개 Java Title ID `00000000402b5328`에 맞는 Device Code·장치/Title/SISU 흐름을 지원한다.
  자체 앱용 PKCE 코드의 ID 검증만 느슨하게 바꾸거나 다른 승인 앱으로 자동 우회하지 않는다.
- 유지보수되는 MIT `prismarine-auth` 등 실제 공개 구현을 검토해 재사용한다. 버전을 고정하고
  정확한 의존성과 라이선스를 기록한다. LGPL Java 코드를 무고지로 이식하지 않는다.
- 개발 중 기본 경로는 임시 public-java, 기존 own-app 경로는 명시적으로 선택 가능하게 보존한다.
  own-app의 실패 후 public-java로 숨은 fallback을 하지 않는다. renderer·제품 UI 연결은 이번 범위가 아니다.
- 기존 실행용 인증 결과 계약에 맞춰 유효한 Minecraft 토큰·만료·Java 소유권·프로필을 확인한다.
  정품 계정 흐름을 유지하고 오프라인 계정은 추가하지 않는다. 라이브러리 응답만 믿고 소유권 검사를 생략하지 않는다.
- 기본 파일 캐시를 사용하지 않는다. 제공되는 cache factory로 장치 키·refresh/access 토큰 등
  모든 캐시를 OS 암호화 저장에 연결하고 자체 앱 저장소와 분리한다. 로그아웃 후 늦은 쓰기·세션 복구를 막는다.
- 라이브러리에 중단 가능한 transport가 없으면 별도 프로세스 등으로 취소·시간 제한과 정리를 보장한다.
  토큰·원본 오류·임시 인증 URL은 로그/진단 JSON으로 노출하지 않는다. debug 출력도 통제한다.
- Device Code는 로컬 사용자 안내에만 사용하고 채팅/인계/fixture에 남기지 않는다. 시스템 브라우저에서 로그인한다.
- smoke 도구로 첫 로그인·재시작 후 갱신·로그아웃·빈 캐시 확인을 재현한다. 취소·저장 실패·늦은 쓰기·
  redaction·소유권/프로필 부재·기존 own-app 경로 보존을 테스트한다.
- 사용자 실계정 검증이 필요하면 #0에 준비 상태와 정확한 Windows 명령을 전달한다. 라이브 성공은 모의 테스트로 대체하지 않는다.
- 공유 파일은 이 작업에서 #4만 수정한다. 다른 범위가 필요하면 #0에 요청하고 자동으로 넓히지 않는다.

### AUTH-02 Minecraft 403 진단 보완

사용자 승인으로 #4가 최신 main의 `fix/auth-02-minecraft-rejection` 브랜치에서 진행한다.
조사는 Sol, 아래처럼 확정된 국소 구현·테스트는 Luna를 사용한다. 대상은
`packages/core/src/auth/microsoft.ts`, 같은 디렉터리의 인증 테스트,
`docs/handoffs/AUTH-02-diagnostics.md`다. 기존 error code를 재사용하고 public 계약·IPC·
앱 설정·엔드포인트·로그인 요청 방식은 변경하지 않는다.

- Minecraft 단계 HTTP 403 응답에 명시적인 알려진 `Invalid app registration` 메시지가
  있는 경우만 기존 `app_registration_rejected` code로 분류한다.
- 일치하는 서버 메시지의 허용 형태를 좁게 정의한다. 다른 403, 다른 단계, 잘못된/HTML 응답은
  기존 일반 실패로 유지한다. 임의 provider 문자열·본문·토큰·URL을 진단 출력에 추가하지 않는다.
- 명시 메시지·비일치·위장된 유사 문자열·민감 데이터 미노출을 테스트한다. 기존 취소·크기 상한을 유지한다.
- 기존 smoke 도구는 error code를 이미 출력하므로 새 product UI나 별도 raw diagnostic 도구는 추가하지 않는다.
- 필요한 검사 후 인계하며 #0 통합 후 사용자에게 Windows 재실행 절차를 전달한다.
  분류 결과 전에는 앱 접근 승인 문제가 실제 원인이라고 확정하거나 승인 경로를 추정해 안내하지 않는다.

### DL-01 실환경 검증 추가 배정

사용자 제공 공개 Drive 파일로 #2가 익명 다운로드·실제 Range를 검증한다.
브랜치는 최신 main에서 `test/dl-01-live-drive`, 기존 agent-2 worktree를 사용한다.
수정 범위는 기존 DL-01 소유 경로와 `docs/handoffs/DL-01-live.md`다.
재현 harness와 안전한 영수증은 해당 소스 범위의 test/fixtures에 둔다. 모델은 이 범위가
명확한 검증과 필요 시 국소 수정이므로 Luna를 선택한다. 프로토콜 설계 변경이 필요하면 #0에 알린다.

- 소스 factory를 통해 첫 구간·중간·끝·반복 구간을 읽고 실제 206·총 길이·해시 일관성을 확인한다.
- 필요한 경우 크기를 먼저 확인한 뒤 제한된 전체 비교를 수행한다. signed URL·쿠키·파일 내용은 출력·커밋하지 않는다.
- 파일 교체 전 현재 버전의 영수증을 저장하고 #0에 결과를 알린다. 교체는 사용자에게 #0이 요청한 후 진행한다.
- 새 버전 검증은 기존 소스의 교체 감지와 reset 후 같은 공유 링크의 새 데이터 확인을 구분한다.
- 실패 시 원인과 실제 응답을 안전하게 기록하고, 코드 수정은 기존 독점 범위에서 테스트 후 인계한다.
- 검증 완료·수정 커밋을 보고하고 main에는 직접 머지하지 않는다.

- 루트 설정, dependency manifest·lockfile, 공개 export, 공용 IPC 계약을 여러 세션이 동시에 수정하지 않는다.
- 변경이 필요한 세션은 파일·이유·영향 범위를 요청한다. 총괄이 한 세션에 해당 파일의 수정 권한을 배정한다.
- 총괄이 요청된 제품 코드를 대신 구현하지 않는다. 승인된 구현 세션이 변경과 검증을 커밋해 인계한다.
- `docs/progress.md`, 배정 문서와 총괄 운영 규칙은 #0이 관리한다.
- 작업별 인계 문서에는 실제 세션 이름·브랜치·기준 및 최종 커밋·파일 범위·검증 명령·결과·미검증 사항을 적는다.
- 작업 완료 또는 총괄 판단이 필요한 요청은 #0 세션에 메시지로 알린다. 다른 세션의 최종 응답만으로
  총괄에게 완료가 전달됐다고 가정하지 않는다. 다음 작업은 총괄의 재배정을 기다린다.
- 검증 후 관련 기능을 최신 통합 상태에서 다시 확인하고, 총괄이 완료 여부를 판단한다.

## 새 세션에 전달할 시작 지시문

## GAME-02 / GAME-03 착수 — 2026-10-21

사용자 승인으로 실제 1.21.1 NeoForge 설치·실행·서버 직접 접속을 먼저, Fabric을 이어서 구현한다.
#3 단독 담당, 브랜치 `feat/game-02-03-loaders`, worktree `.agents/worktrees/agent-3`.
설치 프로세스·OS 차이·실행 차단 경계 때문에 Sol, 목표 effort medium(실제 설정 변경은 미확인).
구현 기준은 [game-launch.md](game-launch.md)이며 다른 구현 세션은 이번에 착수하지 않는다.

독점 범위:

- `packages/core/src/loaders/**`, 기존 `packages/core/src/minecraft/**`의 필요한 설치·메타데이터·실행 변경과 테스트.
- read-only 실행 검증에 한해 `packages/core/src/instance/sync/launch-guard.ts`,
  `launch-guard.test.ts`, `index.ts`의 해당 export 추가. 기존 sync engine/state/safety는 읽기만 한다.
- `apps/launcher/src/main/game-smoke/**`, `scripts/game-smoke.mjs`, `docs/handoffs/GAME-02-03.md`.
- 공용 package manifest/export·lockfile·앱 빌드 설정·인증 구현은 변경 전에 #0에 요청한다.
- 사용자 테스트 서버 보호를 위한 `.gitignore`의 `.testserver/`와 `biome.json`의 해당 제외 규칙은
  #3 단독으로 추가하도록 범위를 확장했다. `.testserver/` 자체는 읽기만 하며 구성·프로세스를 변경하지 않는다.

루트/인증 테스트와 별도로 실행 가능한 게임 smoke를 준비한다. 접속 직전 최신 배포 확인과
always 파일 검증이 실패하면 spawn을 금지하며 캐시 우회 옵션은 제공하지 않는다.
실제 서버·계정·추가 배포 파일 업로드 요청은 실행 절차가 준비되면 #0에게 전달한다.
설치 성공·모의 테스트와 실계정 서버 접속 성공을 분리해 인계한다.

## 배포 reader → 동기화 엔진 착수 — 2026-10-21

사용자 승인 범위는 FMT-03을 구현·통합한 뒤 SYNC-01을 이어서 구현하는 것이다.
실파일 업로드가 필요한 시점에는 #0이 생성된 테스트 파일과 절차를 준비해 사용자에게 요청한다.
다른 로더·UI·Studio 작업은 이번에 착수하지 않는다.

### FMT-03 — #2

- 최신 main에서 `feat/fmt-03-reader`를 준비한다. 독점 범위는
  `packages/core/src/deployment/reader/**`, `docs/handoffs/FMT-03.md`다.
- 모델은 명세가 확정된 reader 구현이므로 Luna, 목표 effort medium이다. 실제 effort 설정은 도구로 변경하지 못한다.
- 기존 계약·writer·DownloadSource를 재사용한다. 64-byte 헤더 u64 안전 변환,
  strict UTF-8/BOM/중복 JSON 키 거부, 원본 인덱스 SHA-256·서버 ID·컨테이너 길이를 검증한다.
- 열린 reader는 검증 결과를 외부 변경으로부터 보호한다. 모든 구간에 동일 소스·generation·snapshot을 적용하고,
  버전 변경·reset·취소 시 실패한다. 자동 reset/재시도하여 한 배포에 다른 버전을 섞지 않는다.
- 파일별 payload는 작은 Range들로 읽어 메모리를 제한하고 caller가 지정한 새 임시 파일에 기록한다.
  빈 파일, none, gzip 단일 member를 지원한다. gzip CRC·trailer·후속 member/데이터·출력 길이·SHA-256을 확인한다.
  검증 전 게임 파일을 수정하지 않으며 실패한 자기 임시 파일만 정리한다. 로컬 운영 예산은 규격보다 낮게 설정 가능하다.
- writer→reader roundtrip과 손상·과대 입력·동시 reset·취소·범위 선택·gzip 오류를 행동 테스트한다.
  실환경 모의 검사를 실제 Drive 검증으로 기록하지 않는다. 공유 manifest/export 변경은 먼저 요청한다.

### SYNC-01 — FMT-03 통합 후 #2

- reader 통합 후 `feat/sync-01-engine`로 배정한다. 독점 범위는
  `packages/core/src/instance/sync/**`, `docs/handoffs/SYNC-01.md`다.
  상세 동작은 [synchronization.md](synchronization.md)를 따른다.
  모델은 파일 소유권·복구·OS 차이 때문에 Sol, 목표 medium이다(실제 effort 변경은 미확인).
- 운영자 관리 목록·변경 비교·검증된 staging·적용·이전 always 파일 삭제·실패 복구를 구현한다.
  같은 서버 데이터 잠금으로 실행/설치와 경합을 막는다. symlink/hardlink·보호 경로·다른 서버 ID를 거부한다.
- 미등록 파일은 소유권으로 편입하지 않는다. 충돌은 보존하고 명시 오류로 반환한다.
  initial-only는 최초 성공한 환경 구성에서만 제공하고 이후 수정·삭제·배포 누락을 보존한다.
  같은 경로 정책 전환은 이번에 거부한다. 혼합 설정·모드 ID 관리는 USER 작업으로 남긴다.
- 시작 시 남은 transaction을 검사하고, 실패·중단 후 복구할 수 있는 journal/backup을 둔다.
  전체 검증 전 기존 환경은 변경하지 않는다. 관리 목록도 같은 transaction으로 반영한다.
- 실제 사용자 파일 손실을 막는 테스트와 writer→source→reader→sync 통합 fixture를 포함한다.
  구체적인 API·보호 경로·복구 규칙은 착수 전에 #0이 확정하고 추가 기록한다.

아래에서 번호만 바꿔 각 세션에 전달한다. 각 번호의 구체적인 첫 작업과 수정 범위는 위 절을 따른다.

```text
너는 TorchLauncher 구현 세션 #N이다. #0은 총괄이며 구현은 하지 않는다.
저장소 루트가 아니라 .agents/worktrees/agent-N을 작업 디렉터리로 사용해라.
그 worktree의 AGENTS.md, docs/architecture.md, docs/work-distribution.md와
docs/progress.md를 읽고, 배정된 첫 작업만 구현해라.
브랜치와 작업 트리가 배정과 일치하는지 확인하고 의존성은 frozen-lockfile로 설치해라.
수정 범위를 지키고, 공유 파일·추가 의존성 변경은 #0에 요청해라.
progress.md를 수정하거나 main에 머지하지 마라.
테스트 후 작업 브랜치에 커밋하고 docs/handoffs/<작업-ID>.md로 결과를 인계해라.
인계 문서에 최종 커밋 자체를 기록하면 자기 참조가 되므로, 최종 커밋 해시는
커밋을 만든 뒤 세션의 최종 응답에도 별도로 알려라.
```

## USER-01 / USER-02 / USER-03 코어 착수 — 2026-10-21

사용자 승인 범위는 이 세 작업의 **코어 기능**뿐이다. renderer·IPC·앱 연결(UI-02)과 다른 작업은 착수하지 않는다.
각 모듈은 나중에 UI/IPC가 호출할 수 있게 Electron·UI에 의존하지 않는 비동기 API, 타입이 있는 결과·오류 코드,
`AbortSignal`·진행 콜백을 제공한다. 세 작업은 서로 독립된 디렉터리를 독점하며 공유 파일(패키지 export, 기존 sync 구현,
lockfile, manifest)은 수정하지 않는다. 각 모듈의 `index.ts`까지만 만들고 상위 export 연결은 #0이 통합 때 한다.
모델: USER-01·02 Sonnet medium, USER-03(삭제·데이터 손실 경계) Opus medium. 문제가 어려우면 보고 후 #0이 상향한다.
공통 규칙: 서버 데이터 변경은 모두 `acquireServerDataLock(root, 'maintenance')` 아래에서 하며 게임 실행·설치 중에는 실패한다.
사용자 상태는 예약 경로 `.torchlauncher-user/` 아래(USER-01 `mods.json`, USER-02 `settings.json`)에 두고 원자적으로 쓴다.
`.torchlauncher*` 접두 경로는 sync가 이미 보호한다. 외부 입력 경로는 전부 검증하고 symlink/hardlink/경로 탈출을 거부한다.

| 작업 | 브랜치 / Worktree | 독점 수정 범위 |
| --- | --- | --- |
| USER-01 | `feat/user-01-mods` / `agent-1` | `packages/core/src/instance/mods/**`, `packages/core/src/instance/sync/ownership.ts`·`ownership.test.ts`(읽기 전용 소유권 조회 신설), `docs/handoffs/USER-01.md` |
| USER-02 | `feat/user-02-settings` / `agent-2` | `packages/core/src/instance/settings/**`, `docs/settings-policy.md`, `docs/handoffs/USER-02.md` |
| USER-03 | `feat/user-03-data` / `agent-3` | `packages/core/src/instance/data/**`, `docs/handoffs/USER-03.md` |

- **USER-01 정책:** 사용자 모드는 `.jar`만, 대상은 `mods/<파일명>`. 운영자 관리 경로와 같거나 내용이 다른 기존 파일이 있으면 `path-conflict`로 거부.
  jar 안의 모드 ID(Fabric `fabric.mod.json`, NeoForge `META-INF/neoforge.mods.toml`)를 크기·개수 상한이 있는 안전한 방식으로 읽고,
  운영자 모드나 다른 사용자 모드와 ID가 같으면 `mod-id-conflict`로 거부(ID를 못 읽으면 경고와 함께 등록은 허용).
  `mods/`의 미등록 파일은 자동 분류·삭제하지 않고 목록으로 표시하며, 사용자가 명시적으로 편입하거나 삭제할 수 있다.
  등록·삭제는 복구 가능한 순서(임시 복사→rename→registry 원자적 갱신, 중단 후 재시작 시 정합성 복구)로 하고 sync가 사용자 모드를 건드리지 않음을
  기존 sync API로 통합 테스트한다. `ownership.ts`는 sync 원장을 읽기 전용으로 읽어 `{ serverId, deploymentId, initialized, files:[{path,policy,sha256,length}] }`를 반환한다.
- **USER-02 정책:** sync 소유권 조회는 위 형태의 인터페이스를 **주입**받아 가짜 구현으로 테스트한다(USER-01의 구현과 직접 결합하지 않음).
  운영자는 일반 `always` 파일로 `torchlauncher/settings-policy.json`(v1 스키마는 `docs/settings-policy.md`에 정의)을 배포하고,
  코어가 이를 읽어 Minecraft `options.txt`에 항목별 규칙을 적용한다: `required`(키 값을 매번 강제, 나머지 키·순서·줄바꿈 보존),
  `initial`(최초 구성에서 한 번만 설정하고 이후 사용자 변경 보존, 적용 기록은 `settings.json`). 리소스팩은 `options.txt`의 `resourcePacks`
  목록으로 관리한다: 필수 팩은 항상 활성화·상대 순서 유지, 사용자가 추가한 팩과 순서는 보존, 최초 기본 목록은 initial 규칙. `options.txt` 자체는
  동기화 `always` 대상이 아니어야 함을 문서화하고, 위반 구성(정책 파일이 `options.txt`를 `always`로 배포)은 명시 오류로 거부한다.
  파일 전체 덮어쓰기는 하지 않는다. 손상·과대·중복 키 정책 파일은 안전하게 거부.
- **USER-03 정책:** 서버별 데이터 루트 해석(`<userDataBase>/servers/<serverUuid>`, 서버 UUID v4 검증), 루트 소유 표식 파일, 디스크 사용량 계산
  (symlink를 따르지 않는 상한 있는 순회, 취소 가능), 삭제 전 미리보기(대상 경로·용량·파일 수·실행 중 여부)와 실제 삭제.
  삭제는 maintenance 잠금을 얻어 실행 중이면 거부하고, 표식이 있는 정확한 서버 루트만 삭제하며 base/다른 서버/기존 `.minecraft`/인증 데이터 디렉터리/
  symlink·junction 대상은 절대 건드리지 않는다. 잠금 디렉터리 자체와 삭제 도중 중단 후 재시도를 처리한다.

## 런처 UI 재작성 L1 착수 — 2026-10-22

사용자 승인으로 런처 UI 재작성을 시작한다. 기준은 [런처 UI 명세](launcher-ui.md)와 [시안 소스](design/launcher/README.md). 한 번에 한 단계만 진행한다.

| 작업 | 담당 / 브랜치 / worktree | 모델 | 독점 수정 범위 |
| --- | --- | --- | --- |
| L1 | #1 / `feat/launcher-ui-shell` / `agent-1` | Sonnet medium (막히면 #0이 상향) | `apps/launcher/src/renderer/**`, `apps/launcher/src/main/index.ts`의 창 설정(제목·아이콘·배경색만), `apps/launcher/scripts/renderer-functional-smoke.mjs`, 루트 `scripts/smoke.mjs`의 **런처 부분만**, 번들 글꼴 자산과 라이선스 고지, `docs/handoffs/LAUNCHER-UI-L1.md` |

IPC 계약·preload·product service·core·Studio·package manifest·lockfile 변경이 필요하면 수정하지 말고 인계에 요청으로 적는다.

## 런처 UI L2b 착수 — 2026-10-22

L2를 둘로 나눈다. L2b(메인 프로세스·상태 계약)를 먼저 통합한 뒤 L2a(렌더러 페이지)를 시작한다. 기준은 [런처 UI 명세](launcher-ui.md)의 "동작 변경"과 "설치·확인 진행 표시 결정".

| 작업 | 담당 / 브랜치 / worktree | 모델 | 독점 수정 범위 |
| --- | --- | --- | --- |
| L2b | #3 / `feat/launcher-l2b-automation` / `agent-3` | Sonnet medium (안전 판단 문제가 생기면 #0이 상향) | `apps/launcher/src/main/product/**`, `apps/launcher/src/shared/product.ts`, 상태 형태 변경에 따른 렌더러의 **컴파일 유지용 최소 수정**, `docs/handoffs/LAUNCHER-L2B.md` |

## 런처 UI L2a 착수 — 2026-10-22

L2b 통합(`e950189`, 로그 출처·복구 자동화·세션) 후 L2a(렌더러)를 시작한다. 확인 창 정책 결정: 서버 데이터 **삭제**는 메인 프로세스의 네이티브 확인을 최종 안전장치로 유지하고, **복구 확인**은 앱 안의 확인 창(체크박스 필수)만 쓴다(네이티브 이중 확인 제거).

| 작업 | 담당 / 브랜치 / worktree | 모델 | 독점 수정 범위 |
| --- | --- | --- | --- |
| L2a | #1 / `feat/launcher-l2a-pages` / `agent-1` | Sonnet medium | `apps/launcher/src/renderer/**`, 복구 네이티브 확인 제거에 필요한 `apps/launcher/src/main/index.ts`·`main/product/service.ts`의 해당 호출부만, `apps/launcher/scripts/renderer-functional-smoke.mjs`, 루트 `scripts/smoke.mjs`의 런처 부분, `docs/handoffs/LAUNCHER-UI-L2A.md` |

## MEM-01: 게임 메모리 설정 (Xmx/Xms) — 통합 검사 완료, Windows 확인 대기 (2026-10-23, #0 Codex)
사용자 결정: 플레이어 개인 설정으로 최대 메모리(Xmx)와 초기 메모리(Xms)를 설정할 수 있게 한다. 운영자 권장값은 Studio 단계로 미룬다.
- 현재: 코어 `buildLaunchArguments`(`packages/core/src/minecraft/launch.ts`)는 `maxMemoryMiB`(기본 2048, 512~65536 검증)만 받아 `-Xmx`로 넘긴다. **`-Xms`는 없다**(코어 확장 필요). 런처 앱은 값을 넘기지 않고, 개인 설정·UI도 없다.
- 범위: (1) 코어: `initialMemoryMiB` 옵션 추가(`-Xms`, Xmx 이하·최소 256 MiB 검증, 미지정이면 인자를 넣지 않음), (2) 개인 설정 스키마에 두 값 추가와 정규화(저장 형식은 기존 개인 설정 방식 유지), (3) 서비스가 launch에 값을 전달, (4) 설정 페이지 "게임 메모리" 카드: 최대/초기 입력(GB 단위, 0.5 GB 간격 권장), 초기 ≤ 최대, 물리 메모리(`os.totalmem`) 약 75% 초과 시 경고, 실행 중 변경은 "다음 실행부터 적용" 안내, (5) 문구는 i18n 사전, 테스트(코어 인자 생성, 설정 정규화, 서비스 전달, 렌더러 입력 검증).
- 기본값: 최대 2048 MiB 유지(미설정), 초기 미설정. 상한은 코어 상한과 물리 메모리 중 작은 값.
- 모델: Sonnet. 코어·공용 계약·IPC 변경이 있으므로 한 작업자가 코어 + 런처 설정 전체를 맡는다. L3보다 먼저 통합한다(렌더러 설정 페이지 공유).

사용자 배정안 승인 후 작업자 한 명 착수: #1 `mem_01`, `gpt-6-luna` medium (도구 설정 적용),
`feat/mem-01-game-memory` / `.agents/worktrees/agent-1`, 제품 기준 `cdabfb2`.
독점: `packages/core/src/minecraft/launch.ts`·`launch.test.ts`,
`packages/core/src/loaders/launch-gate.ts`·관련 테스트, 런처 `main/product/preferences.ts`·`service.ts`와
관련 테스트/메모리 helper, `shared/product.ts`·해당 IPC 테스트, renderer `pages/Settings.tsx`·메모리
입력 helper/관련 테스트·`i18n/catalog.ts`, 관련 smoke의 메모리 검증에 필요한 최소 변경,
`docs/handoffs/MEM-01.md`. 현재 실행 인자는 시작 시 고정하며 이후 저장은 다음 실행에만 반영한다.
실행 중 개인 설정 저장에 필요한 직렬화 변경은 최소 범위로 먼저 검토하며 프로세스 수명/잠금 동작은 변경하지 않는다.
Studio·L3·L2a 후속·새 의존성·루트 설정·lockfile·추가 작업자 착수는 승인 범위 밖이다.
#0은 검토·--no-ff 통합·main pnpm check·진행 기록 및 Windows 사용자 확인 요청을 담당한다.
검토 중 최소 연동 범위 추가 승인: renderer `hooks/useProduct.ts`(실행 중 메모리 저장 명령만 허용),
`fixtures.ts`·`labels.ts`(상태/오류 연동), `styles.css`의 메모리 입력 기본 배치만. UI 재설계는 하지 않는다.

설계 검토 확정: 메모리 저장만 개인 설정 전용 직렬화로 처리하며 기존 Operations·프로세스 수명은 유지한다.
실행 시작 때 모든 개인 설정을 한 번 고정하고 이후 저장은 다음 실행에 반영한다. closeOnLaunch 변경의
기존 busy 규칙은 유지한다. 물리 RAM이 2048 MiB보다 작은 경우에도 미설정 Xmx 기본값을 몰래 낮추지 않는다.
UI에서 더 낮은 유효값 저장을 안내하고 실행은 설치 전에 메모리 오류로 차단한다. 다른 머신에서 저장한
값이 현재 물리 RAM을 초과하더라도 전체 개인 설정 손상으로 취급하거나 closeOnLaunch를 초기화하지 않는다.

결과: 작업자 `a2f81b1`을 #0이 `91d47c9`로 --no-ff 통합. main `pnpm check` 성공:
911개 통과·9 skip·전체 타입/두 앱 빌드/Biome(기존 CSS 경고 8개). 작업자 관련 79개와 Electron
기능 smoke도 성공. agent-1은 통합 main에 detached, 작업 브랜치 삭제, 다른 worktree 미변경.
실계정·게임·Windows 검증은 하지 않았으며 사용자 확인을 요청한다. L3/L2a 후속 배정 승인 전 대기한다.

### MEM-01 입력 후속 — 사용자 승인 (2026-10-23)

#1 `memory_scrub`, Luna medium, agent-1 `feat/mem-01-scrub-input`, baseline `f1b3286`.
사용자 요청: 0.5GB 단위 권장 문구 제거, 숫자 input 스피너 제거, 좌우 드래그로 메모리 조절,
메모리 저장 성공의 ‘저장했습니다’ 문구 제거. 직접 입력·유효성 검사·명시 저장·실패 안내는 유지한다.
독점: renderer `pages/Settings.tsx`, 새 메모리 입력 component/helper/관련 테스트,
`pages/memory.ts`·테스트, `styles.css` 해당 입력만, `i18n/catalog.ts` 관련 문구,
`pages.test.ts`, `apps/launcher/scripts/renderer-functional-smoke.mjs` 메모리 부분,
`docs/handoffs/MEM-01-INPUT.md`. main/core/IPC/다른 페이지·L3 작업은 제외한다.
전역 텍스트 선택·끌기 차단은 유지하며 입력의 pointer 조절만 한정 허용한다. click/keyboard 직접 입력,
좌우 조절·범위·disabled·pointer cancel/unmount 정리·저장 전 반영 안 됨을 실제 화면 검사한다.
추가 사용자 요청: 플레이 탭의 ‘최근 결과’ 표시 제거. 같은 작업자가 `pages/Home.tsx`의 해당 표시와
관련 import/미사용 사전 키·화면 검증만 소유한다. 내부 outcome/로그·오류/진행/복구 표시는 유지한다.
결과: `717ae43` 및 문서 후속 `e7a207d` 통합. main 전체 검사 성공(913개/9 skip, 타입/Biome/두 앱 빌드).
작업자 24개 renderer 테스트와 Electron 실제 pointer smoke 성공. agent-1 detached, 병합 브랜치 삭제.
Windows 입력 사용감과 실제 게임 메모리 검증은 사용자 확인 대기다. L3/L2a 후속은 시작하지 않는다.

### MEM-01 좌우 드래그 제거 — 사용자 요청 (2026-10-23)

#1 `memory_no_drag`, Luna low, agent-1 `fix/memory-input-no-drag`, baseline `fb5ca70`.
좌우 드래그 기능만 제거하고 일반 숫자 입력으로 복귀한다. 스피너 숨김·권장/저장 성공 문구 제거·
플레이 최근 결과 제거·직접 입력/검증/명시 저장은 유지한다. 독점: renderer Settings 입력 component와
메모리 helper/테스트, styles.css 해당 입력, 관련 pages.test 및 앱 renderer smoke,
`docs/handoffs/MEM-01-NO-DRAG.md`. main/core/IPC/i18n 문구 변경·다른 기능은 제외한다.
드래그 전용 코드/커서/이벤트 캡처/테스트는 정리하고 기존 직접 입력·저장/실패 검증을 유지한다.
`4179715` 통합, main 전체 검사 성공(912개 통과·9 skip, 타입/Biome/두 앱 빌드), 작업자 renderer
23개와 Electron smoke 성공. agent-1 main detached·병합 브랜치 삭제. 저장·표시 정책은 그대로다.
