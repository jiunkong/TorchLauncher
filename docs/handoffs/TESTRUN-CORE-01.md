# TESTRUN-CORE-01 작업자 인계

- 세션/역할: Codex 구현 작업자 agent-3, #0 아님. 모델: GPT-6 기반 Codex(세부 런타임 모델 식별자는 세션에 제공되지 않음).
- 작업 ID: TESTRUN-CORE-01.
- Worktree: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-3`.
- 브랜치: `feat/testrun-core`.
- 기준: `9d8f03b2d829e0512a75a4802a35a68140a548a8` — 사용자 프롬프트의 `<BASE>`가 실제 해시로 치환되지 않아 작업서의 “시작 시점 main 최신 커밋” 규칙 적용. 시작 당시 agent-3은 clean detached `d83ca66`이었으며 기존 작업을 삭제/리셋하지 않고 최신 main에서 새 브랜치를 생성했다.
- 최종 구현 커밋: `126f364fb2e56705fe886612eb3d0b17850ba25a`. 이 문서를 담은 후속 인계 커밋이 브랜치 HEAD이며 정확한 최종 HEAD는 세션 최종 응답으로 전달한다(자기 참조 해시 방지).
- 상태: 구현·작업자 검증·커밋을 인계한다. main 통합과 작업 완료 판정은 #0에게 남아 있다. `docs/progress.md`, `docs/work-distribution.md`, apps, instance/settings, 의존성/manifest/lockfile/루트 설정을 수정하지 않았다.

## 검증 결과

환경: Linux/WSL, Node `v24.21.0`, `corepack pnpm --version` = `10.34.7`. 기존 worktree 의존성을 사용했으며 새 설치/새 의존성이 없다.

- `corepack pnpm exec biome check --write packages/core/src/diagnostics packages/core/src/instance/test-instance packages/core/src/index.ts`: 마지막 코드 정리 검사 통과, 변경 범위 진단 0개.
- `corepack pnpm --filter @torchlauncher/core typecheck`: 통과.
- `corepack pnpm exec vitest run packages/core/src/diagnostics packages/core/src/instance/test-instance`: 최종 실행 **3파일·65테스트 통과, 실패/skip 0**(2.19초). 최초 실행은 64개 통과였고 토큰 키와 사용자명 충돌 회귀 테스트를 추가한 뒤 65개로 다시 확인했다.
- 최종 전체 검사: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`(명령별 로그를 `/tmp/testrun-core-{lint,typecheck,test}.log`로 저장), 종료 코드 0.
  - lint: **359파일, 오류 0, 기존 경고 37·정보 3**, 수정 없이 통과. 변경한 코드의 별도 Biome 검사는 진단 0개였다.
  - typecheck: core 및 두 앱의 전체 타입 검사 통과.
  - test: **92파일 통과·4파일 skip, 1,363테스트 통과·9 skip·0실패**, 30.84초. live/옵트인 검사를 활성화하지 않았다.
- `git diff --check`, `git diff --cached --check`: 통과.
- 실패 이력: 최초 개발 중 Biome가 ZIP 이름 검증 정규식의 제어 문자 두 건을 지적했고 해당 보안 검사에 제한된 사유 주석을 추가했다. 단위 테스트 및 최종 전체 검사는 실패 0개다.
- 미실행: 실제 Fabric/NeoForge 모드팩 로그, 실제 jar와 모드팩 실행, 로그인/게임/실서버 E2E, Windows 네이티브 검사, 앱 build/smoke/package. 이번 범위는 코어 로직이며 실계정·실제 팩을 사용하지 않았다. 전체 테스트의 9개 skip을 실제 검증으로 간주하지 않는다.

## 공개 API / MAIN 작업자 계약

기존 `packages/core/src/index.ts`에 필요한 네임스페이스 export 두 개만 추가했다. package manifest 변경은 없다.

```ts
import { diagnostics, testInstance } from '@torchlauncher/core';

const report = diagnostics.analyzeGameLog({
  loader: 'fabric',
  minecraftVersion: '1.21.1',
  lines: sanitizedOrRawLines,
  exit: { code: 0, signal: null },
  secretsToHide: knownNamesAndTokens,
});
const jar = await diagnostics.readModMetadata(jarBytesOrAsyncByteStream);
const plan = await testInstance.planTestInstance({
  candidateFiles: [{ path: 'mods/example.jar', policy: 'always' }],
  sourceRoot,
  instanceRoot,
});
```

