# Studio 테스트 실행 — 구현 작업서 (GPT/Codex 작업자용)

사용자가 테스트 실행 관련 기능 구현을 GPT 계열 작업자에게 맡기기로 했다(2026-10-23). 이 문서는 대화 기록 없이 바로 착수할 수 있게 쓴 작업서다. 제품 결정과 흐름은 [studio-test-run.md](studio-test-run.md)가 기준이고, 이 문서는 **순서, 범위, 인터페이스 초안, 완료 기준, 보고 형식**을 정한다.

복사해서 쓰는 작업자 프롬프트: [studio-test-run-prompts.md](studio-test-run-prompts.md).

## 먼저 읽을 것

1. `AGENTS.md`(역할 규칙, 개발 중 하위 호환 불필요, 구조/스타일), `docs/progress.md` 맨 아래, `docs/work-distribution.md`.
2. [studio-test-run.md](studio-test-run.md)(결정·흐름·판정·제약).
3. 인증: `docs/handoffs/AUTH-01.md`, `AUTH-02.md`, `AUTH-03.md`(공개 Java 타이틀 임시 인증, prismarine-auth 3.1.1 비공개 worker). 게임: `docs/game-launch.md`, `docs/handoffs/GAME-0*.md`, 활동/로그 `docs/handoffs/GAME-ACTIVITY-01.md`.
4. Studio 현재 API: `docs/handoffs/STUDIO-MAIN-01.md`, `STUDIO-MAIN-02.md`, `STUDIO-UI-02.md`(설정 불러오기 `settingsImport`, 상태 모양, 확인 모달 규칙). 설정 정책: `docs/settings-policy.md`.
5. 시안 규칙: `docs/design/studio/README.md`. **테스트 실행 시안은 아직 없다**(아래 TESTRUN-UI-01 선행 조건).

## 역할과 Git 규칙 (AGENTS.md 요약, 위반 금지)

- 작업자는 자기 브랜치/worktree에서만 일한다. `main` 통합, `docs/progress.md`/`docs/work-distribution.md` 수정, 작업 완료 선언은 #0만 한다.
- 브랜치 이름 예: `feat/auth-share`, `feat/testrun-core`, `feat/testrun-main`, `feat/testrun-ui`. 기준은 시작 시점 `main` 최신 커밋을 인계에 기록한다.
- 메시지는 `feat(core): ...` 형식의 명령형. 새 의존성·루트 설정·lockfile·workspace 구성 변경은 **#0과 먼저 합의**한다(특히 AUTH-SHARE-01).
- 앱끼리 import 금지(`apps/admin` ↔ `apps/launcher`). 공유 코드는 `packages/*`.
- 하위 호환 코드 금지(개발 중). 포맷을 바꾸면 문서·테스트를 같이 바꾼다.
- 네이티브 확인창 금지(앱 안 모달만). 파일 열기/저장 선택창만 네이티브.
- 인계: `docs/handoffs/<작업ID>.md`에 세션/모델, 브랜치, 기준·최종 커밋, 변경 경로, 실행한 검증 명령과 **정확한 결과**(통과/실패/미실행), 한계, 다음 작업자가 알아야 할 API를 쓴다. 없는 검증은 "미실행"이라고 쓴다.
- 현재 진행 중인 작업: **STUDIO-CLEAN-01**(Claude 작업자, `chore/dev-compat-cleanup`, `apps/admin/src/main|shared|preload`, `packages/core/src/instance/settings/**`, 설정 정책 형식 단일화·프로젝트 스키마 단순화·닫기 요청 수정). TESTRUN-MAIN-01은 이것이 `main`에 통합된 뒤 그 `main`에서 시작한다. AUTH-SHARE-01과 TESTRUN-CORE-01은 범위가 겹치지 않아 지금 시작할 수 있다. 시작 전 `git log main`과 `docs/progress.md`로 통합 여부를 확인한다.

## 순서

