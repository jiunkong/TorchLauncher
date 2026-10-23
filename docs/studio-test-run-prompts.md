# Studio 테스트 실행 — 작업자 프롬프트 (복사해서 사용)

[작업서](studio-test-run-task.md)의 각 작업을 GPT/Codex 세션에 그대로 붙여 넣는 프롬프트다. 순서와 선행 조건은 작업서를 따른다. 각 프롬프트는 독립적으로 읽혀도 되도록 공통 규칙을 포함한다. 시작 전에 `git -C /mnt/d/Projects/mclauncher log --oneline -5`로 기준 커밋을 확인하고, 프롬프트의 `<BASE>`를 그 커밋으로 바꾼다.

- 사용 가능한 빈 worktree: `.agents/worktrees/agent-2`, `agent-3`(main에 detached). 쓰기 전 `git status`로 비어 있는지 확인한다. 다른 세션이 쓰는 worktree는 사용하지 않는다.
- 시작 순서: AUTH-SHARE-01 + TESTRUN-CORE-01(동시) → TESTRUN-MAIN-01 → (시안 후) TESTRUN-UI-01.
- 모델 권장: AUTH-SHARE-01, TESTRUN-MAIN-01 = 높은 추론(프로세스 수명·인증·보안 경계). TESTRUN-CORE-01 = 중간(파서·테스트 중심). TESTRUN-UI-01 = 중간.

---

## 공통 머리말 (모든 프롬프트 앞에 붙임)

```
당신은 TorchLauncher 저장소(/mnt/d/Projects/mclauncher, pnpm 모노레포, Electron+TypeScript+React)의 구현 작업자입니다. 코디네이터(#0)가 아닙니다.

시작 절차:
1. AGENTS.md, docs/progress.md(맨 아래), docs/work-distribution.md, docs/studio-test-run.md, docs/studio-test-run-task.md를 읽으세요.
2. 지정된 worktree에서만 작업하세요. 시작 전 `git status --short --branch`, `git worktree list`, `git log --oneline -5`를 확인하고, 기존 미커밋/미추적 파일을 지우거나 리셋하지 마세요.
3. 지정된 브랜치를 기준 커밋 <BASE>에서 만드세요.

규칙(위반 금지):
- main 통합, docs/progress.md·docs/work-distribution.md 수정, 완료 선언은 #0만 합니다. 당신은 자기 브랜치에 커밋하고 docs/handoffs/<작업ID>.md에 보고합니다.
- 독점 범위 밖 파일은 수정하지 마세요. 꼭 필요하면 수정하지 말고 인계에 필요한 변경을 정확히 적으세요.
- 새 의존성, 루트 설정, lockfile, workspace 구성 변경은 먼저 중단하고 #0(사용자)에게 후보와 이유를 알리세요.
- apps/admin과 apps/launcher는 서로 import하지 않습니다. 공유 코드는 packages/*에 둡니다.
- 개발 중이므로 하위 호환 코드(마이그레이션, 레거시 리더, 버전 협상)를 만들지 마세요.
- 네이티브 확인창 금지(dialog.showMessageBox, window.confirm/alert/prompt). 파일 열기/저장 선택창만 네이티브입니다. 확인은 앱 안 모달로 합니다.
- 비밀(토큰, 계정 정보, 비공개 URL)을 커밋·로그·인계에 넣지 마세요.
- 기존 코드 스타일을 따르세요(strict TypeScript, 2칸 들여쓰기, Biome, camelCase/PascalCase). 사용자 문구는 앱의 i18n 사전을 거칩니다(Studio 렌더러는 ko/en 패리티 테스트가 있음).
- 커밋 메시지는 명령형 범위 지정(예: feat(core): ...)이고, 마지막 줄에 사용 중인 도구의 공동 작성자 표기를 넣으세요.
- 검증은 실제로 실행하고 결과(통과/실패 개수)를 정확히 보고하세요. 실행하지 못한 것은 "미실행"과 이유를 쓰세요. 실패를 숨기거나 완료로 포장하지 마세요.

완료 보고(인계 파일 + 최종 답변): 세션/모델, 작업 ID, 브랜치, 기준/최종 커밋, `git diff --stat <BASE>...HEAD`로 확인한 범위, 실행한 명령과 결과, 미실행 항목, 한계, 다음 작업자가 쓸 API/계약.
```

---

## 프롬프트 1 — AUTH-SHARE-01

