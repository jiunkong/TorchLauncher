# TorchLauncher 개발 진행 관리

최종 갱신: 2026-10-23

이 파일을 작업 상태·담당·머지 현황의 기준으로 사용한다. 제품 요구사항은
[아키텍처](architecture.md), 단계의 목적과 완료 기준은 [구현 순서](implementation-plan.md)를 따른다.

## 현재 상태와 다음 작업

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

사용자가 브랜딩 **동봉 초기본+torchpack 원격 갱신을 모두 승인**했다. 기존 이미지 표시 중 변경분만
검증/수신 후 자연스럽게 전환한다. [혼합 전달 명세](operator-branding-hybrid.md).
BRAND-CORE-01 #1 `branding_contracts` Sol medium 요청, agent-1 `feat/branding-contracts`로 공용 계약부터 진행한다.
동시 작업자는 한 명이며 이후 런처/Studio를 순차 연결한다. 게임 소유권/필수 동기화와 이미지는 분리한다.

운영자 브랜딩 조사 BRAND-PLAN-01 완료: #1 `branding_proposal` Luna medium 요청의 `07c3d0f`·`d080084`를
#0이 검토·통합했다. [선택지/계약 제안](operator-branding-proposal.md)에 동봉/torchpack/별도 URL,
업데이트·오프라인·검증·호환성 영향을 기록했다. 작은 이미지를 JSON 옆에 동봉하는 안을 우선 권고하되
원격도 게임 설치 전 별도 startup/cache 흐름으로 가능하다. 기존 torchpack 형식 확장이 필수는 아니다.
현재 Studio는 폴더 내보내기만 하며 자동 ZIP은 아직 미구현이다. 제품/형식/IPC 변경은 사용자 결정 전 대기한다.

사용자가 최신 Windows 빌드가 잘 작동한다고 보고했다. 개별 기능/네이티브 junction 테스트 내역은 제공되지 않았다.
추가 피드백 PATH-01 구현·통합: #1 `settings_path`, Luna low 요청, `e842492`를 #0이 `36bbf7d`로 병합했다.
설정 데이터 위치는 한 줄 말줄임+전체 경로 title, 기존 선택 가능 문자열·값을 유지한다.
삭제 확인 창 경로 스타일은 유지했다. 작업자 renderer 21개·타입/빌드와 Electron 긴 Windows 경로
760/1100px 한 줄·clipping·title·카드/창 overflow 검사 성공.
main `pnpm check` 성공(978개 통과·9 skip, 전체 타입·두 앱 빌드·Biome 기존 CSS 경고 8개).
agent-1 main detached·병합 브랜치 삭제. 새 Windows 표시 확인은 사용자 검증 대기다.
[인계](handoffs/PATH-01.md).

사용자 피드백으로 메모리 좌우 드래그 제거 완료: #1 `memory_no_drag`, Luna low의 `4179715` 통합.
main 전체 검사 성공(912개 통과·9 skip, 전체 타입·두 앱 빌드·Biome 기존 CSS 경고 8개).
드래그만 제거하고 스피너/권장·저장 성공 문구/플레이 최근 결과 숨김 및 직접 입력·검증·저장은 유지한다.
agent-1 detached·작업 브랜치 삭제, 작업자 renderer 23개와 Electron smoke도 통과했다.

사용자 승인으로 **L2a 후속과 L3 스킨을 병렬 구현·통합**했다. #2 `launcher_followups`(Astra medium 요청),
#3 `player_skin`(Sol medium 요청), agent-2/3의 별도 브랜치에서 작업한다. 실제 effort UI 반영은 미확인이다.
공용 서비스/IPC/상태/메뉴·페이지 연결은 #2 한 명, 스킨 모듈/아바타 component는 #3 한 명이 소유한다.
[배정·계약](launcher-parallel-followups.md). 운영자 브랜딩/Studio는 미착수이며 추가 작업자는 만들지 않는다.
스킨 모듈 #3 `4e2fea9`를 #0이 `986600b`로 먼저 통합했다. 모듈 56개 테스트·타입/빌드와
Electron 실제 PNG 디코드/64x32·64x64 얼굴·모자 위치/투명도/fallback fixture 검증 통과.
#2 `f35b8ed`·`fa856d5`를 #0이 `d357b0b`로 통합해 production factory/계정/메뉴 연결까지 완료했다.
인자 없는 `open-logs`(실행 중 가능), 삭제 미리보기와 독립된 데이터 위치, 앱 안 확인 후 미등록 파일 삭제를 추가했다.
스킨은 백그라운드 조회·5분/32개 메모리 캐시·검증 PNG만 상태 전달하며 로그아웃/인증 실패/종료 시 비운다.
작업자 통합 범위 200개 테스트·타입/빌드·Electron 임시 파일 취소/삭제·설정 위치·아바타 연결 smoke 통과.
main 전체 `pnpm check` 성공: 978개 통과·9 skip, 전체 타입·두 앱 빌드·Biome(기존 CSS 경고 8개).
agent-2/3을 통합 main에 detached로 정리하고 병합된 두 작업 브랜치를 삭제했다. 진행 중 검사/프로세스 없음.
이후 사용자가 Windows 최신 빌드가 잘 작동한다고 보고했다. 기능별 로그/네트워크·junction 개별 검증은 미제공이다.

MEM-01 입력 후속 통합: #1 `memory_scrub` Luna medium의 `717ae43`을 #0이 `cca1bf5`로 --no-ff 병합했다.
권장 단위 문구·숫자 스피너·메모리 저장 성공 문구를 제거하고 두 입력의 좌우 드래그를 추가했다.
4px 임계값, 약 20px당 256MiB 조절, 범위 제한·취소 복원·직접 입력·명시 저장을 유지한다.
추가 사용자 요청으로 플레이 탭의 최근 결과 표시도 제거했다. 내부 outcome/로그·오류·복구는 유지한다.
renderer 관련 테스트 24개·타입/빌드·Electron pointer/저장 전 미반영 smoke 성공.
main `pnpm check` 성공: 913개 통과·9개 skip, 전체 타입·두 앱 빌드·Biome(기존 CSS 경고 8개).
인계 정확도 문서 후속 `e7a207d`도 통합했다. agent-1 detached·병합 브랜치 정리, 다른 worktree 미변경.
Windows 드래그 사용감 및 MEM-01 실제 게임 메모리 확인은 사용자 검증 대기다.
[인계](handoffs/MEM-01-INPUT.md). 이후 사용자 승인으로 L2a 후속/L3 스킨만 병렬 착수했다.

MEM-01 구현·검토·통합: #1 `mem_01`, Luna medium의 `a2f81b1`을 #0이 `91d47c9`로 --no-ff 병합했다.
코어 Xms(미지정이면 생략), 기존 Xmx 기본 2048 MiB 유지, 개인 설정 호환·원자적 저장,
서비스 전달·물리 RAM 상한 검사·설정 카드/75% 경고·i18n을 연결했다.
실행 시작 때 전체 개인 설정을 고정하고 실행 중 메모리 저장은 다음 실행에만 반영한다.
설정 저장 전용 직렬화와 종료 시 진행 중 저장 대기를 추가했으며 게임 수명/잠금은 유지했다.
작업자 관련 테스트 79개·core/launcher 타입·런처 빌드·Electron 설정 화면 기능 smoke 통과.
main 전체 `pnpm check` 성공: 911개 통과·9개 skip, 전체 타입·두 앱 빌드·Biome(기존 CSS 경고 8개, 오류 없음).
agent-1을 통합 main(`91d47c9`)에 detached로 정리하고 병합된 작업 브랜치를 삭제했다. 다른 worktree는 그대로다.
Windows 실제 UI/Java 메모리 인자 검증은 미실시이며 사용자 확인을 요청한다.
[인계](handoffs/MEM-01.md), `docs/work-distribution.md` 맨 아래 MEM-01을 참고한다.
운영자 브랜딩은 아직 미승인/미착수다. L2a 후속/L3 스킨의 새 배정은 문서 상단을 따른다.

BRAND-ICON-01 구현·통합: #1 `app_icon` Luna medium의 `35d4f90`를 #0이 `8b2e946`으로 병합했다.
사용자 ICO를 공유 `assets/branding/`에 복사하고 내장 PNG를 무손실 추출했다. 두 앱 native 창 및
Windows/Linux 패키징 설정에 적용했다. 원본 루트 icon.ico는 그대로 보존했다. UI/테마 변경 없음.
작업자 Studio Linux package:dir 리소스 포함 확인 성공. main 전체 타입/두 앱 빌드와 런처 Linux
package:dir 성공. 런처 패키지 `resources/branding/icon.png`와 원본 PNG의 SHA-256 일치 확인.
Windows 실행 파일 빌드·표시 결과는 미검증. [인계](handoffs/BRAND-ICON-01.md).

I18N-01 구현·통합: #1 Luna medium의 `f95faf9`·`5863dce`를 #0이 검토·병합했다.
공통 typed 번역/보간·한국어/영어 locale 판별·명시 선택/자동 모드·앱별 저장·React provider/hook을 준비했다.
기존 화면은 그대로이며 대표 문구만 사전에 있다. 전체 문구 번역·언어 선택 UI 연결은 후속이다.
통합 `pnpm check` 성공: 832개 통과·9개 skip, 전체 타입/Biome/두 앱 빌드.
작업자 worktree의 기존 인증 의존성 누락은 main에서 재현되지 않았다.
[범위](localization.md), [구현 인계](handoffs/I18N-01.md).
이후 UI 개선은 Claude에서 진행하며 [UI 인계](ui-handoff.md)에 재개 절차·제약·남은 적용 범위를 기록했다.

LAUNCH-EXIT-01 구현·통합: #3 `close_on_launch`(Sol medium)의 `5a7e0c3`와 인계 `2cf254a`를
#0이 검토·병합했다. 설정의 ‘게임 실행 후 런처 종료’는 기본 off이며 개인 설정으로 저장된다.
활성화 시 실제 자식 식별자와 잠금 기록 검증 후 분리하고 런처 프로세스를 종료한다.
실패/분리 전 취소에는 종료하지 않으며, 게임 생존 중 중복 실행·변경을 잠금으로 차단한다.
게임 종료 후에는 미완료 트랜잭션 없는 검증된 해당 게임 잠금만 자동 회수한다.
Linux 실제 호스트 정상/강제 종료 후 자식 생존·잠금 유지/회수 테스트와 Electron 설정 IPC smoke 성공.
통합 `pnpm check` 성공: 821개 통과·9개 skip, 전체 타입/Biome/두 앱 빌드.
Windows 네이티브 및 실제 게임 자동 종료 확인은 별도 미검증이다.
[상세 인계](handoffs/LAUNCH-EXIT-01.md), [종료 기능 범위](close-on-launch.md)를 참고한다.

UI-PROD-01 기능 흐름 단계 구현·통합을 마쳤다. 사용자의 지시에 따라 시각 디자인 고도화는 하지 않았다.
#1 Studio `9b8d7b0` 및 smoke 후속 수정, #4 런처 `42b5aef`·`aeff584`와 주 버튼 가독성 `95aa7df`를
통합했다. 둘 다 Luna·medium으로 배정했으며 #0은 문서/검토/통합/검증만 수행했다.
런처는 로그인/접속 주 동작·작업 종류별 진행 표시·취소/종료, 문제 해결의 세션/복구/로그,
페이지별 조회 상태·리소스팩 초안 보존을 제공한다. Studio는 단계 이동·일치하는 입력 검증·
업로드 전 URL 없는 팩 생성·저장/취소/재시도 상태를 제공한다. 서버 선택/추가/주소 입력은 없다.
메인 `pnpm check` 성공: 796개 통과·9개 skip, 전체 타입/Biome/두 앱 빌드. 후속 표시 수정은
renderer 테스트 9개(새 회귀 1개 포함)·타입·Biome·런처 재빌드로 검증했다.
Linux/WSLg 두 앱 root smoke(760/1100px·IPC/격리/탐색), Studio 기능 smoke(입력 수정/취소/실제 저장/
팩 생성/재열기), 런처 기능 smoke(실제 모드/팩 조회·상태 이벤트 후 초안 보존)가 성공했다.
검사 도구의 화면 위치 가정과 임시 TCP 연결 정리만 후속 수정했다. 새 UI 변경의 Windows 네이티브
실행은 별도 미검증이며 이전 UI 접속 성공과 구분한다. 추가 기능/시각 디자인은 별도 지시까지 대기한다.

