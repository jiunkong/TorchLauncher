# UI 기능 연결 — 2026-10-22

사용자가 UI 디자인보다 실제 기능 연결을 먼저 승인했다. #0은 계약·검토·통합을 맡고,
두 구현 작업자가 앱별로 독점 작업한다. 기존 코어의 소유권·해시·최신 동기화·잠금 규칙을 우회하지 않는다.

## 공통 서버 구성 계약

`torchlauncher-server.json` UTF-8 JSON v1:

```json
{
  "format": "torchlauncher-server",
  "version": 1,
  "serverId": "44444444-4444-4444-8444-444444444444",
  "name": "Example server",
  "address": "localhost:25565",
  "sourceUrl": "https://example.org/server.torchpack"
}
```

UUID v4, 제한된 이름·주소·HTTPS 공개 URL만 허용한다. 자격 증명 URL·임의 경로·실행 명령은 허용하지 않는다.
배포 reader의 serverId·게임 버전·로더가 진실의 기준이다. 서버 구성에 게임 설정을 중복 저장하지 않는다.
계약 구현은 Studio 작업자가 `packages/core/src/server-config/**`에 작성하고 런처가 같은 모듈을 가져온다.
공개 package export·의존성 변경 없이 기존 내부 상대 import 방식을 사용한다.

런처는 전달된 실행 파일 옆 구성을 읽는다. Windows portable에서는 `PORTABLE_EXECUTABLE_DIR`,
AppImage에서는 `APPIMAGE`의 부모, 일반 패키지에서는 `process.execPath` 부모, 개발 중에는
앱 디렉터리를 기준으로 한다. 읽기 전에 파일 종류·링크·크기를 검증한다. 개발/검증 전용 명시 경로는
별도 환경 변수 `TORCH_SERVER_CONFIG`로 지정할 수 있다. 사용자에게 배포 URL을 다시 입력시키지 않는다.

## Launcher / UI-CONNECT-L — #4

독점: `apps/launcher/**`, `packages/core/src/server-status/**`,
`packages/core/src/loaders/launch-gate.ts` 및 대응 테스트(설정 적용 연결에 필요한 최소 후크),
`docs/handoffs/UI-CONNECT-L.md`. 기존 인증 모듈 변경은 필요 최소한만, 토큰을 renderer에 노출하지 않는다.

- 검증한 IPC 계약과 신뢰된 main-frame 검사. main이 고정 루트·서버 구성을 소유한다.
- 로그인/갱신/로그아웃, 서버 ping·인원·지연, 설치·최신 동기화·정책 적용·실행/중지,
  제한된 안전 로그·진행률·취소. 실행 성공을 서버 접속 완료로 표시하지 않는다.
- 사용자 모드 추가/삭제/미등록 편입, 리소스팩 설정, 용량·삭제 미리보기와 확인,
  중단 복구 UI. 설치/실행/삭제/모드/설정 변경을 main에서 직렬화한다.
- 앱 종료 시 진행 중 작업 취소·Java 종료를 기다리고 잠금을 해제한다.
- 설치의 현재 지원 범위(1.21.1, Windows/Linux x64)를 명시한다.

## Studio / UI-CONNECT-S — #1

독점: `apps/admin/**`, `packages/core/src/server-config/**`,
`docs/handoffs/UI-CONNECT-S.md`. 프로젝트 저장은 앱 내부 검증 모델로 시작한다.

- 프로젝트 생성/열기/저장, 서버 이름·주소·버전·로더·URL 편집. 취소/오류/미저장 상태를 구분한다.
- 선택한 소스 폴더의 임의 상대 파일을 파일별 always/initial-only 정책으로 구성하고 기존 writer로
  `.torchpack`을 생성한다. 링크·경로 탈출·보호 파일 검증을 유지하고 생성 취소를 지원한다.
- 공개 링크를 기존 reader로 검사하고 서버 ID·게임/로더 일치를 확인한다. Google 계정 연동 없음.
- 공통 런처 바이너리를 사용자가 선택하면 빈 출력 폴더에 바이너리와 서버 구성 파일을 복사해
  실행 가능한 폴더를 내보낸다. Windows portable exe 또는 Linux AppImage 대상. 실행 권한을 보존한다.
  기존 파일을 덮어쓰거나 소스 코드를 재빌드하지 않는다. 단일 파일 재패키징/서명은 별도 릴리스 작업이다.
- 실제 UI 폼과 저장/배포/링크 검사/내보내기를 IPC로 연결한다.

## 검증·공유 파일

각 앱 작업자가 자신의 preload·main·renderer·Electron 빌드 설정을 소유한다. 공통 manifest/lockfile,
기존 desktop 계약과 `scripts/smoke.mjs`는 변경 요청 후 한 작업자에게 배정한다.
앱별 IPC 타입은 `src/shared/`에 둔다. raw 에러·URL·토큰·argv를 IPC/로그에 흘리지 않는다.
실제 파일 기반 프로젝트/writer/read/export와 취소·위조 IPC·경합·삭제 보호를 행동 테스트한다.
모의 로그인/프로세스 성공을 실계정 접속 증거로 기록하지 않는다. 통합 후 #0이 전체 검사와
Electron smoke를 실행한다. 실제 로그인/서버 접속은 준비된 절차로 사용자에게 요청한다.