```
작업 ID: AUTH-SHARE-01. worktree: /mnt/d/Projects/mclauncher/.agents/worktrees/agent-2, 브랜치 feat/auth-share, 기준 <BASE>.

목표: apps/launcher/src/main/auth/**(Microsoft 공개 Java 타이틀 인증 흐름, prismarine-auth 3.1.1 비공개 worker, 암호화 캐시/저장소, 브라우저, 오류, 검증, 테스트; 약 2,300줄)를 두 앱이 공유하는 워크스페이스 패키지로 추출하세요. 런처는 동작 변경 없이 새 패키지를 사용해야 합니다. Studio가 같은 패키지로 자체 Microsoft 로그인을 할 수 있어야 합니다(Studio 연결 자체는 후속 TESTRUN-MAIN-01에서 합니다). 런처와 Studio는 세션/토큰 저장소를 공유하지 않습니다.

먼저 docs/handoffs/AUTH-01.md, AUTH-02.md, AUTH-03.md와 packages/core/src/auth/contracts.ts를 읽으세요.

독점 범위: apps/launcher/src/main/auth/**(이동·삭제), 새 packages/<이름>/(권장 packages/desktop-auth; 이름과 package.json/tsconfig/workspace 변경은 구현 전에 사용자에게 제안하고 승인받으세요), 런처의 auth import 경로 변경(apps/launcher/src/main/index.ts, apps/launcher/src/main/product/*의 import만), 런처 electron-vite 설정 중 worker 번들 부분, docs/handoffs/AUTH-SHARE-01.md.

요구사항:
- 앱 의존 값(저장소 디렉터리, 앱 이름, Electron safeStorage, 외부 브라우저 열기, 캐시 파일 위치)은 생성 시 주입합니다. 패키지가 electron을 직접 import하지 않거나, 한다면 peer 형태의 얇은 어댑터로 분리하세요.
- prismarine-auth는 정확한 버전(3.1.1)으로 새 패키지가 소유합니다. lockfile 변경은 최소로 하고 `pnpm install --frozen-lockfile`이 갱신된 lockfile로 통과해야 합니다.
- packages/core/src/auth/contracts.ts의 공개 계약, 오류 코드, 정화 규칙, 캐시 암호화 방식, Win32 장치 메타데이터는 그대로 유지합니다. 토큰이나 원문 오류가 렌더러/로그로 나가지 않는 기존 보장을 유지하세요.
- worker(.cjs)와 번들 청크가 두 앱 빌드에서 만들어질 수 있는 방식을 제시하고, Studio에서 쓸 수 있음을 최소 테스트나 예제로 보이세요.
- 키링이 없는 환경(WSL)에서의 동작은 현재 런처 방식을 유지하고 결정을 인계에 기록하세요.

완료 기준: 기존 auth 테스트가 이동 후 모두 통과, `pnpm check` 통과, `node scripts/smoke.mjs`(런처) 통과(DISPLAY=:0), apps/launcher에 인증 구현 파일이 남지 않음(주입 어댑터 제외). 실제 계정 로그인은 사용자 계정이 필요하므로 "미실행"으로 쓰고 수동 확인 절차를 인계에 적으세요.
```

---

## 프롬프트 2 — TESTRUN-CORE-01