기능 연결·서버 접속과 병렬 설치/진행 상태 계약까지 통합했다. 현재 실행 중인 구현 작업자는 없다.
최신 검사 결과는 이 문서 상단의 작업별 통합 기록을 따른다. 아래의 이전 배정/검증 수치는 당시 증거다.

### 남은 작업과 권장 순서

2026-10-23 최신 기준. 런처 L1–L2a·후속과 스킨·메모리 설정은 구현·통합했고 사용자 Windows 정상 작동 보고가 있다.
현재 작업자는 모두 종료했다. 아래는 후속 승인/배정 대상이며 자동 착수하지 않는다.

1. **L3 운영자 브랜딩:** 프로파일의 앱 이름·창/메뉴 아이콘·홈 배경을 반영한다. 자산 전달 형식을 먼저
   조사·제안하고 사용자 승인 후 공용 계약/Studio를 변경한다. exe 아이콘은 바꾸지 않으며 시작 로고는 TorchLauncher 고정이다.
2. **Studio 개편·잔여 기능:** 승인된 시안 기반 UI, 브랜딩 자산 편집/내보내기, 단축키·음량/화면·팩 등
   기본/필수 설정 편집, 운영자 메모리 권장값, ZIP 내보내기를 구현한다. 서버 ID/게임 불일치·미검증 URL은
   내보내기를 막는다. 셰이더 설정은 정책 형식 확장이 필요하다. 시안 소스의 저장소 반입 상태를 먼저 확인한다.
3. **배포 서명·롤백 방지:** 운영자 키 생성/백업, torchpack 서명/검증, 이전 배포 거부와 v1 전환 규칙을 구현한다.
4. **RELEASE-02 런처 업데이트:** GitHub Releases 확인→사용자 동의→서명 매니페스트/해시 검증→안전한 프로그램 교체.
   서버 설정/사용자 데이터 보존·최소 런처 버전, Windows portable 교체 방식을 구현 전 검증한다.
5. **영어 UI 적용:** 번역 기반은 완료했지만 실제 문구 번역·언어 선택 연결은 남았다. 현재 신규 영어 사전에는
   한국어 임시 값이 있으며 Studio/네이티브 대화상자까지 전체 적용 범위를 정해야 한다.
6. **QA-01·네이티브 상세 검증:** Studio 구성→업로드→ZIP→새 환경 설치/접속→동일 URL 교체를 Windows/Linux,
   Fabric/NeoForge에서 검증한다. 사용자 모드/설정 보존, 중단/취소/복구, 메모리 인자·런처 종료 후 게임 생존,
   Windows junction 등 상세 항목은 개별 증거가 없는 부분만 확인한다. 완료된 사용자 접속 검증을 불필요하게 반복하지 않는다.
7. **AUTH-04·출시 마무리:** 마지막으로 미룬 자체 Microsoft 앱 API 승인/전환, 최종 인증 회귀, 패키지/안내/지원 범위를 정리한다.
   Windows 코드 서명은 하지 않는 정책을 유지한다. 1.21.1 밖 버전 확대는 별도 호환성 검증 작업이다.

현재 실검증 범위는 Minecraft 1.21.1 + Java 21, Windows/Linux x64다. 다른 게임/Java/로더 버전은
선택 가능한 입력과 실제 설치 지원을 구분하고 지원 확대 시 별도 호환성 검증을 해야 한다.
macOS는 보류, Linux ARM64와 연결 해제 시 종료 보조 모드는 지원 범위에서 제외됐다.

### 최근 통합 및 이전 진행 기록

- GAME-PERF-01 `ee4ef86`을 `424b787`, GAME-ACTIVITY-01 `e34e376`을 `0717835`로 통합·검증했다.
  기본 게임/Java 파일은 기본 6개 동시 처리(옵션 1~16), 선언 크기 합계 128MiB 예산(초과 단일 파일은 단독)을 적용한다.
  첫 실패/취소/콜백 예외 시 새 작업을 멈추고 시작된 작업이 끝나야 staging/잠금을 정리한다.
  해시 검사·캐시·게시/저널 순서·롤백은 유지된다. 실제 네트워크 속도 개선량·Windows 새 풀은 미측정이다.
  typed `ProductState.activity`에 종류/단계/상대 경로/활성 작업/완료·전체 수를 전달한다.
  서버 모드/리소스팩/설정/임의 파일 staging·적용 시작/완료도 전달하며 알 수 없는 전체 수는 null이다.
  동기화 계획 수를 완료율로 표시하지 않는다. renderer 문구/디자인은 이번에 수정하지 않았다.
  메인 `pnpm check` 성공: **786개 통과·9개 skip**, 전체 타입·Biome·두 앱 빌드. 후속 작업은 별도 지시까지 대기한다.
- 새 UI 실검증 사용자 보고: **서버 접속 성공**. 이번 검증에 선택한 Fabric 배포 환경에서
  사용자 확인을 접속 근거로 기록한다(서버 로그 미확인). 재시작 후 계정 자동 복원은 별도 미확인이다.
  사용자 추가 요구: 향후 UI가 게임/Java/로더/서버 모드·리소스팩·설정 등 현재 작업 종류를
  구분할 수 있어야 한다. #3은 설치 코어 `onActivity`를, #4는 전달 계약·런처 상태 연결을 맡는다.
- 2026-10-22 사용자 지적: 설치의 순차 파일 처리가 느리므로 제한 병렬화한다.
  GAME-PERF-01을 #3(`install_parallel`, Sol·medium)에 단독 배정했다.
  `perf/game-install-parallel`/agent-3, 독점 범위는 `packages/core/src/minecraft/installer.ts`,
  설치 관련 테스트·새 내부 helper, `docs/handoffs/GAME-PERF-01.md`다. 해시·원자적 게시·취소/실패 정리는 유지한다.
  현재 사용자의 Windows 설치 프로세스에는 실행 중 패치를 적용하지 않는다.
- 최신 통합: Studio `27003a6`을 `e90b289`, 런처 `fc1dbfb`를
  `c21c4c5`, 검증 worker를 `f99e7d4`로 통합했다. 후속 smoke 탐색/스크롤바 수정과
  단일 서버 프로파일 오류 안내 `5712b7f`도 통합했다. #0은 제품 코드를 구현하지 않았다.
  메인 `pnpm check`: **747개 통과·9개 skip**, 전체 타입/린트·두 앱 빌드 성공.
  Linux/WSLg root Electron smoke(760/1100px 탐색·실제 프로젝트 저장·IPC/격리)와 Studio 기능 smoke
  (폼 편집·저장·임의 파일/정책·실제 writer·재열기) 성공. 마지막 안내 문구 변경은 renderer 타입·Biome·런처 재빌드 성공.
  검증 중 스크립트의 탐색 위치/스크롤바 가정 오류만 수정했으며 제품 결함으로 기록하지 않는다.
  사용자 재확인: 런처는 제공된 서버 프로파일 하나만 읽고 서버 선택·추가·주소 입력 UI를 제공하지 않는다.
  다음은 [Windows 새 UI 검증](handoffs/UI-CONNECT-WINDOWS.md): 사용자는 두 로더 중 하나 사용 가능,
  마지막 Drive 배포에 맞는 Fabric 1.21.1/0.19.5를 선택했다. 검증 프로파일은 무시된
  `.cache/game-smoke-validation/ui-server.json`. 새로운 UI의 실계정·실접속은 아직 미검증이다.
  이미지 브랜딩·단일 파일 재패키징/서명은 이번 연결에 포함되지 않으며 폴더 내보내기만 구현했다.
- 2026-10-22 사용자 승인: UI 디자인 전에 두 앱 실제 기능 연결을 진행한다.
  [연결 계약](ui-integration.md)에 따라 #1 UI-CONNECT-S(`feat/ui-connect-studio`, agent-1),
  #4 UI-CONNECT-L(`feat/ui-connect-launcher`, agent-4)을 배정했다. 두 작업 모두 Sol·medium:
  파일 저장/내보내기·IPC 또는 인증/프로세스/복구 경계가 포함되기 때문이다. 공유 서버 구성 계약은 #1 소유다.
  UI-01/UI-02 및 STUDIO-01~03은 필요한 통합·실검증 전 완료로 처리하지 않는다.
- 2026-10-22 사용자 승인: UI-BASE(Studio·런처 UI 기반)를 #1에 배정했다.
  `feat/ui-base-shells`, `.agents/worktrees/agent-1`에서 두 앱 renderer와
  `scripts/smoke.mjs`, `docs/handoffs/UI-BASE.md`만 수정한다. 앱별 탐색·화면 분리,
  스타일 토큰·기본 컴포넌트·빈 상태를 구현하며 실제 인증/동기화/저장/실행 연결은 제외한다.
  모델 Luna·effort medium(확정된 React 기반 구현). UI-01/UI-02·STUDIO 작업 완료로 계산하지 않는다.
- UI-BASE 통합 완료: 구현 `f4b89c7`, 스타일 정리 `af28d54`. 앱별 `components/`·`pages/`·`hooks/`,
  타입이 있는 로컬 탐색, CSS 토큰·반응형 레이아웃과 미연결 기능의 비활성 상태를 추가했다.
  메인 `pnpm check` 성공(705개 통과·9개 skip·전체 타입/린트·두 앱 빌드).
  Linux/WSLg Electron smoke에서 두 앱의 760px 화면 전환·비활성 동작·앱 정보 IPC·샌드박스를 확인했다.
  화면 캡처는 `.cache/smoke/{launcher,admin}.png`. 이번 변경의 Windows 네이티브 UI 검증은 미실시다.
- 다음 사용자 승인 범위는 GAME-02/03: 1.21.1 NeoForge를 먼저, Fabric을 이어서 실제 설치·실행·직접 접속한다.
  #3에 단독 배정하며 [실행 기준](game-launch.md)에 따라 접속 직전 최신 동기화 실패 시 실행을 차단한다.
  서버·직접 계정 테스트가 필요하면 #0이 준비된 명령과 함께 사용자에게 요청한다.
  사용자는 `.testserver/`에 1.21.1 / NeoForge 21.1.264 서버를 별도 실행했다. 포트 25565,
  online-mode=true, whitelist=false, 추가 모드 없음, 기동 완료 로그 확인. 파일과 프로세스는 변경하지 않는다.
  #3 구현 `e763686`·종료 처리 `bc6ead4`·인계 `2fc3c2e`를 `541237a`로 통합했다.
  실제 Linux NeoForge 21.1.264·Fabric 0.16.14 설치 성공. 메인 `pnpm check` 성공:
  543개 테스트·opt-in 6개 기본 skip·전체 TypeScript·Biome·두 앱 빌드.
  독립 Electron/auth-worker 번들 생성은 성공했으나 개발 환경의 native Electron install-only는
  harness 결과 없이 종료되어 GUI 검증은 미완료다. Windows 실제 게임 실행·월드 접속을 사용자에게 요청한다.
  테스트 명령은 [GAME-02/03 인계](handoffs/GAME-02-03.md), 현재 재개 상태는 도구 간 인계를 따른다.