```
AUTH-SHARE-01 ─┐
               ├─> TESTRUN-MAIN-01 ─> TESTRUN-UI-01 (시안 필요)
TESTRUN-CORE-01┘
```

AUTH-SHARE-01과 TESTRUN-CORE-01은 병렬 가능. 한 작업자가 둘 다 맡아도 되지만 브랜치와 인계는 분리한다.

---

## AUTH-SHARE-01 — 인증 공유 패키지 추출

**목적**: 현재 `apps/launcher/src/main/auth/**`(약 2,300줄: Microsoft 공개 Java 타이틀 흐름, worker, 암호화 캐시/저장소, 브라우저, 오류)가 런처 앱 안에만 있어 Studio가 쓸 수 없다. 두 앱이 공유하는 워크스페이스 패키지로 추출하고 런처는 **동작 변경 없이** 이를 쓴다.

**범위(독점)**: `apps/launcher/src/main/auth/**`(이동·삭제), 새 `packages/<이름>/`(권장 이름 `packages/desktop-auth`, 확정은 #0과 합의), 런처의 import/빌드 설정 중 worker 번들 부분, `docs/handoffs/AUTH-SHARE-01.md`. 런처의 인증 호출부(`apps/launcher/src/main/index.ts`, `product/*`)는 import 경로 변경만.

**요구사항**
- 저장소 위치, 앱 이름, Electron `safeStorage`, 브라우저 열기 등 **앱 의존 값은 주입**한다(앱별 userData, 서로 세션 비공유).
- `prismarine-auth@3.1.1`은 새 패키지로 이동한다(정확한 버전 고정 유지). lockfile 변경은 최소로, `pnpm install --frozen-lockfile`이 새 lockfile로 통과해야 한다.
- 공개 계약(`packages/core/src/auth/contracts.ts`)과 오류 코드·Win32 장치 메타데이터·정화 규칙·캐시 암호화 동작은 그대로. 토큰/원문 오류가 렌더러나 로그로 나가지 않는 기존 보장 유지.
- worker 번들링: 두 앱 빌드(`electron-vite`)가 worker `.cjs`와 청크를 만들 수 있게 한다. Studio 쪽 번들 설정 추가는 TESTRUN-MAIN-01에서 하되, 이 작업에서 **Studio가 사용할 수 있음을 최소 예제 또는 테스트**로 보인다.
- 키링 없는 환경(WSL 등): 현재 런처가 하는 대로 처리하고, 결정을 인계에 기록한다.

**완료 기준**: 기존 auth 테스트 전부 이동 후 통과, `pnpm check`, 런처 smoke(`node scripts/smoke.mjs`) 통과, 런처 인증 관련 파일이 `apps/launcher`에 남지 않음(주입 어댑터 제외), 실제 로그인 검증은 사용자 계정이 필요하므로 "미실행"으로 명시.

---

## TESTRUN-CORE-01 — 로그 분석기, 모드 메타데이터, 인스턴스 준비 계획

**범위(독점)**: `packages/core/src/diagnostics/**`(신규), `packages/core/src/instance/test-instance/**`(신규), 필요한 최소 export(`packages/core/src/index.ts` 등은 #0과 조율), 문서 `docs/studio-test-run.md`의 해당 절 보강, `docs/handoffs/TESTRUN-CORE-01.md`. `instance/settings/**`와 admin은 건드리지 않는다(STUDIO-CLEAN-01 진행 중).

**1) 로그 분석기** — 순수 함수: `analyzeGameLog(input) -> CompatibilityReport`
- 입력: `{ loader: 'fabric'|'neoforge', minecraftVersion, lines: string[] 또는 텍스트, exit: { code, signal } | null, crashReport?: string, mods?: ModInfo[] }`.
- 제한: 총 입력 4 MiB, 줄당 8 KiB, 찾은 항목 최대 200개. 초과분은 잘라내고 `truncated: true`. 정규식은 선형(폭주 방지), 제어 문자 제거.
- 출력 항목: `{ severity: 'error'|'warning'|'info', category, modIds?: string[], files?: string[], summary(영문 코드와 파라미터; 문장은 UI i18n), evidence: { line, text(최대 400자) }[] }`.
- 분류(초기): `loader-resolution`(누락/버전불일치 의존성, 중복 모드, 환경 불일치), `mixin`, `class-loading`, `out-of-memory`, `java-version`, `crash`(exit!=0 또는 crash-report), `unclassified`. Fabric: `Mod resolution failed`, `Incompatible mod set`, `Could not find required mod`; NeoForge: `Missing or unsupported mandatory dependencies`, `Failed to load mods`, `Duplicate mods`; 공통: `Mixin apply failed`, `OutOfMemoryError`, `UnsupportedClassVersionError`.
- 결과 요약: `status: 'problems'|'no-problems-found'|'incomplete'`. "문제 없음"은 호환 보증이 아니다. 로그가 너무 짧거나 시작 신호가 없으면 `incomplete`.
- 계정 토큰·사용자 이름 노출 방지: 기존 `packages/core/src/minecraft/logs.ts`의 정화 규칙을 재사용(수정은 필요 시 최소로 하고 인계에 기록).
- fixture: 실제와 가까운 Fabric/NeoForge 실패 로그를 `fixtures/`에 만든다(공개 문서·이슈의 일반적 형태 기반, 개인정보 없음). 각 분류별 양성 + 정상 로그 음성 + 거대/악성 입력 테스트.

**2) 모드 메타데이터**: `readModMetadata(jarBytes|stream) -> ModInfo | error`
- `fabric.mod.json`(id, version, depends, environment), `META-INF/neoforge.mods.toml`(modId, version, dependencies). ZIP 항목 이름 검증, 항목 압축 해제 크기 제한(1 MiB), 중첩 jar 읽지 않음, ZIP64 미지원이면 명확한 오류. TOML은 이 용도에 필요한 최소 파서(새 의존성이 필요하면 #0과 합의).

**3) 인스턴스 준비 계획**: `planTestInstance({ candidateFiles, sourceRoot, instanceRoot }) -> { copies, removals, skipped }`
- 배포 후보 파일 목록(Studio 프로젝트의 정책 적용 결과: 항상/최초/제외, 설정 정책이 관리하는 `options.txt`와 팩 제외)을 인스턴스에 맞추는 복사/삭제 계획. 모든 경로는 상대·정규화·루트 안·링크 비추종 검증. 인스턴스에 있지만 후보에 없는 **Studio가 이전에 복사한 파일**만 삭제 대상(소유 기록 `.torchlauncher-test/ledger.json` 사용). 운영자가 인스턴스 안에서 게임이 만든 파일(`options.txt`, `config`, `saves` 등)은 삭제하지 않는다.
- 실제 복사 실행은 TESTRUN-MAIN-01에서 한다. 여기서는 계획과 원장 형식·검증까지.