```
작업 ID: TESTRUN-CORE-01. worktree: /mnt/d/Projects/mclauncher/.agents/worktrees/agent-3, 브랜치 feat/testrun-core, 기준 <BASE>.

목표: Studio 테스트 실행의 순수 코어 로직을 packages/core에 만드세요. docs/studio-test-run.md의 "호환성 결과" 절과 docs/studio-test-run-task.md의 TESTRUN-CORE-01 절이 기준입니다. 먼저 packages/core/src/minecraft/logs.ts(로그 정화 규칙), packages/core/src/loaders/*, packages/core/src/instance/**를 읽으세요.

독점 범위: packages/core/src/diagnostics/**(신규), packages/core/src/instance/test-instance/**(신규), 필요한 최소 export 변경, docs/studio-test-run.md의 해당 절 보강, docs/handoffs/TESTRUN-CORE-01.md. instance/settings/**, apps/**는 수정하지 않습니다(다른 작업이 진행되었거나 진행 중).

구현:
1. analyzeGameLog(input) -> CompatibilityReport. 입력: { loader: 'fabric'|'neoforge', minecraftVersion, text 또는 lines, exit?: {code, signal}, crashReport?, mods? }. 제한: 총 4 MiB, 줄당 8 KiB, 결과 최대 200개(초과 시 truncated). 정규식은 선형으로(폭주 금지), 제어 문자 제거, 토큰/사용자 이름 정화는 기존 로그 정화 규칙을 재사용. 항목: { severity, category, modIds?, files?, summary(코드+파라미터, 문장은 UI i18n), evidence[{line,text<=400자}] }. 분류: loader-resolution(누락/버전 불일치 의존성, 중복 모드, 환경 불일치), mixin, class-loading, out-of-memory, java-version, crash, unclassified. Fabric: "Mod resolution failed", "Incompatible mod set", "Could not find required mod". NeoForge: "Missing or unsupported mandatory dependencies", "Failed to load mods", "Duplicate mods". 공통: Mixin apply failed, OutOfMemoryError, UnsupportedClassVersionError. status는 problems / no-problems-found / incomplete이고, no-problems-found는 호환 보증이 아니라는 점을 타입 주석과 문서에 명시하세요.
2. readModMetadata(jar 바이트 또는 스트림): fabric.mod.json(id, version, depends, environment)과 META-INF/neoforge.mods.toml(modId, version, dependencies). ZIP 항목 이름 검증, 항목 압축 해제 크기 1 MiB 제한, 중첩 jar 미읽기, 지원하지 않는 ZIP64는 명확한 오류. TOML은 이 용도에 필요한 최소 파서만(새 의존성이 필요하면 중단하고 사용자에게 알리세요).
3. planTestInstance({ candidateFiles, sourceRoot, instanceRoot }) -> { copies, removals, skipped }. 모든 경로는 상대·정규화·루트 안 검증, 링크 비추종. 삭제는 Studio가 이전에 복사한 파일만(원장 .torchlauncher-test/ledger.json, 형식 검증·크기 제한·손상 시 안전하게 거부). 게임이 만든 파일(options.txt, config, saves 등)은 삭제 대상이 아닙니다. 실제 복사 실행은 하지 않습니다.

테스트: 분류별 양성, 정상 로그 음성, 거대/악성 입력, 정규식 폭주 입력, 악성 ZIP 항목, 경로 탈출, 원장 손상. fixture는 일반적인 형태의 합성 로그를 fixtures/에 두고 출처를 인계에 적으세요(개인정보 없음).

완료 기준: pnpm lint && pnpm typecheck && pnpm test 통과, 인계에 공개 API와 fixture 출처. 실제 모드팩 로그로 검증하지 못했다면 그 사실을 한계에 쓰세요.
```

---

## 프롬프트 3 — TESTRUN-MAIN-01

