# BRAND-STUDIO-01 — Studio 브랜딩 기능 (원래 배정 기록)

현재 규격은 [current-formats.md](current-formats.md)를 우선한다. 이 문서의 당시 범위 이후 UI/ZIP도 통합됐다.

2026-10-23 사용자 승인: 런처와 병렬로 Studio 기능만 미리 구현한다. Studio UI는 수정하지 않는다.
#2 새 작업자, Sol medium 요청(네이티브 파일 입력/안전한 내보내기). 실제 반영은 요청과 구분한다.
agent-2 `feat/studio-branding-functions`, 기준 main `907f7d7` (core 통합 완료).

## 독점 범위

`apps/admin/src/main/**`, `apps/admin/src/shared/**`, 필요한 `apps/admin/src/preload/**`,
`apps/admin/scripts/`의 새로운 기능 검증 스크립트/fixture, `docs/handoffs/BRAND-STUDIO-01.md`.
`apps/admin/src/renderer/**`는 읽기만 한다. launcher/core/루트 설정/공유 scripts/manifest/lockfile/
tracker 변경과 추가 에이전트·실계정·비공개 설정 접근은 금지한다. #0만 통합한다.

## 기능 계약

- 새 화면 없이 호출 가능한 이미지 선택/제거 API와 앱 이름 저장 기능을 마련한다. 현재 프로젝트 형식을 읽는다.
  main의 native dialog가 선택한 파일만 가져오며 renderer가 임의 경로/URL을 전달할 수 없게 한다.
  선택적 신규 명령 인자는 role 등 닫힌 스키마로 검증하고 기존 신뢰 sender 경계를 유지한다.
- PNG icon 1MiB/512², PNG/JPEG background 8MiB/3840×2160 및 총 픽셀 상한, hash/magic/실제 decode,
  링크/하드링크/부모 링크/파일 변경/bounded read를 검사한다. 실패/취소 시 기존 선택은 보존한다.
- 선택한 파일은 검증된 동일 snapshot으로 프로젝트 저장/재열기와 pack/export에 사용한다.
  원본 파일이 나중에 바뀌어도 별도 재선택 없이는 두 출력의 내용이 달라지면 안 된다.
  프로젝트 저장 방식(제한된 embedded bytes 또는 프로젝트 옆 관리 자산)과 renderer 요약 계약을 먼저 #0에게 제안한다.
  큰 원본 bytes를 매 StudioState 응답마다 복제하지 않는 설계를 우선한다. appName은 기존 core profile 규칙을 따른다.
- pack writer의 새 branding 입력을 활용하고 기본 이미지로 되돌리는 명시적 null도 지원한다.
  브랜딩이 없어도 현재 서명된 v1.2만 출력한다. 브랜딩 이미지와 일반 게임 files는 섞지 않는다.
- 내보내기: 동일 검증 snapshot을 출력 폴더의 고정 branding 상대 경로로 동봉하고 서버 JSON에
  appName/역할별 path/hash/length/mediaType을 넣는다. exe는 그대로 복사한다. ZIP 생성은 이번 범위가 아니다.
  기존 빈 출력 폴더·링크·원자적 생성/부분 실패 시 본 작업 생성 파일만 정리하는 안전 경계를 유지한다.
- URL 검사/내보내기에서 serverId/game 일치와 현재 프로젝트가 지정한 역할의 원격 hash/길이/type/null
  일치도 검사한다. 로컬 변경 후 옛 pack을 가리키면 MISMATCH로 막는다. 현재 형식에서 이미지 역할 생략은 유효하며 현재 표시 유지로 처리한다.
- 새 사용자 문구는 UI에 직접 추가하지 않는다. main error는 기존 안전 코드로만 반환한다.
  새 dialog 이름/필터 등의 한글은 가능하면 앱 로컬 사전/상수로 모아 후속 UI가 재사용할 수 있게 한다.

테스트: 현재 프로젝트/새 snapshot 저장·재열기, 원본 파일 교체 후 pack/export 동일 bytes,
각 역할/제거/이름, 잘못된 이미지·디코드·경로·길이, 취소/실패 보존, IPC 잘못된 인자,
실제 생성 pack reader 및 동봉 JSON/hash 일치, 원격 mismatch 차단, 내보내기 실패 정리.
실제 사용자 파일/네트워크 대신 temp fixtures/모의 source 및 Electron decoder 검증을 쓴다.
기능 UI/전체 Studio 개편은 후속이다. 인계에 후속 UI가 사용할 정확한 API/한계/명령을 남긴다.