- `analyzeGameLog`: 동기 순수 함수. `text` 또는 `lines` 중 하나, 선택적 `exit`, `crashReport`, `mods`, `secretsToHide`. 둘 다 주면 오류. 합계 4 MiB·줄당 8 KiB·65,536줄·결과 200개 상한, 초과 시 `truncated`. 과대 원문 일부로 비밀을 노출하지 않는다. 텍스트의 과대 줄은 그 지점에서 이후 분석을 중단한다. 배열 입력에서는 과대 줄을 버린다.
- `CompatibilityReport`: `{status, truncated, items}`. `no-problems-found`는 시작 신호·2개 이상 유효 줄·정상 종료가 있고 알려진 오류가 없다는 뜻이며 **호환 보증이 아니다**. 오류 발견은 `problems`, 나머지 불충분한 관측은 `incomplete`.
- 항목: `{severity, category, modIds?, files?, summary:{code, parameters}, evidence:[{source:'log'|'crash-report', line, text}]}`. 줄 번호는 원본별 1-based, 근거 최대 400 UTF-16 코드 단위. 초기 알려진 패턴은 모두 error 심각도로 낸다. 모드 ID/파일 연결은 주어진 `mods`와 정화한 줄이 일치할 때만 한다.
- UI i18n에 필요한 요약 코드: `loader-resolution-failed`, `dependency-mismatch`, `duplicate-mod`, `environment-mismatch`, `mixin-failed`, `class-loading-failed`, `out-of-memory`, `java-version-mismatch`, `game-crashed`, `unknown-error`, `crash-report-present`, `abnormal-exit`. `abnormal-exit.parameters.code`는 종료 코드 또는 -1, 나머지 parameters는 현재 빈 객체다. UI 문장을 코어에 넣지 않았다.
- 기존 `GameLogs`를 재사용하면서 제어 문자 제거 → 토큰 필드/명령줄 토큰 정화 → 알려진 비밀과 사용자명 정화 순서를 유지한다. `Setting user:` 이름은 이후 줄에 재사용하고 홈 경로 사용자명도 가린다. 호출자는 알려진 계정명/토큰을 `secretsToHide`로 제공한다(256개·각 8,192자까지). 기존 `minecraft/logs.ts`는 수정하지 않았다.
- `readModMetadata`: `Promise<ModInfo>`; `{loader, mods:[{id, version, dependencies:[{id, version:string|string[], type?, side?}], environment?}], file?}`. 복수 NeoForge 모드를 지원한다. `file`은 호출자가 안전한 basename으로 덧붙이는 선택 필드다. jar 64 MiB, 스트림 100,000청크, ZIP 10,000항목, 중앙 디렉터리 8 MiB, 메타데이터 압축 해제 항목당 1 MiB 제한. ZIP 경로·중복·로컬 이름·링크·CRC를 확인하고 중첩 jar를 읽지 않는다.
- `ModMetadataError.code`: `invalid-zip | unsafe-entry | zip64-unsupported | limit-exceeded | unsupported-compression | metadata-not-found | invalid-metadata | unsupported-toml`. ZIP64는 명시 오류다. 양쪽 로더 메타데이터가 함께 있으면 `invalid-metadata`로 거부한다. TOML은 필요한 따옴표 문자열/표만 지원하고 관련 없는 필드와 설명 여러 줄 문자열은 건너뛴다. 버전 범위나 `${file.jarVersion}`을 평가하지 않는다.
- `planTestInstance`: 비동기 **읽기 전용** 계획. 후보 `{path, policy:'always'|'initial-only'|'exclude'}`는 MAIN이 배포/설정 정책 제외를 적용한 목록이다. 절대·정규화·상호 분리된 root를 요구하며 instanceRoot는 아직 없어도 된다. 경로·루트 조상 링크·각 항목 링크·hardlink·대소문자/부모 충돌을 거부한다.
- 결과 `{copies, removals, skipped, nextLedger}`. copies에는 절대 `source`, `destination`, 적용 전 `before` 해시/길이 또는 null, 적용 후 소유 정보 `after`가 있다. removals에는 `destination`, 기존 소유 정보 `before`가 있다. 기존 비소유 파일은 같은 내용이어도 편입/덮어쓰기하지 않는다. 소유 파일의 변경은 보존하고 기록한 initial-only의 수정/삭제도 보존한다.
- `skipped.reason`: `excluded | initial-only | unowned | modified | game-data | unchanged`. 원장 소유 + 현재 해시/길이 일치 + 더 이상 후보에 없는 always 파일만 제거 후보가 된다. options/config/saves/logs/crash-reports/screenshots/shader 옵션 등은 제거하지 않는다. 제외되거나 더 이상 관리하지 않는 보존 파일은 다음 원장에서 소유권을 내려놓는다.
- 원장 상수 `TEST_INSTANCE_LEDGER_PATH = '.torchlauncher-test/ledger.json'`, `TEST_INSTANCE_LEDGER_LIMIT = 1 MiB`. `{version:1, files:[{path,policy,sha256,length}]}`, 10,000개까지, `JSON.stringify` 결과(+선택적 마지막 newline 하나). `parseTestInstanceLedger(text)` 공개, 손상/중복 키/지원 외 버전/악성 경로를 안전하게 거부한다. 없는 원장만 빈 소유권으로 취급한다.
- `TestInstanceError.code`: `unsafe-path | invalid-ledger | limit-exceeded | invalid-candidates | source-missing | local-changed`.
- **적용 책임은 MAIN**: 게임과 준비 직렬화 및 인스턴스 잠금, 실제 적용 직전 링크/파일 정체성/소스 및 before 해시 재검증, 안전한 복사·삭제, 중단 복구, 모든 적용 성공 후 `nextLedger` 원자 저장. 이 API는 파일 시스템 스냅샷/트랜잭션을 제공하지 않으며 스스로 mkdir/copy/delete/ledger-write하지 않는다. 앱이나 settings 계약 변경은 이번에 하지 않았다.

