# Claude UI 개선 인계

2026-10-22, #0 총괄 작성. 사용자는 다국어 기반 작업 다음 UI 개선을 Claude에서 진행할 예정이다.
이 문서는 후속 작업의 인계이며 현재 세션에서 UI 개편을 시작하라는 뜻은 아니다.

## 재개 순서와 역할

1. `AGENTS.md`, `docs/tool-handoff.md`, `docs/progress.md`, `docs/work-distribution.md`를 읽는다.
2. 메인과 사용할 worktree의 `git status --short --branch`, `git log -5 --oneline`, `git worktree list`를 확인한다.
   기존 worktree/미커밋 파일/사용자 테스트 서버를 초기화하거나 삭제하지 않는다.
3. #0은 계획·독점 범위 배정·검토·머지·진행 문서만 담당하고 제품 코드는 구현 작업자에게 배정한다.
   도구가 달라져도 이 역할은 유지한다. 모델은 작업별로 선택하며 모든 작업을 고비용 모델로 고정하지 않는다.
4. UI 세부 범위를 정한 뒤 앱별 구현 범위를 배정한다. 공통 smoke/IPC/공유 파일은 한 작업자만 소유한다.

## 현재 기능과 지켜야 할 흐름

- 사용자 제공 레드스톤 토치 아이콘은 `assets/branding/icon.ico`와 ICO에서 추출한 `icon.png`다.
  공유 builder 설정이 Windows 실행 파일/Linux 패키지에 적용하고 두 main 창이 PNG를 읽는다.
  renderer 내부의 문자 로고는 아직 이 이미지로 바꾸지 않았다. UI 적용 시 이 자산을 재사용할 수 있다.

- 런처는 운영자가 제공한 **단일 서버 프로파일**을 전제로 한다. 서버 선택/추가/주소 입력 UI를 만들지 않는다.
- 홈은 서버 정보·계정·로그인 또는 플레이·실제 진행 상태 중심이다. 세션 갱신/복구/로그는 문제 해결에 있다.
- 게임 실행은 월드 접속 완료를 뜻하지 않는다. 서버 상태의 실패/미조회와 온라인/오프라인을 구분한다.
- 설치 활동은 Java/게임/라이브러리/에셋/로더/서버 모드/팩/설정/기타 파일로 구분한다.
  전체 수가 없으면 불확정 표시하고 계획 파일 수를 다운로드 완료율로 쓰지 않는다.
- 모드/팩 조회의 미조회·빈 목록·오류를 구분하고 진행 이벤트가 사용자 초안을 덮어쓰지 않게 한다.
- 삭제/복구 확인, IPC 검증, 직렬화·중복 실행 방지, 최신 배포 동기화 실행 경계를 유지한다.
- 설정의 ‘게임 실행 후 런처 종료’는 개인 설정이며 기본 off다. 성공적으로 게임을 분리한 뒤 실제 런처가 종료된다.
  게임 생존 중 잠금 유지 및 종료 후 안전 회수를 보존한다. `docs/handoffs/LAUNCH-EXIT-01.md` 참고.
- Studio는 프로젝트→환경/파일 정책→배포 파일 생성→사용자 직접 업로드→URL 검사→내보내기 흐름이다.
  Google 계정 연동/자동 업로드를 구현한 것처럼 표시하지 않는다. 팩 생성 전 원격 URL은 필수가 아니다.
- 이미지 브랜딩·단축키 편의 편집·단일 파일 패키징은 잔여 기능이다. 현재 내보내기는 바이너리+설정 폴더다.
  새 기능 없이 디자인을 바꿀 때 준비되지 않은 기능에 가짜 성공 상태를 추가하지 않는다.

## 다국어 연결

`docs/handoffs/I18N-01.md`에 정확한 import/사용 예시와 검증 결과가 있다.