```
작업 ID: TESTRUN-MAIN-01. 선행: AUTH-SHARE-01과 TESTRUN-CORE-01이 main에 통합되어 있어야 합니다(git log main으로 확인, 아니면 중단하고 알리세요). worktree: .agents/worktrees/agent-2 또는 agent-3 중 비어 있는 것, 브랜치 feat/testrun-main, 기준 <BASE>(통합 후 main).

목표: Studio 메인 프로세스에 테스트 실행을 구현하세요. docs/studio-test-run.md(흐름·결정·제약)와 docs/studio-test-run-task.md의 TESTRUN-MAIN-01 절이 기준입니다. 먼저 docs/handoffs/STUDIO-MAIN-01.md, STUDIO-MAIN-02.md, STUDIO-CLEAN-01.md, docs/game-launch.md, GAME-ACTIVITY-01.md를 읽고, 기존 Studio의 settingsImport 경로와 코어 installMinecraft/loaders/launchMinecraft/잠금/로그 수집 코드를 파악하세요.

독점 범위: apps/admin/src/main/**, apps/admin/src/shared/**, apps/admin/src/preload/**, apps/admin/electron.vite.config.ts(인증 worker 번들), 루트 scripts/smoke.mjs의 Studio 브리지 목록(필요한 줄만), docs/handoffs/TESTRUN-MAIN-01.md. 렌더러는 수정하지 마세요(TESTRUN-UI-01).

구현:
- 계정: AUTH-SHARE-01 패키지로 Studio 자체 Microsoft 로그인/로그아웃(진행 중 취소 포함). 토큰은 OS 암호화 저장소에만, 저장소 없는 환경의 동작은 인계에 기록. 런처와 세션 비공유(앱별 userData).
- 테스트 인스턴스: app.getPath('userData')/test-instances/<serverId>/. 현재 프로젝트의 배포 후보 파일(정책 적용 결과, 설정 정책이 관리하는 options.txt/팩 제외)을 planTestInstance로 계획하고 실행(원장 갱신). 소스 폴더는 읽기 전용. Java/기본 게임/로더 설치는 코어 설치 코드를 사용, 진행률·취소 지원.
- 실행/중지: 코어의 관리 프로세스·잠금·로그 수집을 사용. 중지는 정상 종료 요청 -> 제한 시간 후 강제 종료, 자식 정리. Studio 종료 시 자식 정리. 로그는 최근 N줄만 상태로 전달.
- 분석: 종료 후 analyzeGameLog와 readModMetadata로 CompatibilityReport와 모드 목록을 상태에 넣으세요.
- 설정 추출: 종료 후 인스턴스 루트의 options.txt, config/**, shaderpacks/*.txt, iris/oculus 설정을 기존 settingsImport 내부 경로로 읽어 게임 설정 상태를 채웁니다(이미 선택한 정책은 유지). 새 임의 경로 입력 IPC를 만들지 마세요(항상 인스턴스 루트 고정).
- 초기화: testReset은 인스턴스 폴더 범위만 삭제하며, 렌더러가 앱 안 모달 확인 후 confirmed: true로 보낼 때만 허용합니다(네이티브 확인창 금지).
- 상태/명령 계약(account, testRun{phase, progress, logs, report, mods, extracted, error}, testLogin/testLogout/testStart/testStop/testReset)은 작업서의 초안을 따르되 최종 형태를 인계에 정확히 적으세요. 모든 IPC는 신뢰된 메인 프레임과 정확한 인자를 검사합니다.

테스트: 가짜 설치기·가짜 프로세스로 phase 전이, 취소, 로그 제한, 추출 검증, 삭제 범위, 신뢰되지 않은 요청 거부. 완료 기준: pnpm check, node scripts/smoke.mjs, node apps/admin/scripts/smoke-functional.mjs 통과(DISPLAY=:0). 실제 로그인과 게임 실행은 사용자 계정이 필요하므로 "미실행"과 수동 검증 절차를 쓰세요. Linux에서 가능한 범위(로더 설치까지)는 실제로 시도하고 결과를 쓰세요.
```

---

## 프롬프트 4 — TESTRUN-UI-01

```
작업 ID: TESTRUN-UI-01. 선행: 테스트 실행 시안이 docs/design/studio/에 있고(README 표 갱신 포함) TESTRUN-MAIN-01이 main에 통합되어 있어야 합니다. 없으면 시작하지 말고 알리세요. worktree: 비어 있는 .agents/worktrees/agent-N, 브랜치 feat/testrun-ui, 기준 <BASE>.

목표: Studio 렌더러에 테스트 실행 화면을 시안대로 구현하세요. docs/studio-test-run.md, docs/studio-test-run-task.md의 TESTRUN-UI-01 절, docs/design/studio/README.md와 시안 파일, docs/handoffs/TESTRUN-MAIN-01.md(API), STUDIO-UI-02.md(기존 렌더러 구조)를 먼저 읽으세요.

독점 범위: apps/admin/src/renderer/**, apps/admin/scripts/*smoke*, docs/handoffs/TESTRUN-UI-01.md. main/shared/preload는 수정하지 마세요.

구현: 로그인 상태와 로그인 버튼, 테스트 실행 진입점과 단계 진행 패널, 실시간 로그(자동 스크롤·표시 제한), 호환성 결과 목록(심각도·분류·모드·근거 줄, 정상 종료 시 "문제를 찾지 못했습니다" — 호환 보증처럼 쓰지 말 것), 종료 후 설정 추출 요약, 게임 설정 빈 상태를 테스트 실행 중심으로 개편(외부 폴더/options.txt 불러오기는 보조 링크), 실행 중 중지, 인스턴스 초기화 앱 안 모달. 글꼴·토큰은 기존 Studio 규칙(번들 Pretendard Variable/Pixelify Sans, 외부 네트워크 글꼴 금지). 모든 문구는 ko/en i18n 사전으로, 패리티 테스트 통과.

완료 기준: pnpm check, noNativeDialogs 테스트 유지, 760px/1100px 실제 페인트 검사(elementFromPoint, 가로 스크롤 없음)를 포함한 Studio 기능 smoke 확장(가짜 상태 주입으로 로그인/실행/결과 화면 검증), 두 앱 smoke 통과(DISPLAY=:0). 실제 로그인·게임 실행은 미실행으로 표기하세요.
```
