# Studio UI 재작성과 신규 기능 명세

2026-10-23 사용자 지시: Studio 시안 적용과 시안에 새로 생긴 기능 구현을 **동시에** 진행한다. 시안 소스는 [`docs/design/studio/`](design/studio/README.md)(런처 시안과 같은 토큰). 기존 계약(저장 형식, 서명, 브랜딩, 빌드)은 깨지 않고 확장만 한다. 계약 변경은 #0과 조정한다.

## 신규 기능 (현재 Studio에 없음)

1. **게임 설정 섹션** (시안 Settings\*, DialogPreset): 운영자가 게임을 한 번 실행한 폴더의 `options.txt`(및 모드/셰이더 설정 파일)를 불러와 항목별로 정책을 정한다.
   - 항목별 3상태: **정하지 않음**(정책 없음) / **최초 기본값**(`initial`) / **항상 고정**(`required`). [설정 정책 v1](settings-policy.md)의 `required`/`initial`에 대응한다.
   - 탭: 단축키(`key_*`, 모드 단축키 구분·검색·그룹) / 소리·화면(그 외 옵션) / 리소스팩(추가 .zip, 순서, 정책) / 셰이더(셰이더팩 추가, 사용 여부, 선택 팩, 세부 옵션).
   - 결과는 배포 시 `torchlauncher/settings-policy.json`(always)과 팩 파일 `resourcepacks/*.zip`·`shaderpacks/*.zip`으로 만들어진다. `options.txt` 자체는 배포 파일에서 제외(시안 Files의 "게임 설정에서 관리").
   - 셰이더 선택/세부 옵션(iris/optifine 설정 파일, 팩별 옵션 파일)은 정책 v1이 지원하지 않는다 → 코어 확장 필요(아래 SET-CORE).
2. **파일 섹션 개선** (시안 Files): 소스 폴더 다시 읽기, 마지막 배포와 비교한 추가/수정/제외 표시, 선택 파일 정책(항상 적용 / 최초 설치만 / 제외) 일괄 변경, `options.txt`·리소스팩·셰이더팩은 게임 설정에서 관리.
3. **개요** (시안 Overview): 마지막 배포·서버 정보·브랜딩·파일·내보내기 상태 요약, "다시 만들기 필요" 판단.
4. **배포 상태** (시안 DeployChanged/Ready): 변경됨/최신 판정, 주소 검사 항목별 결과(서버 ID, 게임 환경, 파일 목록, 범위 다운로드).
5. **런처 내보내기 ZIP** (시안 Export\*): 공통 런처 파일 + 서버 설정을 **ZIP 하나**로 출력, 서버 ID/게임 환경/주소 검사 불일치면 차단(시안 ExportBlocked), 완료 화면에서 폴더 열기.
6. 저장하지 않은 변경 확인(DialogUnsaved), 시작 애니메이션(Splash), 사이드바 섹션: 개요·서버 정보·브랜딩·파일·게임 설정·배포·내보내기.

## 작업 분해와 독점 범위

공유 파일은 한 작업자만 소유한다. 의존 순서: SET-CORE → STUDIO-MAIN(설정 부분) → STUDIO-UI(게임 설정 페이지 연결).

| ID | 내용 | 독점 범위 | 브랜치 |
| --- | --- | --- | --- |
| STUDIO-UI-01 | 시안 적용: 앱 셸/사이드바/스타일 토큰/Splash, 서버 정보·브랜딩·파일·배포·내보내기·개요·확인 창을 **기존 API**로 시안대로 재작성. 게임 설정 페이지는 레이아웃과 로컬 상태까지(서비스 연결은 후속). 시안의 신규 기능 중 API가 아직 없는 곳은 숨기지 말고 `fixtures` 기반 표시. | `apps/admin/src/renderer/**`, `apps/admin/scripts/*smoke*`(renderer 관련), `docs/handoffs/STUDIO-UI-01.md` | `feat/studio-ui-shell` |
| SET-CORE-01 | 설정 정책 확장: 셰이더 설정(선택 팩/사용/팩별 옵션)과 모드 설정 파일 항목을 정책으로 표현·적용(하위 호환, v1 파일 계속 유효), `options.txt` 편집용 파서 재사용 API(키 목록, 단축키 판별, 정렬)와 [설정 정책](settings-policy.md) 갱신. | `packages/core/src/instance/settings/**`, `docs/settings-policy.md`, `docs/handoffs/SET-CORE-01.md` | `feat/settings-core-shaders` |
| STUDIO-MAIN-01 | Studio 메인/IPC: 프리셋 불러오기(options.txt 읽기·모드 설정 파일 탐지), 리소스팩/셰이더팩 추가, 정책 저장(프로젝트 파일)과 배포 시 `settings-policy.json` 생성, 파일 diff(마지막 배포 대비)와 소스 다시 읽기, 배포 상태/주소 검사 세분화, 런처 내보내기 ZIP. SET-CORE-01 통합 전에는 파일 diff/ZIP/배포 상태부터 진행한다. | `apps/admin/src/main/**`, `apps/admin/src/shared/**`, `apps/admin/src/preload/**`, `docs/handoffs/STUDIO-MAIN-01.md` | `feat/studio-main-features` |

후속(위 셋 통합 후, #0 배정): STUDIO-UI-02 — 게임 설정/파일/배포/내보내기 페이지를 실제 API에 연결, 통합 smoke.

## 공통 규칙

- 새 의존성/루트 설정/lockfile 변경은 #0과 먼저 조정한다(ZIP 작성은 우선 Node 내장으로 구현 가능한지 검토하고, 불가하면 후보와 이유를 인계에 적어 #0에 요청).
- 앱 경계: `apps/admin`이 `apps/launcher`를 import하지 않는다. 공유 로직은 `packages/core`.
- **네이티브 확인창 금지**(사용자 결정 2026-10-23, 런처와 동일): 모든 확인은 앱 안 모달로 한다. `dialog.showMessageBox`·`window.confirm/alert/prompt` 금지. 파일 열기/저장 선택창만 네이티브를 쓴다. 기존 main `discard` 확인창은 STUDIO-MAIN-01이 렌더러 확정 명령 + 닫기 요청 이벤트로 대체한다.
- 글꼴/색: 런처와 같은 번들 글꼴을 쓴다(본문 Pretendard Variable, 워드마크 Pixelify Sans — 런처 renderer의 `assets/fonts`에서 파일과 OFL 고지를 복사하고 `--font`/`--font-pixel`/`--font-mono` 토큰도 동일하게). 앱은 외부 네트워크로 글꼴을 받지 않는다(시안의 Google Fonts·Noto Sans KR·Silkscreen은 쓰지 않는다). 토큰 이름/값은 `studio.css`를 따른다.
- 모든 사용자 문구는 기존 Studio i18n 사전을 거친다. 신규 IPC는 좁고 검증된 인터페이스로 만들고 `smoke` 격리 목록을 갱신한다.
- 파일 경로 검증과 해시 검증, 소유권 규칙은 AGENTS.md를 따른다. 설정 파일 읽기는 크기 제한을 두고 임의 경로 쓰기를 만들지 않는다.
- 완료 보고: 브랜치, 커밋, 실행한 검증 명령과 결과(통과/실패/미실행), 한계를 `docs/handoffs/<ID>.md`에 쓴다. `docs/progress.md`와 main은 건드리지 않는다.