**완료 기준**: 단위 테스트(분류별 양성/음성, 제한, 악성 경로, 원장 손상), `pnpm lint && pnpm typecheck && pnpm test`, 인계에 공개 API와 fixture 출처.

---

## TESTRUN-MAIN-01 — Studio 메인: 로그인, 테스트 인스턴스, 실행, 로그, 설정 추출

**선행**: AUTH-SHARE-01, TESTRUN-CORE-01, STUDIO-CLEAN-01 통합. **범위(독점)**: `apps/admin/src/main/**`, `apps/admin/src/shared/**`, `apps/admin/src/preload/**`, `apps/admin/electron.vite.config.ts`(worker 번들), 루트 `scripts/smoke.mjs`의 Studio 브리지 목록, `docs/handoffs/TESTRUN-MAIN-01.md`.

**상태/명령 초안**(StudioState에 추가, 이름은 구현자가 정하되 인계에 확정 계약을 적는다):
- `account`: `{ signedIn, name?, available(안전 저장소 유무) }`, 명령 `testLogin`, `testLogout`(진행 중 취소 포함, 로그인 흐름의 외부 브라우저는 기존 방식).
- `testRun`: `{ phase: 'idle'|'preparing'|'installing'|'syncing'|'running'|'analyzing'|'done'|'failed', progress, logs(최근 N줄), report: CompatibilityReport|null, mods: ModInfo[], extracted: { options, configFiles, shaderFiles } | null, error }`.
- 명령 `testStart`, `testStop`(게임 종료 요청 → 제한 시간 후 강제 종료, 자식 정리), `testReset`(인스턴스 폴더 범위 삭제, 렌더러 확인 모달 후 `confirmed: true`로만 허용).
- 종료 후 추출: 인스턴스의 `options.txt`, `config/**`, `shaderpacks/*.txt`, `config/iris.properties`를 기존 `settingsImport` 내부 경로로 읽는다(새 임의 경로 입력 IPC 금지, 항상 인스턴스 루트 고정).
- 모든 IPC는 신뢰된 메인 프레임·정확한 인자 검증. 소스 폴더는 읽기 전용. Java/기본 게임/로더 설치는 코어 `installMinecraft`/loaders 설치 코드, 실행은 `launchMinecraft`+기존 관리 프로세스·잠금·로그 수집을 사용. Studio 종료 시 게임 자식 정리.
- 인스턴스 위치: `app.getPath('userData')/test-instances/<serverId>/`. 런처 데이터와 공유하지 않는다.

