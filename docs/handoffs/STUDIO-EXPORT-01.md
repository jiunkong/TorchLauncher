# STUDIO-EXPORT-01 인계

- 세션: `studio_export_launcher` (Codex 구현 작업자; #0 아님).
- 작업 ID: `STUDIO-EXPORT-01`.
- 기준: 프로젝트 폴더·FILES 통합 후 main `f6eb3aa`.
- 브랜치: `feat/studio-export-launcher-fetch`.
- worktree: `/mnt/d/Projects/mclauncher/.agents/worktrees/studio-export-launcher`.
- 구현 커밋: `eda9356` (`feat(studio): resolve launcher packages automatically`).
- 구현·작업자 검증 완료, **main 통합 및 #0 통합 검증은 미실행**.
- main 및 `docs/progress.md`는 수정하지 않았다. 기존 main의 untracked `.claude/`도 보존했다.

## 동작

- ExportPage의 공통 런처 선택 카드/`export.launcherFile*`와 `selected('binary')`, native binary picker/제목을 제거했다.
  Windows x64/Linux x64를 기존 `.inp` 스타일로 선택하며 내보내기는 ZIP 저장 위치만 묻는다. ko/en 동시 적용.
- `main/index.ts`에는 실제 Electron 환경(`app.isPackaged`, appPath/version, userData)을 resolver에 전달하는 최소 배선만 추가했다.
  다운로드/캐시 로직과 네트워크 주입 경계는 새 `main/launcher-release.ts`에 있다.
- 미패키지 Studio: `app.getAppPath()/../launcher/dist/`에서
  `TorchLauncher-<Studio version>-win-x64.exe` 또는 `TorchLauncher-<Studio version>-linux-x64.AppImage`를 사용한다.
  현재 두 앱 버전은 0.1.0으로 동일하다. 버전/명명 규칙을 바꿀 때 이 경계를 함께 갱신해야 한다.
  없으면 네트워크로 우회하지 않고 빌드 안내 오류를 반환한다.
- 패키지 Studio: 상수 `LAUNCHER_REPOSITORY` → `/repos/<owner>/<repo>/releases/latest` → 안정 릴리스의 정확한 OS 자산 이름을 찾는다.
  **owner/repo가 미정이어서 상수는 빈 문자열이다.** 실제 패키지 내보내기는 `LAUNCHER_UNCONFIGURED`로 막힌다.
- 릴리스 asset의 필수 `digest: sha256:<64 lowercase hex>`와 `size`를 검증한다. digest 없는 자산은 거부하며 별도 체크섬 파일 fallback은 없다.
  공식 API 근거: [GitHub release assets](https://docs.github.com/en/rest/releases/assets),
  [latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
- HTTPS, 자격증명/임의 포트 금지, 정확한 GitHub 자산 경로를 검사한다.
  요청/각 redirect마다 `api.github.com`, `github.com`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com`만 허용한다.
  redirect 최대 5회, 전체 네트워크 deadline 120초, 메타데이터 2 MiB/실행 파일 2 GiB 상한을 적용한다.
- 스트림 다운로드/해시/길이 검사 후 실행 파일 검증, sync된 metadata와 함께 임시 디렉터리를 immutable generation으로 rename한다.
  마지막으로 `current` 포인터를 원자적으로 교체한다. 실패/취소 시 임시 generation을 회수하며 이전 캐시 포인터·파일과 기존 ZIP은 보존한다.
  ZIP은 기존 원자적 writer를 그대로 사용한다. 진행 바이트와 취소는 기존 Studio operation 경로에 연결했다.
- 캐시는 `<Studio userData>/launcher-cache/<windows|linux>/` 아래에 둔다.
  매번 캐시의 메타데이터/길이/SHA-256/헤더/링크를 재검사하며 최신 메타데이터의 같은 버전·길이·해시가 일치할 때만 온라인 캐시를 쓴다.
  캐시 출처 repository도 일치해야 한다. 이전 성공 generation은 삭제하지 않는다(자동 캐시 정리는 이번 작업에 없음).
- 메타데이터 조회 또는 자산 다운로드가 오프라인으로 실패하면 검증된 마지막 캐시 버전을 화면에 제시한다.
  사용자가 해당 버전을 앱의 체크박스로 선택하고 재시도해야 한다. 동의는 `cachedVersion`과 대상 OS에 묶이며 다른 버전으로 묵시 적용하지 않는다.
  HTTP 404/429/5xx, 자산 없음, digest/길이/헤더 실패는 오프라인 fallback으로 취급하지 않는다.
- 오류를 미설정/로컬 산출물 없음/오프라인/캐시 동의 필요/안정 릴리스 없음/서비스 실패/OS 자산 없음/무결성 실패로 구분했다.
- 공통 `validateLauncherBinary`로 기존 헤더·크기·링크 검증을 다운로드/캐시에도 적용한다.
  Linux에서는 AppImage 실행 비트도 요구한다. Windows 파일시스템에서는 Unix 실행 비트 검사를 생략하며 ZIP의 실행 파일 mode는 항상 0755다.
- 기존 export 결과 상태/파일은 실패 시 보존한다. 테스트 fixtures는 사용자 선택 대신 resolver를 주입하도록 갱신했다.

## Linux 패키지 설정

공유 `electron-builder.base.cjs`의 artifactName은 `${productName}-${version}-${os}-${arch}.${ext}`,
Windows target은 portable, Linux 기본 target은 **tar.gz**다. 공유 설정/manifest/lockfile은 변경하지 않았다.
따라서 현재 `pnpm package:launcher`의 Linux 기본 결과만 있으면 개발용 내보내기는 명확한 산출물 없음 오류를 낸다.
Linux AppImage는 먼저 앱을 build한 뒤 아래 명령으로 생성할 수 있도록 오류에 안내했다:

```sh
pnpm --filter @torchlauncher/launcher exec electron-builder --config electron-builder.config.cjs --linux AppImage --x64
```

실제 AppImage/portable 패키지를 이번 작업에서 생성하거나 실행하지는 않았다.

## 실행 검증

환경: WSL/Linux x64, Node 24.21.0, corepack pnpm 10.34.7, DISPLAY=:0.

- `pnpm install --frozen-lockfile --store-dir /tmp/torch-export-pnpm-store`: 성공. lockfile 변경 없음.
  최초 기본 store 설치는 `/home/jiun11/.local/share/pnpm/store` 생성 ENOENT로 실패했고 /tmp store로 해결했다(제품 결함 아님).
  새 worktree의 Electron postinstall 산출물이 없어 동일 checkout baseline의 기존 Linux Electron `dist`를
  worktree `node_modules/electron/dist`에 symlink하고 `path.txt`를 생성했다. 둘 다 ignored 환경 파일이며 커밋하지 않았다.
- 최종 `pnpm check`: **성공**, Biome 오류 0(기존 41 warnings/2 infos), workspace 4개 타입 검사,
  **116 passed files/4 skipped files, 1535 passed tests/9 skipped**, 두 앱 빌드 성공.
  로그: `/tmp/studio-export-check-final.log`.
- 새 resolver 집중 Vitest: **32 passed**. 개발 로컬 Windows/Linux, 미설정, 온라인 캐시/교체/변조,
  오프라인 exact-version 동의, 메타데이터/다운로드 연결 실패, 취소/기존 캐시 보존,
  draft/prerelease/자산/길이/해시/헤더/HTTP 상태/redirect/메타데이터 상한/스트림 상한/링크 거부를 검증했다.
  로그: `/tmp/studio-export-release-tests-final.log`.
- 기존 Studio export 테스트는 binary picker 호출이 없음을 검증하고 잘못된 IPC 인자 4종을 추가했다.
- `pnpm smoke`: **성공**, 두 앱 IPC/격리/navigation 및 760/1100px layout.
  로그: `/tmp/studio-export-smoke.log`.
- `node apps/admin/scripts/smoke-functional.mjs`: **성공**.
  로컬 AppImage fixture를 resolver의 실제 예상 경로에 `wx`로만 생성하며 기존 패키지가 있으면 덮어쓰지 않는다.
  테스트 종료 시 생성한 fixture만 제거한다. Linux 선택 → 저장 위치만 선택 → 실제 ZIP 생성/이름/서버 구성/출처 local,
  native launcher picker 호출 없음, 프로젝트·게임 설정·모드·파일·격리 및 760/1100px layout 검증.
  로그: `/tmp/studio-export-functional-final.log`.
- `node apps/admin/scripts/branding-smoke.mjs`: **성공**(실제 Electron native PNG/JPEG decode·실패 보존).
  로그: `/tmp/studio-export-branding.log`. DBus 환경 경고는 있었지만 probe exit 0.
- 스크린샷 `.cache/smoke/studio-{760,1100}-내보내기.png`(ignored)를 시각 확인했다.
  최종 select에 기존 `.inp` 클래스만 붙인 뒤 scoped Biome, Studio build, 전체 기능 smoke를 재실행해 성공했다.
  이 클래스 수정 뒤 전체 workspace 검사를 반복하지 않았다.
- `git diff --check`: 성공.

중간 검증 실패: 다운로드 헤더 오류를 `LAUNCHER_VERIFY`로 통일한 뒤 테스트의 이전 `INVALID` 기대값 하나를 수정했고,
추가한 symlink 테스트의 누락 import를 수정했다. 위 최종 전체 검사 및 resolver/기능 smoke는 수정 후 결과다.

## 한계 / #0 다음 단계

- **실제 GitHub 릴리스 다운로드 성공 증거는 없다.** 모든 릴리스 네트워크 테스트는 주입 fetch/Response mock이다.
  공식 owner/repo와 위 파일 이름·size·digest를 갖춘 안정 릴리스가 준비된 뒤 packaged Studio로 확인해야 한다.
- Windows 네이티브 picker/크로스 OS ZIP/패키지 실행, 실제 게임/로그인/서버 동작은 새로 검증하지 않았다.
  offline consent UI는 resolver 상태/버전 동의 단위 테스트로 확인했으며 실제 offline packaged 앱 화면 검증은 남아 있다.
- 서명된 업데이트 매니페스트는 RELEASE-02 범위다. `checkDigest`/릴리스 asset 메타데이터 선택 부분을
  서명 verifier 경계로 확장하고 캐시 metadata에도 검증 증거를 연결해야 한다. 현재 digest는 GitHub 메타데이터 기반이다.
- launcher 자체 자동 업데이트, 릴리스 업로드 CI, shared builder 설정과 의존성, packages/core는 변경하지 않았다.
- #0이 `eda9356` 및 이 인계 문서 커밋을 검토하고 main에 통합한 뒤 통합 결과를 progress에 기록해야 한다.
  사용자가 지정한 worker 역할이므로 이 브랜치를 스스로 main에 통합하지 않는다.

현재 dirty paths 없음(인계 커밋 후 기준). 남겨 둔 테스트/빌드/로그인/게임 프로세스 없음. 필수 사용자 동작 없음.
임시 toolchain/store/로그·ignored 스크린샷은 환경별 파일이다. 재개 시 존재 여부와 상태를 먼저 확인한다.