- 공통 API: `@torchlauncher/core/i18n`, 구현 `packages/core/src/i18n/`.
- 각 앱: `apps/{launcher,admin}/src/renderer/src/i18n/index.tsx`의 provider/hook과 `catalog.ts`.
  `LauncherLocaleProvider`/`useLauncherLocale`, `StudioLocaleProvider`/`useStudioLocale`을 쓴다.
- 아직 App에 provider를 연결하지 않았고 기존 화면은 한국어다. 대표 문구만 사전에 있으므로
  **전체 UI 영어 지원이 완료된 상태가 아니다**.
- 후속: provider 연결→기존 하드코딩 문구·접근성 라벨·사용자용 오류/진행 문구를 사전으로 이동→
  자동/한국어/영어 선택 연결→실제 재실행 저장 확인. 기술적 오류 코드는 유지하고 사용자용 문구만 매핑한다.
- Electron main의 네이티브 대화상자 문구는 이 renderer 기반에 아직 연결되지 않았다.
  전체 영어 지원에 포함할 때는 locale 전달 계약을 별도 배정·검토하고 기존 신뢰/확인 경계를 보존한다.
- 기본 자동 판별은 지원 언어 목록 순서, 미지원 시 영어다. 명시 선택이 우선이고 앱별 저장값은 독립적이다.
  자동 판별은 provider 생성/자동 모드 복귀 시 평가한다. OS 언어 변경 실시간 감지는 없다.
- `{name}` 인자와 키는 타입 검사를 받고 양 언어 키/placeholder parity 테스트를 유지한다.
  서버명/사용자 파일명/경로/원본 로그를 번역하지 않으며 HTML 삽입으로 번역 결과를 렌더링하지 않는다.
- 한국어·영어의 길이 차이, 좁은 창, 줄바꿈, 키보드 포커스, 대비, 오류/빈 상태를 함께 검증한다.

## 검증과 실행 환경

현재 범위는 Windows/Linux x64, Minecraft 1.21.1 + Fabric/NeoForge다. macOS는 보류, Linux ARM64는 제외다.
과거 Windows 실제 게임 접속 성공과 최신 변경의 검증은 구분한다. 최근 자동 종료는 Linux 실제 자식 생존
테스트까지만 확인됐고 Windows 실제 게임 유지/런처 프로세스 종료는 미검증이다. 계정 재로그인·사용자 서버
조작이 필요하면 먼저 필요한 테스트를 구체적으로 요청한다. 토큰·공개/비공개 테스트 URL을 문서에 쓰지 않는다.

```sh
pnpm install --frozen-lockfile
pnpm check
node scripts/smoke.mjs
node apps/admin/scripts/smoke-functional.mjs
node apps/launcher/scripts/renderer-functional-smoke.mjs
```

Node 24, pnpm 10.34.7. Electron smoke는 디스플레이가 필요하다. Linux 임시 도구 경로가 남아 있으면
`PATH="/tmp/torchlauncher-tools/node_modules/.bin:$PATH"`를 쓸 수 있지만 재개 시 존재 여부를 확인한다.
원본 `D:\Projects\mclauncher`의 node_modules는 현재 Linux용이다. Windows 실행은 기존 네이티브 클론
`D:\TorchLauncherWindowsSmoke`에서 dirty 상태를 보존하고 `git pull --ff-only`, `pnpm install --frozen-lockfile`
후 진행한다. 다른 OS 의존성 디렉터리를 공유하지 않는다. 제공 서버 프로파일은 ignored 로컬 파일이며
`TORCH_SERVER_CONFIG`로 지정한다. 경로/기존 자료 확인 없이 새 프로파일이나 서버를 임의 생성하지 않는다.

UI 기능 단계 기준 문서는 `docs/ui-production.md`, 이전 인계는 `docs/handoffs/UI-PROD-01-{L,S}.md`다.
최신 테스트 수·통합 커밋은 `docs/progress.md`/`docs/tool-handoff.md`를 기준으로 하고 이전 수치를 재사용하지 않는다.