## Fixture 출처와 한계

- `diagnostics/fixtures/{fabric-failure,neoforge-failure,normal}.log`: 작업자가 작성한 **합성 로그**. 사용자 작업 지시와 저장소 명세가 제시한 일반적인 오류 문자열 및 Minecraft 로그 접두사 형태를 사용했다. 외부 이슈/개인의 실제 로그를 복사하거나 실제 모드팩에서 수집한 자료가 아니다. ID/파일명은 example 계열이며 개인정보·실제 계정·비공개 URL이 없다. 저장소의 `*.log` ignore 때문에 이 세 합성 파일만 명시적으로 force-add했다.
- `diagnostics/fixtures/zip.ts`: 저장소의 기존 `instance/mods/fixtures.ts`의 테스트 ZIP 생성기 부분을 새 독점 범위 안에 복사한 합성 fixture 생성 도구. 실제 jar 배포물이 없다.
- 로그 분석은 알려진 영문 문자열의 휴리스틱이며 로더 버전/현지화에 따라 누락·오탐이 가능하다. 실제 모드팩 로그 검증은 **미실행**이다. 시작 신호나 종료 정보가 없으면 무오류 판정을 하지 않는다.
- 메타데이터는 선언을 읽을 뿐, 의존성 해결·버전 범위 평가·중첩 jar 탐색·manifest 치환을 하지 않는다. ZIP64와 메타데이터가 양쪽 로더용으로 함께 존재하는 jar는 지원하지 않는다. 최소 TOML 문법 밖의 소비 필드는 명시 오류다.
- 계획 이후 파일이 바뀔 수 있으므로 MAIN의 재검증/트랜잭션 구현 전에는 실제 파일 적용 안전성이 완성되지 않는다. 이 함수의 결과만으로 복사/삭제를 곧바로 수행하지 않는다.
- 진행 중 프로세스 없음. 사용자에게 남긴 승인 요청 없음. 다음: #0이 diff/계약 검토 후 통합 여부 결정, TESTRUN-MAIN-01이 위 API를 연결한다.

## 변경 범위 확인

`git diff --stat 9d8f03b...HEAD`의 구현 커밋 결과(인계 문서 자체는 후속 커밋에 추가):

```text
 docs/studio-test-run.md                            |  19 ++
 .../src/diagnostics/fixtures/fabric-failure.log    |   7 +
 .../src/diagnostics/fixtures/neoforge-failure.log  |   4 +
 packages/core/src/diagnostics/fixtures/normal.log  |   3 +
 packages/core/src/diagnostics/fixtures/zip.ts      |  49 ++++
 packages/core/src/diagnostics/index.ts             |   2 +
 packages/core/src/diagnostics/logs.test.ts         | 157 +++++++++++
 packages/core/src/diagnostics/logs.ts              | 274 ++++++++++++++++++
 packages/core/src/diagnostics/metadata.test.ts     | 169 +++++++++++
 packages/core/src/diagnostics/metadata.ts          | 305 ++++++++++++++++++++
 packages/core/src/index.ts                         |   3 +
 packages/core/src/instance/test-instance/index.ts  | 312 +++++++++++++++++++++
 .../core/src/instance/test-instance/plan.test.ts   | 246 ++++++++++++++++
 13 files changed, 1550 insertions(+)
```

위 범위와 이 인계 파일만 변경했다. main에는 병합하지 않았다. 최종 브랜치에서 같은 명령을 다시 실행하면 이 인계 파일까지 포함된다.