**완료 기준**: 단위/통합 테스트(가짜 설치기·가짜 프로세스로 phase 전이, 취소, 로그 제한, 추출 검증, 삭제 범위), `pnpm check`, 두 앱 smoke, Studio 기능 smoke 확장. **실제 로그인·게임 실행은 사용자 계정이 필요하므로** 별도 수동 검증 절차를 인계에 쓰고 "미실행"으로 표기. Linux 헤드리스에서 가능한 범위(로더 설치까지, 게임 창 없는 실행 시도)는 가능하면 실제로 시도한다.

---

## TESTRUN-UI-01 — Studio 화면

**선행**: 테스트 실행 시안(`docs/design/studio/`에 추가 + README 표 갱신), TESTRUN-MAIN-01의 API 확정. **시안이 없으면 시작하지 않고 #0/사용자에게 알린다.**

**범위(독점)**: `apps/admin/src/renderer/**`, `apps/admin/scripts/*smoke*`, `docs/handoffs/TESTRUN-UI-01.md`. 정보 구조 변경 포함: 기존 "게임 설정" 섹션(탭 5개)을 "게임 구성"(모드 설정·리소스팩·셰이더·파일 순서), "테스트 실행", "플레이어 설정"(단축키 · 옵션)으로 분리하고 사이드바를 시안 순서로 재구성한다([화면 구성](studio-test-run.md)). 시안에 필요한 요소(요구 화면 목록): 로그인 상태/로그인 버튼, 테스트 실행 진입점과 단계 진행 패널, 실시간 로그(자동 스크롤·제한), 호환성 결과 목록(심각도·분류·모드·근거 줄, "문제를 찾지 못했습니다" 문구), 게임 종료 후 설정 추출 결과 요약, 게임 설정 빈 상태를 "테스트 실행" 중심으로 개편(외부 폴더 불러오기는 보조 링크), 인스턴스 초기화 확인 모달(네이티브 금지), 실행 중 중지.

**완료 기준**: 글꼴·토큰은 기존 Studio 규칙, 모든 문구 i18n(ko/en 패리티), 760/1100px 실제 페인트 검사, `noNativeDialogs` 유지, Studio 기능 smoke 확장, 전체 검사.

---

## 공통 완료 보고

PR 또는 인계 파일에 다음을 쓴다: 세션/모델 이름, 작업 ID, 브랜치, 기준/최종 커밋, 변경 파일 범위 확인(`git diff --stat main...`), 실행한 명령과 결과(정확한 개수), 미실행 검증과 이유, 알려진 한계, #0이 알아야 할 계약 변경. #0이 검토·통합한 뒤에 다음 작업을 시작한다.