- Windows 첫 실접속 시도: 인증 후 게임 JVM이 `Modules _1._21._1 and minecraft export package ...` 모듈 해석 오류로
  즉시 종료했고 호스트는 `host_no_result`만 출력했다. 원인은 NeoForge `-DignoreList`의 `${version_name}.jar`가
  병합 id(`neoforge-21.1.264`)로 치환되어 바닐라 `1.21.1.jar`가 무시되지 않은 것이다. 수정 `35f5734`를 `3a86683`로
  통합했다(ignoreList를 실제 바닐라 jar 이름에 결합, 비정상 종료의 안전한 `ok:false`·고정 분류 코드, 결과 파일 병행 기록).
  메인 `pnpm check` 성공: 549개 테스트·opt-in 6개 skip·전체 TypeScript·Biome·두 앱 빌드. `host_no_result`의 원인
  (종료 직전 console.log 유실)은 Linux에서 재현하지 못한 가설이다. Windows 재실행은 성공했다(아래).
- GAME-02 완료: 수정 반영 후 Windows 11에서 `game-smoke launch`(NeoForge 21.1.264, localhost:25565)가
  `ok:true, exitCode:0, completion:process_exit`로 끝났고, 사용자가 게임 실행 후 서버 월드 자동 접속을 직접 확인했다
  (결과 JSON의 `authenticatedConnection`은 `not-asserted`이므로 접속은 사용자 보고가 근거다). 서버 콘솔 로그는 미확인.
  GAME-03(Fabric)은 맞는 Fabric 배포본·서버로 실접속 확인이 남아 있다.
- GAME-03 준비: Fabric 0.19.5 Linux 실설치 성공(5.4MB, 65 classpath), 인자 회귀 테스트 추가, `.testfabricserver/` 제외 규칙을
  `fix/game-03-fabric-validation`(`c0b748e`)에서 통합했다. 메인 `pnpm check` 성공(551개 테스트·opt-in 6개 skip).
  사용자가 Drive 팩을 Fabric 0.19.5용으로 교체했고 실제 링크 읽기가 일치했다(301 bytes, 서버 ID 일치). 제품에서는 서버 로더가
  바뀌지 않으므로 게임 폴더를 로더별로 나누지 않는다. 테스트도 기존 서버 UUID 폴더를 재사용한다(로더 트리는 버전별 하위 폴더).
  Windows Fabric 실접속 결과 대기.
- GAME-03 완료: Windows 11에서 `game-smoke launch`(Fabric 0.19.5, 기존 서버 UUID 게임 폴더 재사용, localhost:25565)가
  `ok:true, exitCode:0, completion:process_exit`로 끝났고 사용자가 서버 접속을 확인했다(결과 JSON은 `not-asserted`,
  접속 근거는 사용자 보고). NeoForge와 같은 폴더에 로더 트리가 공존함을 실제로 확인했다. 서버 콘솔 로그는 미확인.
- 사용자 승인 범위인 FMT-03 배포 reader와 SYNC-01 동기화 코어를 모두 통합·검증했다.
  reader는 Luna(명세 기반 구현), sync는 Sol(소유권·실패 복구)로 작업별 전환했다.
- FMT-03을 `9c0dd04`(구현 `375e50e`)로 통합했다. 메인 reader/writer 58개 테스트,
  core TypeScript·scoped Biome 성공. SYNC-01은 [범용 동기화 기준](synchronization.md)에 따라 이어서 구현한다.
  생성한 비민감 v1 torchpack을 사용자가 Drive에 업로드했다. 실제 공개 링크에서 헤더·인덱스 읽기와
  생성본의 정확한 일치를 확인했다(140,736 bytes, 파일 5개, payload 미수신).
  로컬 검증 영수증은 `.cache/sync-validation/reader-v1-receipt.json`이며 공유 URL은 커밋하지 않는다.
- SYNC-01 구현 `88c8af3`을 `c79b95b`로, 실검증 기록 `adff59c`를 `0f3ce6c`로 통합했다.
  v1 실제 최초 구성 5개 수신, 같은 reader 재실행은 payload 수신 0을 확인했다.
  같은 Drive 파일의 v2 교체 후 이전 reader는 `source-changed`, reset 후 v2 인덱스 일치,
  변경·추가 파일 2개만 HTTP 206 수신(본문 4,140 bytes), 2개 재사용·1개 개인 설정 보존·1개 삭제를 검증했다.
  메인 `pnpm check` 성공: 518개 테스트·opt-in 4개 기본 skip·전체 TypeScript·Biome·두 앱 빌드.
  앱 UI 연결과 GAME-05 stale-lock 복구·실제 전원 차단 내구성 검증은 이번 완료 범위가 아니다.
  도구 제한 중단 후 재개했고 [도구 간 인계](tool-handoff.md)를 최신 상태로 갱신했다.
- 최신 사용자 결정: 자체 앱 ID 승인·최종 연결은 마지막 단계로 미루고, 개발 중에는 임시 공개
  Java Title ID 인증을 사용한다. AUTH-03 구현을 `a7eba73`으로 통합했다. smoke 기본은
  `public-java`이며 기존 own-app 경로는 명시적 옵션으로 유지한다. Windows 실계정 cycle은 사용자 보고로 성공했다.
  첫 대화형 로그인에서 결과 없이 Electron이 종료된 문제도 `758909b`로 수정 통합했다.
- AUTH-03 통합 검사: `pnpm check` 성공(474개 통과, 기존 실환경 테스트 3개 생략),
  두 앱 빌드와 Electron 화면·IPC·격리·샌드박스 smoke 성공. 공개 ID 실계정 로그인 성공을 뜻하지 않는다.
  메인의 `worker-check`도 pinned 3.1.1 임시 번들 로딩·종료에 성공했다(네트워크·로그인 없음).
  구현 커밋은 `ccac0c7`, 상세 인계와 Windows 명령은 [AUTH-03](handoffs/AUTH-03.md)를 따른다.

- 프로젝트 기반 구축과 Linux 검증은 완료했다. 배포 규격·Range 전송·임시 인증·Minecraft 설치·파일 동기화 코어를 통합했다. 앱 기능 연결·실제 게임 실행·Studio 제품 기능은 남아 있다.
- Git 기준 커밋 `4d5b4ab`과 `main`, 네 작업 브랜치·worktree를 준비했다.
- 전체 총괄은 사용자 지정 `#0` 에이전트인 **`launcher develop #0`**이다. #0은 제품 기능을
  구현하지 않고 배정·문서·검토·Git 통합·통합 검증을 맡는다.
- 첫 작업은 #1 FMT-01, #2 DL-02, #3 GAME-01, #4 AUTH-01로 배정했다.
  네 세션의 첫 작업과 검토 수정을 머지했다. #2는 Luna, 나머지는 총괄 모델 상속으로 실행했다.
- AUTH-01과 GAME-01의 이번 코어 범위와 남은 호스트 연결·실환경 검증을 분리했다.
  원래의 제품 완료 기준을 줄이지 않고 AUTH-02·GAME-04·GAME-05로 추적한다.
- 사용자 결정으로 연결 해제 시 게임 자동 종료와 이를 위한 보조 모드를 제외했다.
  MOD-01·MOD-02는 취소했다. 서버 직접 접속은 유지한다.
