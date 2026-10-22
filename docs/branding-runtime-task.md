# BRAND-RUNTIME-01 — 런처 브랜딩 표시와 갱신

사용자 승인 혼합 전달의 두 번째 직렬 단계. #1 기존 작업자 재사용, Sol medium 요청
(OS 파일 검증·비동기 갱신·캐시 경합). 실제 런타임 모델/effort 반영 여부와 요청은 구분한다.
core 통합 및 전체 검사 성공 후 최신 main에서 `feat/branding-runtime`을 만든다.

## 배타적 범위

`apps/launcher/**`만 구현한다(앱 로컬 IPC/shared/preload/main/renderer/테스트/fixture 포함).
`docs/handoffs/BRAND-RUNTIME-01.md`를 작성한다. core/Studio/루트 설정/의존성/lockfile/tracker는 변경하지 않는다.
추가 에이전트와 사용자 서버/실계정/비공개 설정 접근은 금지한다. #0만 main에 통합한다.

## 계약과 완료 조건

- 실제 서버 JSON 경로를 bootstrap에서 보존하고 해당 디렉터리를 기준으로 동봉 자산을 읽는다.
  서버/프로파일 내용의 안정적인 fingerprint로 캐시를 격리한다(소스 URL 포함 식별정보는 해시만 저장).
  게임 데이터 루트 밖 캐시, 검증 캐시 → 동봉 → 기본 순서. 역할별 null 제거 tombstone도 재시작 후 보존한다.
- 로컬/캐시 파일은 길이·hash·magic·dimensions·실제 nativeImage decode와 픽셀 제한을 검사한다.
  링크/하드링크/경로 이탈을 거부하고 bounded read와 원자적 기록을 사용한다. 임의 사용자 파일 삭제는 없다.
- 시작 시 비차단 원격 메타데이터 확인, 게임 준비의 이미 연 reader도 활용한다. 해시가 같은 이미지는 재수신하지 않는다.
  필수 게임 흐름이 브랜딩 다운로드를 기다리거나 실패하지 않게 한다. 별도 timeout/abort와 세대 보호를 둔다.
  이미지가 누락/손상/다운로드 실패이면 기존 표시 유지. 전체 잘못된 게임 index 실패 경계는 그대로 유지한다.
  reader 재사용 중복·경합/원격 세대 변경·종료 후 늦은 publish·미처리 reject를 막는다.
- 앱 이름은 창 제목/메뉴 상단만, 기본은 TorchLauncher. 홈 서버 이름은 유지한다.
  창 native icon과 메뉴 icon, 홈 배경만 변경한다. app.setName/appId/userData/auth/exe/splash는 유지한다.
- 좁은 신뢰 검증된 별도 브랜딩 IPC로 표시 상태를 전달한다. renderer에는 로컬 경로/원격 URL/원본 오류를 주지 않는다.
  큰 data URL을 ProductState나 게임 진행 이벤트에 넣지 않는다. 변경 때만 별도 snapshot/event로 전달하는 방식은 허용한다.
  요청 인자는 없거나 엄격한 role/revision만, arbitrary path/URL 슬롯 금지. 기존 mock/smoke API도 호환시킨다.
- 이전 이미지 유지 후 새 이미지 디코드 성공 때 짧은 교차 페이드. reduced-motion 즉시 전환.
  기본 scene·레드스톤 토치 복귀도 지원하고 760/1100 레이아웃·텍스트 선택/끌기 차단을 유지한다.

테스트: 동봉/캐시/기본 우선순위, 변경 role만 받기, offline/hash/decode 실패 유지, persisted null,
프로파일 격리/취소/늦은 응답, 파일 경로·링크/픽셀 제한, IPC sender/인자 검증, 게임 준비 비차단.
실제 Electron decode 및 가짜 원격 fixture를 사용해 표시/페이드/reduced-motion/splash 고정을 smoke로 확인한다.
로그인/실제 서버·Drive 업로드/Windows 검증은 #0이 준비된 후 사용자에게 요청한다.
