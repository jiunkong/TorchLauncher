# I18N-01 — 한국어·영어 기반

사용자 승인: UI 작업을 미루고 나중에 적용할 다국어 기반만 준비한다.
기존 화면의 언어·배치·동작은 이번 단계에서 바꾸지 않는다. 전체 영어 UI 지원 완료로 표시하지 않는다.

## 범위

- 두 Electron renderer에서 쓸 수 있는 Node/Electron 비의존 공통 번역 모듈.
- `ko`, `en`, 기본 fallback `en`. `ko-KR` 등 BCP47 언어는 기본 언어로 판별한다.
  지원하지 않는 언어·잘못된 입력은 fallback을 사용한다.
- 명시적 사용자 언어 선택을 OS/browser 언어보다 우선하며 기본은 자동이다.
  번역 사전·설정은 게임 서버 프로파일/배포 콘텐츠/계정과 분리한다.
- 타입 안전한 키와 보간 인자, 한국어·영어 키/placeholder 일치 검증.
  HTML 해석 없이 텍스트로 반환하며 사용자 파일명/서버명/오류 원문을 번역하지 않는다.
- 최소 공통 문구와 앱별 대표 문구를 사전에 준비하고, 기존 UI 전체 문구 이전은 후속 작업이다.
- React provider/hook과 브라우저 저장 adapter를 각 앱에서 직접 import해 쓸 수 있게 준비한다.
  저장 불가/손상/지원하지 않는 저장값은 안전하게 자동 모드로 처리하고 메모리 내 선택은 유지한다.
  각 앱 설정은 독립적으로 저장한다. 언어 선택 UI/IPC/기존 closeOnLaunch 설정 스키마 변경은 하지 않는다.
- 단위 테스트와 사용 예시를 제공한다. 새 라이브러리는 추가하지 않는다.

## 배정

#1 `i18n_foundation`, Luna medium, agent-1 `feat/i18n-foundation`, baseline `753e2ac`.
독점: 새 `packages/core/src/i18n/**`, `packages/core/package.json`의 `./i18n` export만,
각 앱의 새 `src/renderer/src/i18n/**`, `docs/handoffs/I18N-01.md`.
기존 App/main/IPC/pages/스타일·루트 manifest/lockfile은 수정하지 않는다.
#0은 문서·검토·통합·통합 검증을 담당한다.

검증: locale 정규화·자동/명시 선택 우선순위·사전/보간·저장 실패/손상·앱별 storage key·
구독/언어 변경과 각 앱 타입/빌드. 외부 계정이나 서버 테스트는 필요하지 않다.