- 2차 작업 시작 승인에 따라 #1 FMT-02, #2 DL-01, #3 GAME-04, #4 AUTH-02를 배정했다.
  범위와 완료 기준은 [2차 작업 배정](work-distribution.md#2차-작업-배정--2026-10-21)을 따른다.
- 네 세션의 2차 구현과 검토 수정을 모두 머지했다. `pnpm check`가 447개 테스트 성공,
  opt-in 실제 설치 테스트 1개 기본 skip, 전체 타입·린트·두 앱 빌드 성공으로 끝났다.
  이후 Drive 실파일 버전 교체도 검증했다. #4의 사용자 테스트는 앱 등록·개인 계정 설정 후
  Microsoft/Xbox 교환을 진행했으나 Minecraft 토큰 교환에서 HTTP 403으로 중단됐다. 전체 인증 cycle은 미완료다.
- 사용자가 Drive 공개 테스트 링크를 제공했다. #2에 `test/dl-01-live-drive` 브랜치로
  첫 버전의 익명 Range 검증을 배정한다. 파일 교체는 첫 검증 후 별도 요청하며 아직 하지 않는다.
- Drive 첫 버전 실검증 성공: 78,641,842 bytes 파일에서 1-byte probe와 처음·중간·끝
  64 KiB 및 중간 반복 구간이 실제 HTTP 206·정확한 범위·일관된 snapshot을 반환했다.
  중간 반복 SHA-256이 일치했다. 전체 파일 비교는 16 MiB 상한을 넘어 생략했다.
  이어 v1 소스를 유지한 채 사용자의 버전 교체를 확인했다. 이전 소스가 변경을 감지하고,
  reset 후 같은 공유 링크에서 새 크기 78,641,731 bytes와 변경된 중간·끝 구간을 받았다.
  새 중간 반복 해시도 일치했으며 다른 버전 바이트를 이전 소스 결과로 수락하지 않았다.
- [세션별 작업 지시문과 수정 범위](work-distribution.md)를 따른다. FMT-01 계약을 우선 통합하고
  후속 writer·reader·Studio 작업을 연결한다. 독립적인 첫 작업 네 개는 병렬 착수할 수 있다.

## 총괄과 에이전트 역할

| 역할 | 담당 | 책임 |
| --- | --- | --- |
| 전체 총괄 | `#0` — 현재 `launcher develop #0` | 제품 구현 제외. 작업 분배·범위 조정, 이 진행 문서 갱신, 통합 검토·Git 머지·통합 충돌 해결·검증·완료 판정 |
| 구현 에이전트 | 그 외 작업 세션 | 배정된 브랜치·worktree에서 구현·테스트·커밋 후 총괄에게 인계 |

- **이 진행 문서 수정과 `main` 또는 별도 지정한 통합 브랜치로의 반영은 `#0`만 수행한다.**
  통합 목적의 merge·cherry-pick과 그 충돌 해결도 총괄이 관리한다.
- 구현 에이전트는 자기 작업을 통합 브랜치에 직접 머지하지 않는다. 자기 브랜치를 최신 통합
  기준으로 갱신하는 것은 가능하며, 변경과 검증 결과를 인계한다.
- 역할 변경은 사용자의 지정을 따른다. 작업 인계 시 담당 세션 이름을 함께 기록한다.

## 상태와 운영 규칙

| 상태 | 의미 |
| --- | --- |
| 준비 | 선행 작업이 충족되어 담당 배정 가능 |
| 대기 | 선행 작업 또는 설계 결정 필요 |
| 진행 | 담당·브랜치·수정 범위를 배정하고 작업 중 |
| 검토 | 구현과 브랜치 검증 완료, 통합 검토 중 |
| 머지 대기 | 검토 완료, 통합 브랜치 반영 대기 |
| 완료 | 통합 기준에 반영되고 필요한 검증 완료 |
| 차단 | 외부 조건·오류 때문에 진행 불가. 원인과 해제 조건 기록 필요 |
| 취소 | 사용자 결정 등으로 범위에서 제외. 구현 완료를 뜻하지 않으며 후속 작업의 선행 조건에서 제거 |

- **통합 담당자인 `#0`만 이 파일의 상태와 담당을 갱신한다.** 여러 에이전트가 동시에 수정하지 않는다.
- 착수 전 작업 ID, 에이전트, 브랜치, worktree, 수정할 파일 범위를 등록한다.
- 각 에이전트는 별도 브랜치·별도 worktree를 사용한다. 같은 작업 폴더에서 동시에 checkout하지 않는다.
- 선행 작업은 원칙적으로 통합 브랜치에 반영된 후 사용한다. 공유 계약이 확정되지 않았으면
  다른 에이전트가 임의로 가정해 구현하지 않는다.
- 완료 처리 시 검증 명령·결과·미검증 환경과 커밋을 기록한다. GUI 구성이나 CI 설정만으로 기능 완료로 표시하지 않는다.
- 기존 `BASE-01`은 Git 운영 이전에 완료한 기반 작업이다. 기준 커밋은 `BASE-02`에서 기록한다.

## 작업 목록

아래 목록의 담당과 브랜치는 착수 시 배정표에 기록한다. 큰 작업은 착수 전에 `DL-01-a`처럼
세분화할 수 있으나, 선행 관계와 수정 범위를 함께 갱신한다.

| ID | 구현·검증할 내용 | 선행 작업 | 상태 |
| --- | --- | --- | --- |
| BASE-01 | 모노레포, 독립 앱, IPC 격리, 검사·빌드·포터블 패키징 기반 | — | 완료 |
| BASE-02 | Git·main·기준 커밋과 네 구현 브랜치·worktree 준비 | BASE-01 | 완료 |
| BASE-03 | Windows 실제 실행·패키징·smoke test 확인 | BASE-02 | 완료 — Windows 11: `pnpm check`·`pnpm smoke`·두 앱 포터블 패키징·실행 확인(미서명) |
| BASE-04 | macOS 실제 실행·패키징·smoke test 확인 | BASE-02 | 보류 — 사용자 결정으로 macOS는 당분간 지원하지 않음 |
| FMT-01 | 단일 배포 파일 규격·서버 식별자·공유 계약 확정, 테스트 예제 정의 | BASE-02 | 완료 |
| DL-01 | 일반 HTTPS·Drive 공개 링크 공통 처리, gdown Drive 로직 TypeScript 이식·MIT 고지·원본 커밋, Range·버전 교체 검증 | DL-02 | 완료 |
| DL-02 | 일반 HTTPS Range 전송, 206·범위·길이 검사, 취소·재시도·원격 교체 감지 | BASE-02 | 완료 |
| AUTH-01 | Microsoft 로그인·소유권 확인·갱신·로그아웃 코어와 저장·브라우저 계약, 모의 검증 | BASE-02 | 완료 |
| AUTH-02 | 자체 앱 등록·API 접근 확인, 브라우저・OS 안전 저장 어댑터, 실제 로그인·재시작·갱신·로그아웃 검증 | AUTH-01 | 검토 |
| AUTH-03 | 임시 공개 Java Title ID 인증, 암호화 캐시·취소·재시작·실계정 cycle 검증 | AUTH-01, AUTH-02 구현 | 완료 — Windows cycle 성공 보고, smoke 종료 회귀 수정·검증 |
| AUTH-04 | 최종 자체 앱 ID API 승인·제품 연결·실계정 회귀 검증, 임시 기본 경로 교체 | AUTH-03 | 대기 |
| FMT-02 | 인덱스와 독립 압축 데이터를 포함하는 단일 배포 파일 생성 | FMT-01 | 완료 |
| FMT-03 | 인덱스 읽기·입력 검증·파일별 부분 다운로드·해시 검사 | FMT-01, DL-02 | 완료 |
| SYNC-01 | 로컬 관리 목록, 변경 비교·적용·운영자 파일 삭제·실패 복구 | FMT-02, FMT-03, DL-01 | 완료 |
| GAME-01 | Java·Minecraft·라이브러리·자산 설치와 실행 인자 조립 코어, fixture 검증 | BASE-02 | 완료 |
| GAME-PERF-01 | 기본 게임/Java 파일 제한 병렬 처리, 실패·취소 drain과 회귀 검증 | GAME-01, GAME-05 | 완료 — 제한 병렬화/안전 정리 통합, 실제 속도·Windows 측정 별도 |
| GAME-ACTIVITY-01 | 작업 종류·단계·파일/개수/활성 작업 정보를 UI까지 전달할 계약 | GAME-PERF-01, UI-CONNECT-L | 완료 — 구조화 상태/IPC 전달, renderer 표현은 후속 UI 작업 |
| LAUNCH-EXIT-01 | 게임 시작 후 런처 자동 종료 개인 옵션·게임 프로세스 분리·잠금 유지/회수 | UI-CONNECT-L, GAME-05 | 구현·통합 검사 완료 — Windows 실게임 미검증 |
| I18N-01 | 한국어·영어 공통 번역 및 renderer 연결 기반 | UI-BASE | 기반 구현·통합 검사 완료 — 전체 UI 적용은 후속 |
| MEM-01 | 개인 Xmx/Xms 설정·코어/서비스/설정 화면 연결 | LAUNCHER-UI-L2A | 구현·통합 검사 완료 — Windows 확인 대기 |
| LAUNCHER-L2A-FOLLOWUPS | 로그 폴더 열기·데이터 위치·미등록 파일 확인/삭제 | LAUNCHER-UI-L2A | 구현·통합 검사 완료 — 사용자 Windows 정상 작동 보고, junction 개별 미검증 |
| LAUNCHER-PLAYER-SKIN | 스킨 조회/검증/캐시·얼굴+모자 아바타·서비스 연결 | LAUNCHER-UI-L2A | 구현·통합 검사 완료 — 사용자 Windows 정상 작동 보고, 네트워크 별도 계측 없음 |
| BRAND-ICON-01 | 사용자 레드스톤 토치 ICO를 두 앱 native 아이콘으로 적용 | UI-BASE | 적용·타입/빌드/Linux 패키지 확인 완료 — Windows 표시 미검증 |
| GAME-04 | 전체 HTTPS 다운로드 연결·실제 Java/게임 설치 검증, 프로세스·로그·실행 잠금 관리 | GAME-01 | 완료 |
| GAME-05 | 중단된 설치 잠금·저널 검증, 크래시 복구 API와 프로세스 강제 종료 검증 | GAME-01 | 코어 완료 — Windows 실프로세스 검증, UI 연결 완료·새 UI 네이티브 검증 대기 |
| GAME-02 | 1.21.1 NeoForge 설치와 지정 서버 직접 접속 | GAME-01, GAME-04, AUTH-03, SYNC-01 | 완료 — Windows 11 NeoForge 21.1.264 실접속 성공(사용자 확인) |
| GAME-03 | 1.21.1 Fabric 설치와 지정 서버 직접 접속 | GAME-01, GAME-04, AUTH-03, SYNC-01 | 완료 — Windows 11 Fabric 0.19.5 실접속 성공(사용자 확인) |
| USER-01 | 런처를 통한 추가 모드 등록·삭제·보존, 미등록 파일과 충돌 처리 | SYNC-01 | 코어 완료 — 모드 추가/등록 삭제/미등록 편입 UI 연결, 네이티브 검증 대기 |
| USER-02 | 최초 기본값·필수 설정 구분, 혼합 설정 적용, 리소스팩 활성화·순서 | FMT-01, SYNC-01 | 코어 완료 — 실행 전 정책·리소스팩 편집 연결, 네이티브 검증 대기 |
| USER-03 | 서버별 경로·용량 표시와 실행 중 삭제 차단, 서버 데이터 삭제 | SYNC-01 | 코어 완료 — 용량/확인 삭제 UI 연결, 네이티브 검증 대기 |
| MOD-01 | NeoForge 연결 해제 시 종료 보조 모드 — 사용자 결정으로 제외 | — | 취소 |
| MOD-02 | Fabric 연결 해제 시 종료 보조 모드 — 사용자 결정으로 제외 | — | 취소 |
| UI-01 | 서버 온라인·응답 실패·접속 인원·지연시간 조회와 표시 | BASE-02 | 검토 — 코어/표시 통합, bounded TCP fixture 검증, 실서버 새 UI 대기 |
| UI-BASE | Studio·런처 renderer 화면 구조·탐색·스타일·기본 컴포넌트 | BASE-02 | 완료 — UI 기반만, 실제 기능 연결은 UI-02·STUDIO에서 진행 |
| UI-CONNECT-L | 서버 상태·인증·설치·동기화·실행·사용자 관리의 런처 UI/IPC 연결 | UI-BASE, 기존 코어 | 검토 — 새 UI 접속 성공(사용자 확인), 세션 복원/부가 관리 네이티브 검증 잔여 |
| UI-CONNECT-S | 프로젝트·배포 생성·링크 검사·폴더 내보내기의 Studio UI/IPC 연결 | UI-BASE, 기존 코어 | 검토 — 통합/파일·GUI 검사 완료, Windows·실제 내보낸 패키지 실행 대기 |
| UI-02 | 사용자 런처에 인증·동기화·접속·설정·추가 모드·오류·로그 기능 연결 | AUTH-03, SYNC-01, GAME-02, GAME-03, USER-01, USER-02, USER-03, UI-01 | 검토 — 기능 연결/새 UI 접속 성공, 부가 기능·오류 경로 네이티브 검증 잔여 |
| UI-PROD-01 | 런처·Studio 프로덕션 UI 개편: 기본 흐름 단순화, 고급 관리 분리, 작업별 진행·오류/재시도·접근성 | UI-BASE, UI-CONNECT-L/S 구현, GAME-ACTIVITY-01 | 기능 단계 완료 — 통합/자동·Linux GUI 검사 성공, 시각 디자인 고도화 미착수 |
| STUDIO-01 | 서버 프로젝트 저장, 버전·로더·주소·이미지·기본 설정 구성 | FMT-01 | 검토 — 프로젝트/서버/파일 정책 구현, 이미지·편의 설정 편집 잔여 |
| STUDIO-02 | 배포 파일 선택·생성, 공개 URL 등록·부분 다운로드 검사, 업데이트 흐름 | STUDIO-01, FMT-02, DL-01, DL-02 | 검토 — writer/reader UI 연결, 실제 운영자 배포 주기 네이티브 검증 대기 |
| STUDIO-03 | OS별 공통 코어에 설정·이미지를 묶어 전용 포터블 런처 내보내기 | STUDIO-02, UI-02 | 검토 — 공통 바이너리+서버 구성 폴더 내보내기 구현, 이미지·단일 파일·실패키지 실행 잔여 |
| QA-01 | 운영자 구성 → 업로드 → 내보내기 → 신규 설치 → 접속 → 업데이트 전체 검증 | STUDIO-03, GAME-05 | 대기 |
| RELEASE-01 | 지원 OS·CPU·게임 버전 범위와 서명·배포 정책 확정·검증 | BASE-03, QA-01, AUTH-04 (BASE-04는 macOS 보류로 제외) | 대기 |
| RELEASE-02 | 공통 런처 코어 자동 업데이트 설계·구현·호환성 검증 | QA-01 | 대기 |

## 담당 배정과 수정 범위

배정 시 아래 표에 행을 추가한다. 담당 미정인 작업을 진행 상태로 바꾸지 않는다.
브랜치 예시는 `feat/dl-01-drive-resolver`, worktree 예시는 저장소 밖의 `../torchlauncher-dl-01`이다.
worktree 생성 위치는 실행 환경의 쓰기 권한 범위 안에서 선택한다.

| 작업 ID | 담당 에이전트 | 브랜치 | Worktree 경로 | 독점 수정 범위 |
| --- | --- | --- | --- | --- |
| FMT-01 | #1 — `launcher develop #1` | `feat/fmt-01-contracts` | `.agents/worktrees/agent-1` | `docs/deployment-format.md`, `packages/core/src/deployment/contracts/`, 해당 인계 문서 |
| DL-02 | #2 — `launcher develop #2` | `feat/dl-02-http-range` | `.agents/worktrees/agent-2` | `packages/core/src/download/http/`, 해당 인계 문서 |
| GAME-01 | #3 — `launcher develop #3` | `feat/game-01-installer` | `.agents/worktrees/agent-3` | `packages/core/src/minecraft/`, 해당 인계 문서 |
| AUTH-01 | #4 — `launcher develop #4` | `feat/auth-01-microsoft` | `.agents/worktrees/agent-4` | `packages/core/src/auth/`, 해당 인계 문서 |
| FMT-02 | #1 — `launcher develop #1` | `feat/fmt-02-writer` | `.agents/worktrees/agent-1` | `packages/core/src/deployment/writer/`, 해당 인계 문서 |
| DL-01 | #2 — `launcher develop #2` | `feat/dl-01-download-sources` | `.agents/worktrees/agent-2` | `packages/core/src/download/google-drive/`, `packages/core/src/download/source/`, `third-party/gdown/`, 해당 인계 문서 |
| GAME-04 | #3 — `launcher develop #3` | `feat/game-04-runtime` | `.agents/worktrees/agent-3` | `packages/core/src/minecraft/`, `packages/core/src/download/full/`, 해당 인계 문서 |
| AUTH-02 | #4 — `launcher develop #4` | `feat/auth-02-host-adapters` | `.agents/worktrees/agent-4` | `apps/launcher/src/main/auth/`, `scripts/auth-smoke.mjs`, `packages/core/package.json`의 auth export만, 해당 인계 문서 |
| DL-01 live | #2 — `launcher develop #2` | `test/dl-01-live-drive` | `.agents/worktrees/agent-2` | 기존 DL-01 소스·테스트·fixture 범위, `docs/handoffs/DL-01-live.md` |
| AUTH-03 | #4 — `launcher develop #4` | `feat/auth-03-public-java` | `.agents/worktrees/agent-4` | auth host·smoke·런처 manifest·lockfile·필요한 main 빌드 설정·공유 결과 설명/export·인계/라이선스 (상세는 배정 문서) |
| FMT-03 | #2 — `launcher develop #2` | `feat/fmt-03-reader` | `.agents/worktrees/agent-2` | `packages/core/src/deployment/reader/**`, `docs/handoffs/FMT-03.md` |
| SYNC-01 | #2 — `launcher develop #2` | `feat/sync-01-engine` | `.agents/worktrees/agent-2` | `packages/core/src/instance/sync/**`, `docs/handoffs/SYNC-01.md` |
| GAME-02/03 | #3 — `launcher develop #3` | `feat/game-02-03-loaders` | `.agents/worktrees/agent-3` | loaders·minecraft·제한된 sync launch guard·game smoke·인계 (상세 배정 문서) |

### 실행 세션

총괄 #0 ID: `01a15961-1386-7fd0-bd22-a71aaf70fdd4`.
아래 세션을 재사용해 2차 작업을 실행한다. 사용자 승인으로 모델 지정 메시지를 전송했다.
기존 실행 중 턴의 모델이 즉시 바뀌었다는 뜻은 아니며 후속 실행부터 적용될 수 있다.
목표 effort는 구현 네 세션 medium, 총괄 일상 low이다. 세션 메시지 도구에 effort 필드가
없으므로 effort 변경은 미적용·미확인 상태이며 앱/CLI 세션 설정에서 조정해야 한다.

| 세션 | 작업 | 모델 | 세션 ID |
| --- | --- | --- | --- |
| #1 | FMT-02 | `gpt-6-luna` 지정 | `01a15a0a-76e2-7230-a0b2-a7a07cd83ea1` |
| #2 | DL-01 | `gpt-6-luna` | `01a15a0a-7f50-7ee3-891a-0d01524073bd` |
| #3 | GAME-04 | `gpt-6.1-sol` 지정 | `01a15a0a-9146-7ee0-9d88-1edda8809abc` |
| #4 | AUTH-03 | `gpt-6.1-sol` (프로토콜·수명주기 설계/구현) | `01a15a0a-9a6b-7e33-9c57-2541b698de36` |

작업 경계는 다음처럼 나누는 것을 기본으로 한다. 아직 생성하지 않은 경로는 배정 시 확정한다.

| 작업 영역 | 수정 범위 예시 |
| --- | --- |
| Drive 링크 처리 | `packages/core/src/download/google-drive/` |
| HTTPS Range 전송 | `packages/core/src/download/http/` |
| 배포 계약·생성·읽기 | `packages/core/src/deployment/` 아래 계약·writer·reader를 각각 분리 |
| Microsoft 인증 | `packages/core/src/auth/` |
| 게임·로더 설치 | `packages/core/src/minecraft/`, `packages/core/src/loaders/` 아래 로더별 분리 |
| 사용자 환경 | `packages/core/src/instance/` 아래 파일 소유권·설정·삭제를 구분 |
| 사용자 UI / 관리 UI | `apps/launcher/` / `apps/admin/` |

- 단위 테스트와 fixture는 해당 작업의 수정 범위 안에 둔다.
- 같은 앱의 main·preload·renderer나 같은 코어 파일을 여러 작업이 건드리면, 파일 단위로
  소유권을 다시 나누거나 작업 순서를 직렬화한다. 디렉터리 이름만 다르다고 독립 작업으로 가정하지 않는다.
- 루트 설정, `pnpm-lock.yaml`, 패키지 manifest·공개 export, 공용 IPC 계약, CI,
  `AGENTS.md`, 아키텍처 문서는 통합 담당자가 조정한다. 의존성·계약 변경은 요청으로 전달한다.
- 공유 파일의 제품 코드 수정은 #0이 구현 세션 하나에 배정한다. #0이 대신 구현하지 않는다.
- 작업 도중 범위를 넓혀야 하면 먼저 배정표를 갱신하고 다른 작업과의 충돌을 확인한다.

## 인계와 머지 절차

1. 에이전트는 작업 브랜치에 변경을 커밋하고, 선행 작업이 포함된 통합 기준에서 검증한다.
2. PR 본문 또는 작업별 `docs/handoffs/<작업-ID>.md`에 아래 인계 내용을 전달한다.
   에이전트별로 다른 파일을 사용하고 이 진행 문서를 직접 수정하지 않는다.
3. `#0` 총괄은 범위·계약·검증 결과를 확인하고 의존 순서대로 머지하며 통합 충돌을 해결한다.
4. 최신 통합 상태에서 관련 테스트를 다시 실행한다. 공유 코어·의존성·IPC 변경 시
   `pnpm check`와 영향받는 앱의 실행 검증을 포함한다.
5. 통합 검증이 끝난 뒤에만 완료로 바꾸고 머지 커밋과 검증 기록을 남긴다.

인계 양식:

```text
작업 ID / 담당 세션 이름 / 브랜치 / 최종 커밋:
사용한 기준 커밋:
변경 내용과 파일 범위:
공유 계약·의존성 변경 요청:
검증 명령 / 결과 / OS:
미검증 항목·제약·차단 요인:
후속 작업:
```

로컬 테스트 성공만으로 머지 완료로 표시하지 않는다. 미커밋 변경을 복사하거나 다른 에이전트의
worktree를 직접 수정하는 방식으로 통합하지 않는다.

## 검증·통합 기록

| 날짜 | 작업 | 반영 커밋 | 검증 결과·남은 확인 |
| --- | --- | --- | --- |
| 2026-10-21 | BASE-01 | Git 초기화 전 | Linux x64 / WSL2, Node.js 24. frozen-lockfile 설치, `pnpm check`와 단위 테스트 12개 통과. 실제 두 앱의 화면·IPC·Node.js 비노출·격리·샌드박스 확인. 두 Linux 포터블 생성·내용 검사·패키징된 실행 파일 검증 완료. Windows·macOS 미검증. |
| 2026-10-21 | BASE-02 일부 | 아직 없음 | `git init -b main` 완료. `git status --short --branch`로 main과 커밋 없음 상태 확인. 기준 커밋·작업별 worktree는 아직 생성하지 않음. |
| 2026-10-21 | BASE-02 완료 | `4d5b4ab` 기반 | 기반 코드 커밋과 네 독립 구현 브랜치·worktree 생성. 배정 문서를 반영한 최신 main으로 착수 기준을 맞춘다. 세션 실행·구현은 미착수. |
| 2026-10-21 | FMT-01 | `5249b3e` (최종 `a84f3b6`) | v1 규격·검증 계약·NFC Unicode 경로 검토 후 통합. writer·reader와 실제 파일 적용은 후속 범위. |
| 2026-10-21 | AUTH-01 | `218dc1b` (최종 `fe0db5c`) | 인증 계약을 GAME-01과 맞춰 통합. 모의 응답 검증이며 실제 계정·앱 등록·안전 저장·시스템 브라우저는 AUTH-02. |
| 2026-10-21 | DL-02 | `f2cdeeb` (최종 `f8a8090`) | 길이 상한·identity 인코딩·수동 HTTPS 리다이렉트·동시 버전 검사 수정 후 통합. Drive 흐름은 미검증. |
| 2026-10-21 | GAME-01 | `4e468ff` (최종 `51ab101`) | OS별 메타데이터 선택·안전한 설치·실행 인자와 호스트별 테스트 수정 통합. 실제 설치·프로세스·로그는 GAME-04, 크래시 복구는 GAME-05. |
| 2026-10-21 | 1차 통합 검증 | `4e468ff` | Linux x64/WSL, Node 24·pnpm 10.34.7. `pnpm check` 성공: Biome·전체 TypeScript·285개 테스트·두 앱 빌드. `node scripts/smoke.mjs`로 두 앱의 실제 화면·IPC·Node 비노출·격리·샌드박스 확인. 새 코어는 앱 미연결 상태이므로 이 smoke는 실제 로그인·게임 실행 증거가 아니다. Windows/macOS 네이티브 검증은 남아 있다. |
| 2026-10-21 | DL-01 코어 | `f7da09b` (최종 `4551783`) | 일반 HTTPS·공개 Drive 공통 소스, generation reset·인덱스 재조회 계약, gdown MIT·원본 커밋 확인 후 통합. 실제 Drive 파일·버전 교체는 사용자 테스트 파일 준비 후 검증하므로 전체 작업은 검토 상태다. |
| 2026-10-21 | GAME-04 | `eb57f9c` (최종 `cce120c`) | 전체 HTTPS 어댑터·공유 서버 lease·프로세스·제한된 마스킹 로그 통합. worker의 실제 Linux x64 1.21.1 설치: payload 1,024,456,840 bytes/4,087 resources, Java 21.0.7 exit 0. 캐시 재설치: 862,331 bytes/5 resources. 영수증은 fixture로 추적하며 실제 게임 접속·타 OS 실행 증거는 아니다. |
| 2026-10-21 | FMT-02 | `ad4d574` (최종 `003d214`) | 기존 v1 계약을 재사용하는 스트리밍 writer, 임시 파일·최종 rename, 입력 변경·취소 검사 통합. Windows symlink 권한별 테스트 분리 수정 포함. Linux focused 46개 성공, Win/mac 실제 생성은 미검증. |
| 2026-10-21 | AUTH-02 구현 | `d84e35b` (최종 `5729b0e`) | loopback 브라우저·Electron 안전 저장·독립 auth smoke 도구, auth export 통합. Windows 테스트 호환성 수정 포함. Linux 실제 basic backend 거부 확인; Windows 저장과 자체 앱 실계정 cycle은 미검증이므로 전체 작업은 검토 상태다. |
| 2026-10-21 | 2차 통합 검사 | `d84e35b` | Linux x64/WSL의 `pnpm check` 성공: Biome·전체 TypeScript·447개 테스트·두 앱 빌드. `node scripts/smoke.mjs`로 두 앱의 화면·IPC·Node 비노출·격리·샌드박스 확인. opt-in 실설치 테스트 1개는 기본 skip이며 worker의 실제 설치·Java 실행 증거는 GAME-04 영수증으로 별도 보존했다. 이 smoke는 실제 인증·게임 접속 증거가 아니다. |
| 2026-10-21 | DL-01 실환경 완료 | `26ac54c` (최종 `c763a63`) | 실제 공개 Drive 파일의 206·처음/중간/끝·반복 구간 검증. 유지한 v1 소스가 새 버전을 감지했고 reset 후 같은 공유 링크에서 v2 수신 확인. 크기는 78,641,842 → 78,641,731 bytes. 안전한 v1/v2 영수증과 opt-in harness 통합. 통합 후 다운로드 29개 테스트 성공·live 2개 기본 skip, core TypeScript·scoped Biome 성공. 전체 파일 비교와 배포 reader/SYNC 흐름의 검증은 아니다. |
| 2026-10-21 | AUTH-02 진단 보완 | `e2ccc79` (최종 `8020eaf`) | Minecraft 단계 403의 정확한 알려진 앱 등록 거부 메시지만 기존 error code로 구분. 다른 403·유사 문구·다른 단계·HTML·크기 초과 응답은 일반 오류 유지, 본문 미노출. `pnpm check` 성공: 457개 테스트·live 3개 기본 skip·전체 TypeScript·Biome·두 앱 빌드. 실계정 재시도 결과는 아직 대기다. |

사용자의 Drive `usercontent` Range 요청 성공은 사전 수동 확인으로만 기록한다.
저장소에서 구현한 다운로드 기능이나 전체 Drive 업데이트 흐름의 검증 완료로 계산하지 않는다.

## 차단·미결정 사항

- AUTH-03 Windows 사용자 실검증: 첫 대화형 로그인은 웹에서 성공했으나 harness 결과 없이
  Electron이 종료됐다. 재실행은 추가 로그인 없이 `login`·`refresh`의 소유권/프로필 검증,
  `logout`·`assert-empty` 모두 성공하고 최종 `liveAuthentication: verified`를 반환했다.
  #4가 실제 Electron/WSLg에서 마지막 창 종료 후 비동기 작업을 수행하는 비인증 검사로
  동일 오류를 재현했다. smoke 앱의 기본 `window-all-closed` 종료가 결과 출력보다 앞섰다.
  smoke 전용 종료 제어 수정 `852b73c`를 `758909b`로 통합했다. 메인에서도 비인증
  `window-cycle`이 Linux/WSLg에서 `soleWindowClosed: true` 결과 출력·정상 종료까지 성공했다.
  worker의 인증 테스트 165개·launcher TypeScript·Biome도 성공했다. 수정 후 Windows 대화형 재실행은 미실시다.
  자체 앱 ID 403의 원인이나 실제 게임 접속까지 검증한 결과는 아니다.
- FMT-02 인계와 검토 수정 `003d214`를 통합했다. v1 계약·스트리밍·게시 전 실패 보존을 확인했다.
  Windows symlink 권한이 없으면 해당 테스트만 명시적으로 건너뛰며 다른 파일 보호 검증은 유지한다.
  작업 브랜치의 검사 성공은 Windows 실제 검증을 뜻하지 않는다.
- AUTH-02는 WSL의 `basic_text` backend를 안전하게 거부했다. 이후 #4 세션에서 사용자가
  앱 등록과 개인 계정 지원 설정(`api.requestedAccessTokenVersion: 2` 포함)을 진행했다.
  실제 인증은 Microsoft/Xbox 단계를 지나 `stage: minecraft`, HTTP 403으로 중단됐다.
  현재 요청은 `POST https://api.minecraftservices.com/launcher/login`이며 소유권·프로필 검사 전이다.
  앱 API 접근 허용 문제인지 요청 방식 문제인지는 아직 확정하지 않는다. Windows 저장 cycle의
  개별 결과와 재시작 후 갱신·로그아웃 증거는 #4 인계에 보완하며 AUTH-02 전체 완료로 처리하지 않는다.
  검토 수정 `5729b0e`로 기본 테스트의 host platform·Unix 권한 검사·symlink capability를 분리했다.
- AUTH-02 403 원인 조사를 시작했다. 현재 Prism의 Minecraft endpoint/body와 일치함을 확인했다.
  #4에 `fix/auth-02-minecraft-rejection`의 좁은 서버 오류 분류·테스트를 배정했다.
  explicit invalid-app-registration만 기존 code로 구분하고 일반 403을 같은 원인으로 단정하지 않는다.
- 진단 보완 `8020eaf`를 `e2ccc79`로 통합했다. 인증 테스트 148개·core TypeScript·scoped Biome 성공.
  사용자는 테스트 계정의 Minecraft 소유권을 확인했다. 이는 사용자 보고이며 실제 entitlement 조회는 아직 도달하지 못했다.
  기존 실패 응답 원문은 보존하지 않았으므로 이전 403의 세부 원인을 소급 확정하지 않는다.
  다음 증거는 같은 자체 앱·계정으로 기존 Windows smoke를 재실행한 정제된 error code다.
  통합 후 두 Electron 앱의 화면·IPC·격리·샌드박스 smoke도 통과했다. 실제 로그인 재실행을 대신하는 검사는 아니다.
- 사용자가 재시도했으나 `http_failed / minecraft / 403`을 다시 보고했다. 좁은 분류가
  인식하는 명시 응답은 아직 확인되지 않았으며 정확한 원인은 미확정이다.
- 사용자 제공 [Microsoft authentication 문서](https://minecraft.wiki/w/Microsoft_authentication)의
  OAuth 절을 직접 읽었다. 문서는 새 Azure 앱의 별도 Minecraft API 사용 승인과 미승인 시 403을 명시하며,
  [신청 링크](https://aka.ms/mce-reviewappid)를 제공한다. 실제 링크가 Microsoft Forms로 연결됨을 확인했다.
  현재 접수 가능 여부·필수 입력·승인 소요 시간은 확인하지 못했다. 앱 등록과 API 접근 승인을 구분하고,
  승인 여부 확인을 다음 단계로 우선한다. 추가 진단 harness는 제안만 받았으며 구현하지 않았다.

2026-10-21 범위 변경: 연결 해제 시 게임 자동 종료와 보조 모드는 제외했다.
연결 해제 후 게임 기본 화면·종료 동작을 유지하며 MOD-01·MOD-02 완료를 릴리스 조건으로 요구하지 않는다.

현재 등록된 실행 중 차단 작업은 없다. 다음 사항은 해당 작업 착수 시 결정·검증한다.

- FMT-01의 v1 표현·크기·서버 식별 계약은 확정했다. 해시는 손상 검사이며 서명·발행자 신뢰·되돌리기 방지 정책은 RELEASE-01에서 결정한다.
- AUTH-02: 자체 앱을 사용한 Minecraft 단계 HTTP 403 원인 확인과 실계정 cycle 완료가 필요하다. #4는 사용자 테스트 결과·오류 단계가 바뀔 때 #0에도 알린다. 비밀번호·인증 코드·토큰을 대화로 요청하지 않는다.
- FMT-03: 검증된 일반 HTTPS·Drive 소스에 배포 인덱스·파일별 해시 검증을 연결한다. 이번 실제 Drive 파일과 크기가 달라진 새 버전 검증을 모든 확인 페이지·다운로드 제한·만료 조건의 실검증으로 확대하지 않는다. 검증자 없는 동일 길이 교체는 HTTP만으로 감지할 수 없어 파일별 해시 검증이 필요하다.
- GAME-04 / GAME-05: 실제 Java·게임 실행과 로그 관리, 설치 크래시 복구가 남아 있다. 현재 stale lock은 수동 복구만 가능하다. Linux ARM64는 사용자 결정(2026-10-21)으로 지원 대상에서 제외한다. 별도 런타임 정책은 필요 없다.
- USER-01 / USER-02: 모드 ID·파일 경로 충돌과 개인·필수 설정이 섞인 파일의 처리.
- RELEASE-01 / RELEASE-02: OS·CPU 지원 범위, 서명, 코어 업데이트와 서버 설정 보존.

## 2026-10-21 정리

- Linux ARM64: 사용자 결정으로 지원하지 않는다(RELEASE-01의 지원 범위에서 제외).
- Linux/WSL의 native Electron `game-smoke install`은 호스트 결과 파일 보강(`35f5734`) 후 Fabric 0.19.5로 재실행해
  `ok:true, installed:true`를 확인했다(공식 설치기 실행 포함). 이전 "결과 없이 종료"는 해소됐다.
- `authenticatedConnection: "not-asserted"`는 의도된 고정값이다. 호스트는 Java 프로세스의 spawn·종료 코드만
  관찰하며 서버 접속 여부를 측정하는 신호가 없다. 접속 증거는 사용자 확인 또는 서버 콘솔 로그로 별도 기록한다.
  제품 수준의 자동 접속 확인은 UI-01(서버 상태)·UI-02에서 다시 설계한다.
- 병합 완료된 작업 브랜치를 모두 삭제했고(`main`만 남음) `.agents/worktrees/agent-1~4`는 `main` 기준 detached 상태다.
  새 작업은 `main`에서 새 브랜치를 만들어 시작한다.

## 2026-10-21 USER-01/02/03 코어 통합

- 코어만 구현·통합했다(UI/IPC 미연결). USER-01 `4703dc1`(사용자 모드 registry·읽기 전용 sync 소유권), USER-02 `f0f34e6`
  (settings-policy·options.txt 항목별 적용·리소스팩), USER-03 `96533f8`(서버 데이터 경로·용량·확인 토큰 기반 삭제)를 `main`에 병합했다.
  `packages/core/src/instance/index.ts`에 네임스페이스 export(`data`·`mods`·`settings`·`sync`)를 추가했다. 패키지 공개 export는 UI-02에서 정한다.
- 메인 `pnpm check` 성공: 644개 테스트·opt-in 7개 skip·전체 TypeScript·Biome·두 앱 빌드. Linux/WSL만 검증했다.
- 미검증: Windows junction/reparse·macOS, 실제 프로세스 강제 종료 복구(모의 의도 기록으로만 검증), 실제 게임이 다시 쓰는 `options.txt`와의 호환,
  USER-01 `readSyncOwnership`와 USER-02 `applySettingsPolicy`의 실제 결합 호출(별도 선언된 동일 형태 타입을 사용).
- UI-02 연결 순서(제안): `ensureServerDataRoot` → 설치/`synchronizeDeployment` → `readSyncOwnership` → `applySettingsPolicy(root,{ownership})` →
  `assertSynchronizedForLaunch` → 게임 실행. 삭제는 같은 main 프로세스에서 `previewServerDataDeletion` 후 `deleteServerData`(확인 토큰은 프로세스 메모리에만 존재).
  main 프로세스가 같은 서버의 설치·실행·삭제를 직렬화해야 한다. 상세는 `docs/handoffs/USER-0{1,2,3}.md`.

## 2026-10-22 USER 후속 통합

- USER-01 후속: 사용자 모드 등록 전 디스크 여유 공간 검사(`insufficient-space`, jar+max(64MiB,10%)) 통합. ZIP64 jar는 계속 미지원(ID 검사만 생략, 등록 허용).
- USER-02 후속: 실제 1.21.1 `options.txt`(데이터 버전 3955, CRLF)를 fixture로 검증했고(`fixtures/.gitattributes`로 줄바꿈 보존),
  기본 리소스팩 목록을 `["vanilla"]`에서 `[]`로 바꿨다. 버전별 포맷 프로파일을 추가했다: `java-1.21.1`(검증), `java-1.13-1.21`(조사 기반·미검증,
  `versionPolicy: 'allow-researched'`일 때만), 그 외는 `unsupported-options-version`으로 거부. 1.21.1 외 버전 지원 시 프로파일 정책과 fixture 추가 필요.
- 메인 `pnpm check` 성공: 655개 테스트·opt-in 7개 skip·전체 TypeScript·Biome·두 앱 빌드.
- 조사한 Drive 동작: 공개 링크는 `Last-Modified`만 주고 ETag와 304(Not Modified)는 지원하지 않는 것으로 관찰했다(한 파일 기준). 현재 최신 확인은 Range로 헤더·인덱스만
  읽고 해시로 판단하므로 조건부 요청은 사용하지 않는다.
- USER-02 후속(3955 초과): `java-1.21.2+` 프로파일(데이터 버전 3956–5023, Minecraft 1.21.2~26.3, 조사 기반·미검증, `allow-researched` 이상에서만 사용)을 통합했다.
  근거는 minecraft.wiki 문서에 3955 이후 `version`·`resourcePacks`·`key:value` 구조 변경 기록이 없다는 부재 증거뿐이며, 실제 3955 초과 클라이언트 파일 검증은 없다.
  데이터 버전 숫자는 #0이 Data_version 문서로 대조했다(1.21.2=4080, 26.3=5023). 5024 이상은 기본 거부, `allow-any`만 경고와 함께 처리. 메인 `pnpm check` 성공(658개 테스트).
  병합된 작업 브랜치를 모두 삭제했고 `main`만 남았다(워크트리는 `main` 기준 detached).

## 2026-10-22 지원 OS 결정

- macOS는 당분간 지원하지 않는다(사용자 결정). 지원 대상은 Windows x64와 Linux x64이다. BASE-04는 보류하고 RELEASE-01의 선행에서 제외했다.
  macOS 전용 코드와 검증은 만들지 않으며, 프로세스 식별 등 OS별 조회가 불가능한 환경에서는 안전하게 '불확실'로 폴백한다.
  AGENTS.md의 지원 OS 문구를 갱신했다. macOS를 다시 지원하려면 별도 승인과 BASE-04 재개가 필요하다.

## 2026-10-22 GAME-05 통합

- GAME-05 `50a4908`을 병합했다. 서버 잠금 owner.json v2(pid·프로세스 시작 식별자·머신 ID 해시·자식 Java 기록), 설치 transaction 분리,
  `inspectServerEnvironment`/`recoverServerEnvironment`(stale 잠금 자동 회수는 같은 머신에서 주인·자식 모두 종료/PID 재사용이 확인된 경우만,
  그 외는 `uncertain`이며 사용자 확인 `acceptUncertain`이 필요하고 자식 Java가 살아 있으면 거부), 설치 journal 롤백/완료 복구, 기존 동기화·사용자 모드 복구 호출.
- 검증: 메인 `pnpm check` 성공(697개 테스트·opt-in 7개 skip·전체 TypeScript·Biome·두 앱 빌드). Linux에서 실제 SIGKILL 테스트(자식이 주인보다 오래 사는 경우,
  PID 재사용, v1 잠금, 설치 rename 1~5 단계 중단, 복구 도중 중단 재실행)를 통과했다. 킬 테스트 스위트 타임아웃은 병렬 부하 때문에 60초로 늘렸고, 8회 연속 전체 통과.
  1회 원인 불명 실패(재현 안 됨)는 인계에 기록됨.
- 미검증: Windows 실제 프로세스 종료, 전원 차단 내구성(fsync), 실제 NeoForge 설치기 강제 종료. macOS는 지원하지 않으며 항상 `unknown`→`uncertain`.
- UI-02 연결 지점: `ServerDataLockedError`/`EINSTALLRECOVERY` 수신 시 inspect→recover, `lock-uncertain`+`confirmable`이면 "아무것도 실행 중이 아님" 확인 후 `acceptUncertain: true`.
  `minecraft/recovery`는 아직 상위 export에 연결하지 않았다.

## 2026-10-22 GAME-05·USER Windows 검증

- 사용자가 Windows 11(Node 24)에서 `vitest run packages/core/src/minecraft packages/core/src/instance`를 실행했다. 최종 결과: **Test Files 16 passed | 2 skipped,
  Tests 234 passed | 14 skipped, 실패 0**. 14개 skip은 symlink 생성 권한이 없는 환경에서 건너뛴 테스트(개발자 모드/관리자에서 실행 가능)와 기타 의도된 skip이다.
- 처음 실행에서 6건 실패: symlink 권한(EPERM) 5건, 호스트 종료 시 자식 프로세스 생존 가정 1건, profiles 타임아웃 1건. 진단으로 확인한 사실:
  Windows(Node)에서는 호스트를 강제 종료하면 자식 프로세스도 함께 종료되고(`child absent`), 프로세스 시작 시각 조회는 같은 프로세스에 대해 안정적이다.
  제품 판정 로직은 올바르며 테스트 가정과 환경 문제였다. 수정은 테스트(Windows 기대값 분리, symlink capability skip, 반복 테스트 타임아웃 30초)와
  `lock.ts`의 Windows `renameWithRetry`뿐이다.
- 아직 검증되지 않은 것: Windows에서 자식이 호스트보다 오래 사는(`held-live`) 실프로세스 경로(Linux 실프로세스와 주입 테스트로만 확인),
  Electron 메인 프로세스에서 띄운 Java가 호스트 강제 종료 시 함께 종료되는지, 전원 차단 내구성, 심볼릭 링크 거부 로직의 Windows 실행(개발자 모드 필요).
- `applySettingsPolicy` 한 번 호출은 Windows에서 약 1초 안팎이다. UI-02에서 진행 표시를 고려한다.

## 2026-10-22 Windows 네이티브 검증 종합 (BASE-03)

- Windows 11 Pro(10.0.26300), Node 24.22.0, pnpm 10.34.7, Electron 44.9.1에서 검증 워커(Claude Code)가 실행했다.
  `pnpm check` 통과(37 파일 통과·4 skip, 686 테스트 통과·27 skip·0 실패, 수정 적용 상태), `pnpm smoke`로 두 앱의 renderer·IPC·샌드박스 확인,
  `pnpm package:launcher`/`package:studio` 성공(TorchLauncher-0.1.0-win-x64.exe 96.1 MB, Studio 95.6 MB) 및 포터블 exe 실행·메인 창 확인. 서명은 `NotSigned`.
- 발견·수정한 **제품 결함**: `deployment/reader`의 gzip stage 경로에서 취소 시 `inflater.write` 콜백이 유실되면 Promise가 영구 pending되어 취소가 끝나지 않는 경쟁(Windows 약 45% 재현).
  `inflater`의 `close`에서도 write 대기를 종료하도록 우회 수정(`3f9e54b`). 근본 원인은 Node 내부 콜백 유실로 추정되며 Node 이슈 여부와 최소 재현은 미확인.
  Linux에서는 재현되지 않았다. 수정 후 Windows 30회 반복 통과.
- 확인된 사실: Windows에서 일반 `spawn` 자식은 호스트(Node·Electron 모두) 강제 종료 시 함께 종료되고, `detached`는 생존한다. 제품의 Java 실행은 `detached`를 쓰지 않는다.
- 미검증/남음: 개발자 모드에서의 symlink 테스트 14개, 서명·SmartScreen(RELEASE-01), writer의 Windows 소스 교체 감지 경로(테스트 skip), `fileParallelism` 조정 필요 여부.

## 2026-10-22 배포·서명·업데이트 정책 결정

- 사용자 결정: 런처 프로그램 업데이트는 앱이 확인하고 동의 후 교체, 배포 파일(torchpack)은 운영자 서명 검증과 롤백 방지, 공식 런처는 GitHub Releases에 배포한다.
  Windows 코드 서명은 비용 문제로 **하지 않기로 확정**했다(재검토 조건은 문서에 기록). 상세와 조사 결과는 [배포·서명·업데이트 정책](release-policy.md).
- RELEASE-01/02와 별도 구현(배포 서명·롤백 방지, 런처 자동 업데이트, 서버 설정의 최소 런처 버전)의 선행 조건이다. 구현은 사용자 승인 후 배정한다.

## 2026-10-22 런처 UI 재작성 L1 통합

- 런처 UI L1(`3452ae1`)을 병합했다: 디자인 토큰, 접이식 메뉴(기본 닫힘), 시작 애니메이션(최소 2.2초·로딩 대기), 홈과 상태별 표현(로그인·설치·실행·오류),
  게임 종료 확인. 기존 내 모드·설정·문제 해결 페이지는 L2 전까지 새 셸 안에 유지. 명세는 [런처 UI 명세](launcher-ui.md), 인계는 [LAUNCHER-UI-L1](handoffs/LAUNCHER-UI-L1.md).
- `docs/design/`(시안 참고 소스)을 Biome 검사에서 제외했다(`8c7ed2a`). 메인 `pnpm check` 성공: 859개 테스트·opt-in 9개 skip·전체 TypeScript·Biome·두 앱 빌드.
  Linux/WSLg smoke와 스크린샷 비교만 확인했다. Windows 네이티브 실행·실제 로그인/서버/게임·한글 글꼴 렌더링은 미검증이다.
- 후속(L1b, 계약 변경): `ProductState`에 게임 정보(버전·로더)와 게임 시작 시각 추가, Pixelify Sans OFL 고지를 패키지에 포함. L2: 내 모드·설정·로그 페이지, 확인 창, 세션·복구 자동화.
- L1b(`2a7a6d9`)를 병합했다: 한글 글꼴 Pretendard Variable(2.06 MB) 번들, 텍스트 선택·끌기·드롭 차단, `ProductState`에 `game`·`runningSince` 추가, 글꼴 OFL 고지를 패키지에 포함.
  메인 `pnpm check` 성공(862개 테스트·opt-in 9개 skip). `game`은 실행 준비 단계에서 채워져 시작 직후에는 로더가 비어 있을 수 있다(서버 구성 파일에 게임 필드 추가는 Studio 구현 때). Windows 네이티브 확인은 미실시.
- 메뉴 열기·닫기 애니메이션(`6091299`)을 병합했다: 하나의 컨테이너에서 폭 220ms(열기)/200ms(닫기) 전환, 라벨은 100ms 지연 페이드, 모션 줄이기 시 즉시 전환, 연타·접근성 속성 유지.
  메인 `pnpm check` 성공(863개 테스트). 전환 중간 프레임은 직접 캡처하지 못했고(시작·끝 프레임만 확인) Windows 실제 체감은 미확인. 토글 아이콘 교차 페이드 보정(60ms) 후 재캡처는 하지 않았다.
- 결정: 게임 파일 전체 해시 확인을 매번 유지한다. L2에서 진행 패널을 실제 순서(정보 확인 → 게임 파일 확인·받기 → 로더 → 서버 동기화) 요약으로 바꾼다([런처 UI 명세](launcher-ui.md)).
- L1c(`81a3d48`)를 병합했다: 시작 애니메이션 최소 길이 1.6초(모션 줄이기 0.7초), 메뉴 상단 서버 이름 2줄 줄바꿈·title 전체 이름, 서버 구성 파일 `torchlauncher-server.json`에 선택 필드 `game`
  (`minecraftVersion`, `loader{kind,version}`) 추가 — 런처가 시작 직후부터 버전·로더를 표시하고 Studio 내보내기가 값을 기록한다(기존 파일은 계속 유효). 메인 `pnpm check` 성공.
  구성과 배포 인덱스의 game이 다를 때는 인덱스 값을 따라 설치·표시하고 `unsupported-game`만 실패한다(불일치 시 명시 오류로 막을지는 Studio 내보내기 차단 규칙과 함께 구현 단계에서 결정).
- L2b(`e950189`)를 병합했다: 시작·플레이 시 서버 환경 자동 점검과 `stale-verified` 자동 복구(확인 없이, 로그 기록), `uncertain`은 자동 복구하지 않고 `recovery.needed/confirmable`로 표시하며
  플레이를 `recovery-required`로 차단, `held-live`는 복구하지 않음, `invalid` 항목이 섞이면 자동 복구하지 않음. 로그는 `{source: 'launcher'|'game', text}`로 구분(런처 200줄 + 게임 300줄).
  세션은 시작 시 조용히 복원하고 플레이 중 갱신, 실패 시 로그인 필요로 복귀. 메인 `pnpm check` 성공(873개 테스트). Windows 실제 비정상 종료 시나리오는 미검증.
  (병합 직후 `pnpm check` 실패는 로컬 무시 파일 `ui-server.json`의 포맷(줄바꿈 누락) 때문이었고 수정했다.) 다음: L2a(렌더러 페이지·확인 창·진행 패널).

## 런처 UI L2a 통합 (2026-10-23, #0)
- `7c13c82`(작업자 Sonnet)를 `--no-ff`로 병합. 내 모드 · 설정 · 로그 페이지, 앱 안 삭제/복구 확인 창, 실제 단계 순서의 진행 패널(게임 파일 단계만 측정된 개수/전체 비율), i18n 이동, 레거시 페이지 제거.
- 사용자 결정으로 OS 대화상자(`confirmDeletion`, `confirmRecovery`)를 모두 제거. 삭제 확인은 앱 안 창 + 코어 확인 토큰, 복구는 앱 안 창 체크.
- 통합 검증: `main`에서 `pnpm check` 통과(896 통과/9 건너뜀, Biome, 타입, 두 앱 빌드). Linux 스모크와 760/1100px 스크린샷은 작업자 보고. Windows, 실제 계정·서버·삭제·복구 종단 검증은 미실시.
- 후속 요청은 `docs/launcher-ui.md` 하단에 기록. 다음: L3(운영자 브랜딩, 스킨 얼굴).

## UI-FEEDBACK-01 통합 (2026-10-23, #0 Claude)
- GPT 세션이 사용량 소진으로 중단되며 완성된 작업(`8ac076f`)이 워크트리에 미커밋 상태로 남아 있었다. 내용 검토 후 #0이 그대로 커밋하고 `--no-ff`로 병합했다.
- 홈 글자·버튼이 가려지던 회귀의 원인(브랜딩 배경 자식 요소의 쌓임 순서)을 `.branding-background { isolation: isolate; pointer-events: none }`으로 수정하고, 스모크가 실제 그려진 픽셀과 클릭 대상을 검사하도록 강화.
- 설정에 서버 데이터 전체 경로 복사 버튼 추가. 렌더러 클립보드 권한이 거부되므로 인자 없는 전용 IPC `copyServerDataPath`(메인이 현재 경로를 Electron 클립보드에 기록)로 구현.
- 메인 `pnpm check` 통과(1053 통과/9 건너뜀). 이 세션의 수정(`15d16bd`: 모드 등록 시 상단 진행 줄 제거, 서버 데이터 카드 안 용량 로딩바)과 충돌 없음.
- 미검증: Windows 네이티브 홈 표시, 실제 클립보드 붙여넣기.

## 경로 복사 아이콘·토스트 통합 (2026-10-23, #0 Claude)
- `b4b676e`(Sonnet 작업자) 병합: 설정의 경로 복사가 아이콘 전용 버튼이 되고, 결과는 앱 하단 토스트(성공 2.5초, 실패 4초, 새 토스트가 이전 것을 대체, 클릭 비차단, 모션 줄이기 존중)로 표시. 경로 밑 결과 문구 제거. 메인 `pnpm check` 통과.
- 알려진 한계: 760px에서 토스트가 삭제 버튼 왼쪽 가장자리 위에 겹쳐 보일 수 있음(클릭은 통과). 스크린리더 안내는 직접 확인하지 못함. Windows 확인 필요.
- 사용자 결정: 런처 자동 업데이트(RELEASE-02)는 Studio까지 끝낸 뒤 함께 진행한다.
- 배포 서명(SIGN) 명세 `docs/deployment-signing.md` 작성, SIGN-CORE-01 배정(진행 중, feat/sign-core, agent-2).

## 인앱 확인 모달 통합 (2026-10-23, #0 Claude)
- `6b79517`(Sonnet 작업자) 병합: 로그아웃과 등록 모드 제거의 `window.confirm`을 공용 `ConfirmDialog`(기존 `Modal` 기반)로 교체. 확인 후에만 `logout`/`remove-mod` 명령 전송, Esc·취소는 아무 동작 없음. 런처 렌더러에 네이티브 확인창이 남아 있지 않다.
- 의도적 예외: 메인 프로세스의 종료 확인 실패 오류 상자(창이 닫히는 중). Studio의 네이티브 대화상자는 Studio UI 재작성 단계에서 정리.
- 메인 `pnpm check` 통과. 스모크는 합성 상태와 IPC 기록기 기반이며 실제 계정 흐름은 Windows 확인 필요.

## SIGN-CORE-01 통합 (2026-10-23, #0 Claude)
- `63c89e0`(Sonnet 작업자) 병합: 배포 형식 1.2(헤더 64B + 서명 64B + 인덱스 + 페이로드, `sequence` 필수), 서명 메시지 `"TORCHPACK-SIG-v1\0"||헤더`, writer의 주입식 `sign`, reader의 `trustedPublicKey`(검증 순서 강제, 키가 있으면 무서명 1.0/1.1을 인덱스 요청 전에 거부), `reader.verification`(`verified|unverified|unsigned`), 서버 구성 `signing`, 순수 `decideRollback`, Studio용 `deriveEd25519PublicKey`/`createEd25519Signer`.
- 메인 `pnpm check` 통과(1124 테스트). 명세는 [배포 서명 명세](deployment-signing.md).
- 알려진 설계 한계: 잘못된 서명과 잘못된 키는 구분되지 않음(`signature-invalid`, 키 ID 없음). 페이로드 바이트는 직접 서명하지 않고 서명된 인덱스의 파일 해시가 보호한다.
- 후속: SIGN-STUDIO-01(Studio 비UI), SIGN-LAUNCHER-01(런처 메인) 배정. 런처는 `verification`을 필수로 조이고 구성에 `signing`이 있으면 항상 키를 전달해야 한다.

## SIGN-LAUNCHER-01 통합 (2026-10-23, #0 Claude)
- `3947668`(Sonnet 작업자) 병합: 서버 구성에 `signing`이 있으면 모든 reader에 공개 키를 전달하고 `verified`가 아니면 파일 준비·적용 전에 중단. 롤백 판정(`decideRollback`)은 적용 전에 읽기 전용으로 수행, 상태는 동기화 성공 뒤에만 `<userData>/servers/<serverId>/.torchlauncher-deployment-state.json`에 원자적으로 기록(서버 데이터 삭제 시 함께 삭제, 손상·초과·형식 오류는 fail-closed). 브랜딩 갱신 reader는 검증·판정만 하고 상태를 올리지 않음. `signing` 없는 구성은 기존 동작.
- 새 실패 코드 8종을 한국어 메시지로 연결. 메인 `pnpm check` 통과.
- 한계: 코어의 `verification`이 선택 필드라 런처는 구체 반환 타입에서 읽고 누락을 비신뢰로 처리(조이려면 코어 변경 필요). `docs/deployment-signing.md`에 저장 위치·브랜딩 규칙은 핸드오프 문서에만 기록됨. 실제 서명된 배포로의 종단 검증은 Studio 통합(SIGN-STUDIO-01) 이후.

## SIGN-STUDIO-01 통합 (2026-10-23, #0 Claude)
- `cd5469f`(Sonnet 작업자) 병합: 프로젝트별 Ed25519 키(`<userData>/signing-keys/`, Electron `safeStorage` 암호화, 사용 불가 시 서명·생성 거부), 비밀번호 기반 백업/복원(scrypt N=2^17 + AES-256-GCM, 12자 이상), 배포마다 `sequence` 예약(실패한 빌드는 번호만 소모, 감소 없음), 형식 1.2로 서명한 torchpack 생성, 내보내기 구성 파일에 `signing` 기록. 좁은 IPC `keyStatus/keyCreate/keyExport/keyImport`, UI 화면 없음.
- 메인 `pnpm check` 통과(1137 테스트 기준 워커 보고, 통합 후 재실행 통과). 키 파일·프로젝트·산출물에 개인 키 원문이 없음을 테스트로 확인.
- 한계/후속: Studio `check` 명령은 아직 공개 키로 서명을 검증하지 않음(재배포 전 무서명 팩이 실패하게 되므로 UI 단계에서 결정). Linux `basic_text` 키링에서는 서명 불가. 내보내기가 실패해도 새로 만든 키는 남음. 실제 `safeStorage`·Windows·네이티브 백업 대화상자는 미검증. `useStudio.ts`에 새 오류 코드 문구만 추가(UI 재작성 때 정리).
- 이로써 SIGN 코어·런처·Studio 함수가 모두 `main`에 통합됨. 종단 검증(Studio가 서명한 팩을 실제 호스팅에서 런처가 검증)과 Windows 확인은 미실시.

## Studio UI 시안 적용 + 신규 기능 착수 (2026-10-23, #0 Claude)
- 시안 `docs/design/studio/`(`d30b099`), 명세·작업 분해 `docs/studio-ui.md`(`c5035df`). 사용자 지시로 UI 적용과 신규 기능(게임 설정, 파일 diff, 배포 상태, 런처 ZIP 내보내기)을 병렬 진행.
- 배정(모두 background 작업자, 통합은 #0만): STUDIO-UI-01 agent-1 `feat/studio-ui-shell`(renderer 독점), SET-CORE-01 agent-2 `feat/settings-core-shaders`(core 설정 정책 독점), STUDIO-MAIN-01 agent-3 `feat/studio-main-features`(admin main/shared/preload 독점). 기준 `c5035df`.
- 후속: 세 작업 통합 후 STUDIO-UI-02(실제 API 연결) 배정. 아직 어떤 작업도 통합·검증되지 않았다.
- SET-CORE-01 `8284a53`/`e74b354` → `37a56a8` 통합(--no-ff). main `pnpm check` 성공(로그 환경 로컬). 설정 정책 v2(`configFiles`: 셰이더·모드 설정 파일), Studio용 `parseOptionsEntries`/`buildSettingsPolicy` API. 런처 호출부 변경 불필요, 단 v2 정책은 이 변경을 포함한 런처가 필요(구 런처는 거부). 한계: key=value ASCII만, Iris/Oculus 키·경로는 실게임 미검증. [인계](handoffs/SET-CORE-01.md). 남은 작업자: STUDIO-UI-01, STUDIO-MAIN-01 진행 중.
- STUDIO-MAIN-01 `b5dc955`/`490cd16`/`8481494` → `b5700c8` 통합(--no-ff). main `pnpm check` 성공(1280 통과/9 skip). 파일 diff·일괄 정책·배포 상태/주소 검사 세분화·런처 ZIP 내보내기(Node 내장, ZIP64 없음, 32비트 크기 제한)·게임 설정 프리셋/팩(v1 정책 API)·네이티브 확인창 제거(`UNSAVED`+`discard`, `studio:close-request`). 한계: 셰이더/모드 설정은 코어 v2 연결 전(STUDIO-MAIN-02), 이전 빌드 프로젝트는 한 번 재빌드해야 내보내기 가능, Windows·실제 선택창·실 HTTP range 미검증. 렌더러는 UI-01 통합 전까지 `discard` 미전송이라 더티 프로젝트 교체가 `UNSAVED`로 막힌다. [인계](handoffs/STUDIO-MAIN-01.md).
- STUDIO-UI-01 `517de3b`/`60dd4cc` → `b6aa808` 통합(--no-ff, `useStudio.ts` 충돌은 오류 문구를 i18n 카탈로그로 이전해 해결하고 UNSAVED/BLOCKED/TOO_LARGE 문구 추가). main `pnpm check` 성공(1293 통과/9 skip), `scripts/smoke.mjs` 두 앱 성공, Studio 기능 smoke 성공(브리지 키에 `onCloseRequest` 반영). 시안 적용·런처 글꼴 번들·앱 안 저장 확인창·`noNativeDialogs` 테스트 포함. 게임 설정 페이지는 아직 예시 데이터. 한계: Windows·패키지 빌드 미검증, 패키지에 글꼴 OFL 고지 포함 설정 미확인. 다음: STUDIO-UI-02(실제 API 연결), STUDIO-MAIN-02 진행 중.
