# Studio 게임 구성·내보내기 정리 (STUDIO-FILES-01 / STUDIO-EXPORT-01)

2026-10-24 사용자 Studio 실행 피드백. 기준은 [Studio UI 명세](studio-ui.md), [릴리스 정책](release-policy.md).
개발 중이므로 과거 형식 호환·마이그레이션은 만들지 않는다(AGENTS.md). 네이티브 확인창 금지 유지.

## 사용자 결정

1. **게임 구성 > 모드 설정**은 설정 항목 편집이 아니라 리소스팩·셰이더처럼 **모드 jar를 가져와 목록으로 관리**하는 페이지여야 한다.
2. **게임 구성 > 파일**은 모드·리소스팩·셰이더팩을 제외한 **기타 파일**만 다룬다. 사이드바·페이지 제목은 일관되게 **"파일"**.
   파일 페이지의 **"배포 파일 다시 만들기" 버튼은 제거**한다(배포는 배포 페이지에서만).
3. **내보내기에서 사용자가 공통 런처 파일을 고르지 않는다.** 런처·Studio 모두 GitHub에 올려 자동 업데이트할 예정이므로
   Studio가 공식 런처 릴리스를 직접 받아 ZIP에 넣는다.

## #0 결정(사용자 이의 시 변경)

- 기존 모드 설정 파일(`config/*` key=value) 정책 편집기는 삭제하지 않고 **모드 페이지의 두 번째 섹션("모드 설정 파일")**으로 옮긴다.
  `managedPage('config/…')`와 테스트 실행 결과의 "모드 설정 열기" 링크는 이 섹션을 가리킨다. 사이드바 `nav.mods`는 "모드"/"Mods".
- `mods/*.jar`(및 `.zip` 모드 묶음 없음 — jar만)는 파일 페이지 목록에서 **모드 페이지 관리 대상**으로 표시·제외한다(리소스팩과 같은 방식).
- 런처 릴리스 위치(GitHub `owner/repo`)는 아직 없다. **설정 상수 한 곳**으로 분리하고 미설정이면 내보내기를 명확한 오류로 막는다.

## STUDIO-FILES-01 — 모드 페이지·파일 페이지 (항목 1·2)

- 새 작업자 하나, 최소 Sonnet medium(명세 확정 UI+기존 pack 경로 확장). 브랜치 `feat/studio-mods-files`, 새 worktree.
- 독점: `apps/admin/src/renderer/**`(**`pages/ExportPage.tsx`와 catalog의 `export.*` 키 제외**), `apps/admin/src/shared/studio.ts`의
  pack 관련 타입, `apps/admin/src/main/game-settings.ts`·`files-diff.ts`·`scan.ts`·`ipc` 중 pack 추가/정책/이동/삭제에 필요한 부분,
  관련 테스트, `scripts/` 중 Studio 기능 smoke, `docs/handoffs/STUDIO-FILES-01.md`.
- 할 일:
  - `PackKind`에 모드를 추가하거나 동등한 모드 관리 경로를 만든다. 리소스팩과 같은 UI(추가·정책 항상/최초/제외·순서 불필요 시 생략·삭제·크기 표시).
    추가 대상은 `.jar`만, 파일명/크기/중복/경로 검증, 소스 폴더 `mods/`에 복사 또는 참조(리소스팩 방식과 동일). 배포 시 `mods/*.jar`로 출력.
  - 모드 설정 파일 편집기를 같은 페이지 하위 섹션으로 이동. 페이지 제목/문구를 "모드" 중심으로 교체(`settings.config.title` 등은 섹션 제목으로만).
  - 파일 페이지: 제목·사이드바 "파일"/"Files", 리드 문구를 "기타 파일"로 교정, 모드·리소스팩·셰이더·options.txt는 관리 위치 링크 표시,
    `files.rebuild` 버튼과 관련 i18n·테스트 제거. 개요의 "배포 파일 다시 만들기" CTA는 배포 페이지로 이동하는 링크로 유지해도 되나 문구를 정리한다.
  - ko/en 사전 동시 갱신, 760/1100px overflow 확인, 기존 단위 테스트·smoke 갱신.
- 제외: core/배포 형식 변경(`mods/`는 일반 파일 경로로 이미 배포 가능한지 확인만, 필요시 #0에 요청), 내보내기 코드.

## STUDIO-EXPORT-01 — 런처 자동 수급 (항목 3)

- 새 작업자 하나, Opus medium(외부 다운로드 무결성 경계). 브랜치 `feat/studio-export-launcher-fetch`, 새 worktree. 위 작업과 병렬 가능.
- 독점: `apps/admin/src/renderer/src/pages/ExportPage.tsx`와 catalog의 `export.*` 키, `apps/admin/src/main/filesystem.ts`(exportLauncherZip),
  `studio.ts`의 `export` 케이스와 새 `launcher-release` 모듈(+테스트), 관련 shared 타입 최소 추가, `docs/handoffs/STUDIO-EXPORT-01.md`.
- 할 일:
  - 사용자 파일 선택(`selected('binary')`, 공통 런처 카드) 제거. 내보내기는 저장 위치만 묻는다.
  - 릴리스 위치 설정 상수(owner/repo, 플랫폼별 자산 이름 규칙) → GitHub Releases 최신 안정 릴리스에서 대상 OS(Windows .exe / Linux .AppImage) 자산 조회·다운로드.
    임시 파일에 받아 길이·해시(릴리스 체크섬/서명 매니페스트가 정의될 때까지는 릴리스 메타데이터의 digest)를 검증한 뒤 ZIP에 넣는다. 크기 상한, 리다이렉트 호스트 제한, 취소, 진행률, 실패 시 기존 결과 보존.
  - 내보낼 대상 OS를 사용자가 고르게 할지(Windows+Linux 모두 한 ZIP 또는 각각)는 이 작업에서 최소안을 제안: 기본은 Windows·Linux를 각각 선택 가능하게.
  - 오프라인/릴리스 없음/자산 없음을 구분한 오류 메시지. 네트워크 접근은 주입 가능한 경계로 두고 단위 테스트는 로컬 HTTP 서버/모의로 한다. **실제 GitHub 릴리스 성공으로 기록하지 않는다.**
  - 기존 `exportLauncherZip`의 헤더/실행권한/크기 검증은 다운로드된 파일에도 유지한다. 서명 매니페스트 기반 검증은 RELEASE-02에서 합치므로 확장 지점을 인계에 적는다.
- 제외: 런처 앱 자체의 자동 업데이트(RELEASE-02), CI 릴리스 워크플로, lockfile/의존성 변경(필요하면 #0 사전 조정).

## 통합

작업자는 `docs/progress.md`·main을 건드리지 않는다. #0이 FILES → EXPORT 순(또는 준비된 순)으로 통합하고 `catalog.ts` 충돌을 해결한 뒤
`pnpm check`와 Studio 기능 smoke를 main에서 실행한다.
