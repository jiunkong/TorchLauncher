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
- **런처 출처 규칙(사용자 결정 2026-10-24):** 개발 빌드(미패키지 Studio, `app.isPackaged === false`)는 저장소의 로컬 런처 패키지 산출물
  (`pnpm package:launcher` 결과, 경로는 한 곳에 상수화)을 사용하고 없으면 빌드 안내 오류를 낸다. 릴리스 빌드(패키지된 Studio)는
  GitHub 최신 릴리스 버전을 조회해, Studio 사용자 데이터의 런처 캐시에 **같은 버전이 검증된 채 있으면 그 파일을 쓰고**, 없거나 오래됐으면
  다운로드해 검증 후 캐시에 교체한다. 오프라인이면 캐시가 있을 때 마지막 캐시 버전 사용 여부를 사용자에게 명시(조용히 구버전 사용 금지).

## STUDIO-FILES-01 — 모드 페이지·파일 페이지 (항목 1·2)

- #1 `studio_mods_files`, `gpt-6-luna` low (사용자 요청; 범위·UI 동작이 이 배정서에 확정되어 있음).
  브랜치 `feat/studio-mods-files`, worktree `.agents/worktrees/studio-mods-files`, initial baseline `42483a6` (docs sync `570b0c4`).
- 독점: `apps/admin/src/renderer/**`(**`pages/ExportPage.tsx`와 catalog의 `export.*` 키 제외**), `apps/admin/src/shared/studio.ts`의
  pack 관련 타입, `apps/admin/src/main/game-settings.ts`·`files-diff.ts`·`scan.ts`·`ipc` 중 pack 추가/정책/이동/삭제에 필요한 부분,
  `.jar` 선택 필터/제목 번역에 필요한 `apps/admin/src/main/native-dialogs.ts`·`i18n.ts`·`native-dialogs.test.ts`,
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

**GPT 작업자 배정(사용자 결정 2026-10-25).** 모델은 `gpt-6.1-sol` medium 권장(외부 다운로드 무결성 경계, 정책 표 기준). 세션 이름은 `studio_export_launcher`.
브랜치 `feat/studio-export-launcher-fetch`, 새 worktree `.agents/worktrees/studio-export-launcher`.
**기준 커밋은 STUDIO-PROJECT-FOLDER-02 통합 뒤의 main**이다(두 작업이 `studio.ts` 등 같은 파일을 건드려 병렬 금지). #0이 통합 후 시작 기준 커밋을 알려준다.
현재 main은 프로젝트 폴더 구조(`project.torchproj` + `files/`)와 FILES-01(모드/파일 페이지)이 반영된 상태다.

시작 절차: `AGENTS.md` → `docs/progress.md`(맨 위) → 이 문서 → `docs/release-policy.md` → `docs/handoffs/STUDIO-PROJECT-FOLDER-01.md`,
`STUDIO-FILES-01.md` 순으로 읽고, `git status`/`git worktree list` 확인 후 worktree에서 `pnpm install --frozen-lockfile`.
`docs/progress.md`와 main은 수정·통합하지 않는다. 완료 시 `docs/handoffs/STUDIO-EXPORT-01.md`에 세션 이름, 작업 ID, 커밋, 실행한 검증과 결과, 한계를 쓴다.

- 독점: `apps/admin/src/renderer/src/pages/ExportPage.tsx`와 catalog의 `export.*` 키(ko/en), `apps/admin/src/main/filesystem.ts`(exportLauncherZip),
  `studio.ts`의 `export` 케이스(현재 `selected('binary')` 사용)와 새 `launcher-release` 모듈(+테스트), `binary` 다이얼로그 종류와 제목의 정리,
  관련 shared 타입 최소 추가, Studio 기능 smoke 중 내보내기 부분(`apps/admin/scripts/smoke-functional.mjs`, 필요하면 `scripts/smoke.mjs`), 인계 문서.
- 할 일:
  - 사용자 파일 선택(`selected('binary')`, 내보내기 화면의 공통 런처 카드 `export.launcherFile*`) 제거. 내보내기는 저장 위치만 묻는다.
  - 위 "런처 출처 규칙"을 구현하고 두 경로를 분리 테스트한다. 개발 빌드의 로컬 산출물 경로는 `pnpm package:launcher`가 실제로 만드는 파일
    (Windows portable `.exe`, Linux `.AppImage`)을 확인해 한 곳에 상수화한다. 현재 이 WSL의 `apps/launcher/dist`에는 `.tar.gz`만 있으므로
    AppImage/exe가 실제로 어떤 설정(`electron-builder.config.cjs`)에서 나오는지 확인하고, 없으면 빌드 안내 오류로 처리한다.
  - 릴리스 경로: 설정 상수(owner/repo, 플랫폼별 자산 이름 규칙, 미설정이면 명확한 오류) → GitHub Releases 최신 안정 릴리스 조회 → 대상 OS 자산 다운로드.
    임시 파일에 받아 길이·해시(서명 매니페스트가 정의될 때까지는 릴리스 메타데이터의 digest 또는 같이 올린 체크섬)를 검증한 뒤 캐시에 원자적으로 게시하고 ZIP에 넣는다.
    크기 상한, HTTPS와 리다이렉트 호스트 제한, 취소, 진행률, 실패 시 기존 캐시·결과 보존. 캐시는 Studio 사용자 데이터 아래 별도 폴더.
  - 대상 OS: Windows·Linux 각각 선택 가능(최소안). 선택 UI는 기존 내보내기 화면 스타일을 따르고 앱 내 UI만 사용한다(네이티브 확인창 금지).
  - 오프라인/릴리스 없음/자산 없음/검증 실패를 구분한 오류와 ko/en 문구. 오프라인에서 캐시를 쓰면 그 버전을 화면에 표시한다.
  - 네트워크 접근은 주입 가능한 경계로 두고 단위 테스트는 로컬 HTTP 서버/모의로 한다. **실제 GitHub 릴리스 성공으로 기록하지 않는다.**
  - 기존 `exportLauncherZip`의 헤더/실행권한/크기 검증을 다운로드·캐시 파일에도 유지한다. 서명 매니페스트 기반 검증은 RELEASE-02에서 합치므로 확장 지점을 인계에 적는다.
- 제외: 런처 앱 자체의 자동 업데이트(RELEASE-02), CI 릴리스 워크플로, packages/core, lockfile/의존성 변경(필요하면 #0 사전 조정), 프로젝트 폴더 흐름.
- 검증(실행한 것만 보고): 관련 Vitest, `pnpm check`, `pnpm smoke`, Studio 기능 smoke, `node apps/admin/scripts/branding-smoke.mjs`(DISPLAY 필요).
- 미결(사용자): GitHub 릴리스 `owner/repo` 값. 모르면 상수는 비워 두고 릴리스 빌드 내보내기를 오류로 막는다.

## 통합

작업자는 `docs/progress.md`·main을 건드리지 않는다. #0이 FILES → EXPORT 순(또는 준비된 순)으로 통합하고 `catalog.ts` 충돌을 해결한 뒤
`pnpm check`와 Studio 기능 smoke를 main에서 실행한다.
