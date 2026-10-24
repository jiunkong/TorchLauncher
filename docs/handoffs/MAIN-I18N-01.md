# MAIN-I18N-01 — main process localization

## 설계 결정 (구현 전)

메인 프로세스 문자열은 앱별 main 전용 타입 카탈로그에서 번역합니다. 기존 `@torchlauncher/core/i18n`의 `defineTranslations` / `createTranslator` API를 재사용하고 core 파일·의존성은 바꾸지 않습니다. 각 renderer provider는 저장/시스템 설정을 반영한 해석 언어(`ko` 또는 `en`)를 초기 렌더와 매 언어 변경 때 기존 Studio request 및 Launcher product command 채널의 정확한 `set-language` 명령으로 main에 보냅니다. IPC는 기존의 sender/main-frame/trusted-URL 검사를 먼저 적용하고, payload는 정확히 언어 필드만 허용합니다. main은 언어를 프로세스 메모리에 보관하고 최초 알림 전에는 `app.getLocale()`의 `ko*`만 한국어, 나머지는 영어로 정규화합니다. Studio 결과 문장은 main에서 코드와 값(`resultKey`, signing sequence/새 키 여부)을 내보내고 Studio renderer 카탈로그가 표시합니다. 런처의 렌더러 카탈로그는 타 작업자가 소유하므로 바꾸지 않고, 기존 런처 오류/결과 코드는 렌더러에서 유지하며 main의 네이티브 UI 문구만 앱별 main 카탈로그로 번역합니다.

## 사전 인벤토리 (가시 문자열 경계)

| 분류 | 사전 조사 위치 / 사례 | 처리 방식 |
| --- | --- | --- |
| (가) 네이티브 대화상자 제목·필터·버튼 | Studio `main/index.ts`의 프로젝트/배포/키/옵션/팩/게임 폴더·브랜딩 열기, 프로젝트/torchpack/키/ZIP 저장; `shared/studio.ts`의 브랜딩 선택 이름 | 언어 동기화 후 앱별 main 카탈로그에서 번역. 고정 파일명과 확장자는 유지 |
| (가) 네이티브 대화상자 제목·필터·버튼 | Launcher `main/index.ts`의 종료 확인 실패 메시지/확인 버튼, 사용자 모드 추가/JAR 필터 | 종료 오류 대화상자와 모드 선택 대화상자를 런처 main 카탈로그로 번역 |
| (나) main 상태의 UI 결과/오류 | Studio `main/studio.ts`의 저장·서명·torchpack·서버 일치·런처 ZIP 결과(현재 `state.result`) 및 `main/project.ts`의 새 프로젝트 기본 이름 | 결과는 타입 결과 키 및 값으로 변경하고 renderer 카탈로그가 번역. 기본 프로젝트 이름은 main locale에 따라 생성 시 번역 |
| (나) main 상태의 UI 결과/오류 | Launcher `main/product/service.ts`, `main/game-smoke/**`의 상태 `error`/`outcome` 값 | 코드/상태 enum이며 런처 렌더러가 번역. renderer catalog 금지 범위라 변경하지 않고 계약 유지 |
| (다) 진단 로그 | 양쪽 `main/index.ts`의 Chromium URL 로드 실패 로그, 테스트/게임 로그 데이터 | 번역하지 않음. 진단용 로그이므로 원문·기계 코드 유지 |
| (라) 앱 이름·창 제목 | `applicationNames`, Studio 창 제목, 런처 운영자 브랜딩 앱 이름 | 기록만 함. 제품 식별 및 운영자 지정 브랜딩 이름은 번역하지 않음 |

## 새 동기화 명령 계약 (구현 예정)

- Studio: 기존 `studio:request`에 `{ action: 'setLanguage', language: 'ko' | 'en' }`; 정확히 두 own field만 허용.
- Launcher: 기존 `torchlauncher:product`에 `{ type: 'set-language', language: 'ko' | 'en' }`; 정확히 두 own field만 허용.
- 두 채널 모두 기존 trusted sender, main frame, renderer URL 검증을 먼저 거칩니다. 잘못된 언어·추가/누락 필드·비신뢰 프레임은 거부합니다.
- main 언어 상태는 메모리 전용이며 renderer가 각 provider 시작 및 언어 변경 시 전송합니다. 초기 fallback은 `app.getLocale()`에서 계산합니다.

## 구현 내용

- Studio의 `studio:request` payload `{ action: 'setLanguage', language: 'ko' | 'en' }`, Launcher의 `torchlauncher:product` payload `{ type: 'set-language', language: 'ko' | 'en' }`를 추가했습니다. own field의 정확한 수/존재와 언어 값을 확인하며 trusted main frame 검사 이후 처리합니다. 렌더러 provider가 첫 구독 후, 그리고 해석된 언어가 바뀔 때마다 전송합니다. main은 프로세스 메모리에서만 활성 언어를 보관하고, 첫 동기화 전에는 `app.getLocale()`에서 `ko*`만 ko로 정규화합니다.
- 양쪽 main에 카탈로그와 짝/플레이스홀더 검사를 추가했습니다. 네이티브 대화상자 factory에 Electron dialog 객체를 주입해 ko/en 제목·필터가 실제 options에 들어가는지 테스트합니다. 파일명 `server-project.torchproj`, `signing-key.torchkey`는 고정합니다.
- Studio 결과 상태는 `state.result`에 문장 대신 `StudioResult` 키와 값(sequence, 서명 여부, 키 생성 여부)을 싣습니다. Studio 렌더러 카탈로그/결과 포매터가 해석 언어에 맞춰 표시합니다. 새 프로젝트 기본 이름도 생성 시 main locale에 맞춰 `새 서버` 또는 `New server`로 정합니다.
- 런처 서비스의 오류·결과·진행 값은 기존 코드이며 런처 renderer에서 이미 i18n 처리하므로 해당 계약은 유지했습니다. 런처 renderer catalog는 수정하지 않았습니다. 런처의 모드 선택 제목/필터와 종료 실패 오류창의 메시지/버튼은 main 카탈로그를 사용합니다.
- 기존 Studio 기능 smoke의 저장 결과 검사를 한국어/영어에 대응시키고, 앱 내 언어를 영어로 바꾼 후 저장 제목 `Save project`, 한국어 복귀 후 빌드 제목 `torchpack 생성`을 가로채 검증합니다. Studio의 네이티브 메시지 상자 차단 카운트도 기존 기능 smoke에서 계속 확인했습니다.

## 분류별 인벤토리와 처리/미처리 항목

| 분류 | 발견 위치/문구 유형 | 처리 방식 및 남은 항목 |
| --- | --- | --- |
| (가) 네이티브 대화상자 제목·필터 | Studio 프로젝트/소스/파일/런처/브랜딩/키/options.txt/게임 폴더/팩 열기, 프로젝트/torchpack/키/ZIP 저장 | 전부 `apps/admin/src/main/i18n.ts`로 ko/en 번역. OS가 그리는 기본 Open/Save/Cancel 버튼 문구는 앱 지정 문자열이 아니므로 별도 처리하지 않음. |
| (가) 네이티브 대화상자 제목·필터 | Launcher 모드 선택 제목·JAR 필터, 종료 실패 메시지와 확인 버튼 | 전부 `apps/launcher/src/main/i18n.ts`로 ko/en 번역. 종료 실패창은 기존 오류 안내창이며 확인 절차는 앱 내 모달을 계속 사용함. |
| (나) main 생성 사용자 상태 | Studio `state.result` 저장·키·배포 결과 및 신규 프로젝트 기본 이름 | 성공 결과는 구조화 코드/값, 표시는 Studio renderer 카탈로그. 새 기본 이름은 main locale로 생성. Studio 오류는 기존 오류 코드/renderer 카탈로그로 처리되어 새 문장 추가 없음. |
| (나) main 생성 사용자 상태 | Launcher `ProductState.error`, `outcome`, `phase`, activity/component와 preference 오류 | 기존 기계 코드·enum 상태를 변경하지 않음. 런처 renderer의 label/catalog가 이를 표시 언어로 번역. 해당 renderer catalog는 다른 작업자 소유라 건드리지 않음. |
| (다) 진단 로그 | 두 main entry의 창 로드 실패 stderr 문장(URL 및 Chromium 오류 코드 포함), 런처 로그 및 게임 stdout/stderr 내용 | 번역하지 않음. 진단/게임 로그이며 자동 수집·분석 가능한 원문을 유지. |
| (라) 앱 이름·창 제목 | `applicationNames`, Studio 고정 제품명/창 제목, 런처 운영자 브랜딩 `appName` 창 제목 | 기록만 하고 번역하지 않음. 제품 식별자와 운영자 입력 문자열임. |

**남은 한국어 하드코딩 위치:** 런타임 번역 원본인 `apps/admin/src/main/i18n.ts`, `apps/launcher/src/main/i18n.ts`의 ko catalog 값만 남았습니다. 테스트의 한국어 기대값/fixture는 테스트 데이터입니다. 사용자 제공 서버 이름·게임 로그는 번역하지 않습니다. 두 entry의 영어 창 로드 오류 로그와 app/product 식별 이름은 위 분류대로 비대상입니다. `apps/launcher/src/renderer/src/i18n/catalog.ts`는 변경하지 않았습니다.

## 검증 결과

환경: WSL Linux x64, Node 24.21.0, `corepack pnpm` 10.34.7, `DISPLAY=:0`. PATH의 Windows `pnpm` shim은 최초 `pnpm --version`에서 WSL vsock 오류를 냈습니다. 저장소 변경 없이 `/tmp/main-i18n-bin/pnpm`을 `corepack pnpm` 래퍼로 만들어 이후 pnpm 명령에 사용했습니다.

- 집중 확인: Studio/Launcher typecheck 통과. main locale 카탈로그, 주입형 native dialog, Studio IPC 신뢰/정확 필드, Launcher parser/IPC 경계, renderer 결과 포매터 테스트 **9 files / 33 passed / 0 failed**.
- `pnpm check`: 성공. Biome 409 files, 43 warnings / 3 infos / 0 errors; 4 TypeScript project typechecks 성공; **112 files passed / 4 skipped, 1,469 tests passed / 9 skipped / 0 failed**; 두 앱 build 성공.
- 별도 `pnpm build`: Studio/Launcher main, preload, renderer production build 성공.
- `DISPLAY=:0 node scripts/smoke.mjs`: Launcher 및 Studio renderer/navigation/IPC/isolation/760px·1100px checks 통과.
- `DISPLAY=:0 node apps/admin/scripts/smoke-functional.mjs`: 통과. 저장 대화상자 영어 제목과 빌드 대화상자 한국어 제목을 가로채 확인, Studio 메시지 상자 0회, settings 및 기존 persistence/layout/isolation 확인.
- `DISPLAY=:0 node apps/admin/scripts/branding-smoke.mjs`: 성공. 실행 중 D-Bus transient-unit 경고가 출력됐으나 PNG/JPEG decode·snapshot·실패 보존 probe 통과.
- `DISPLAY=:0 node apps/launcher/scripts/renderer-functional-smoke.mjs`: 통과. mod/pack 읽기, 저장 설정, 사용량, 삭제 확인, 로그 실패와 앱 내 확인 흐름 통과.
- 최종 수정 파일 Biome 확인: **28 files, no fixes**. `git diff --check`: 통과.

반복 과정에서 초기 집중 테스트의 `.resolves` assertion 형식이 잘못되어 1 test가 실패했으며 동기 IPC handler 기대값으로 수정했습니다. 기능 smoke 첫 실행은 영어로 바꾼 후 한국어 필드를 찾는 검사 실수, 다음 실행은 Electron 종료 직후 Playwright process accessor를 부른 정리 순서 문제로 실패했습니다. 검사 언어 라벨 및 child process handle 정리 순서를 고친 뒤 기능 smoke 전체 성공 로그를 확인했습니다. 숨긴 실패는 없습니다.

## 기준/최종 커밋 및 범위

- 작업 ID: MAIN-I18N-01
- 세션/모델: Codex worker; GPT-6 family (exact runtime variant not exposed); #0 아님
- worktree / branch: `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-2` / `feat/main-i18n`
- 기준 커밋: `2c735d0`
- 구현 커밋: `dca67438b3472e769f5126627dc12737aa7fae79`
- 최종 커밋: 이 인계 파일을 포함하는 후속 handoff 커밋. 정확한 HEAD는 작업자 최종 보고를 참조하세요.
- `git diff --stat 2c735d0...HEAD`: handoff commit 포함 최종 범위 (아래 출력; 값은 staged handoff diff와 동일).

```text
 apps/admin/scripts/smoke-functional.mjs          |  60 ++++++++++----
 apps/admin/src/main/i18n.test.ts                 |  15 ++++
 apps/admin/src/main/i18n.ts                      |  63 ++++++++++++++
 apps/admin/src/main/index.ts                     |  89 ++------------------
 apps/admin/src/main/ipc.test.ts                  |  39 +++++++++
 apps/admin/src/main/ipc.ts                       |  16 ++++
 apps/admin/src/main/native-dialogs.test.ts       |  34 ++++++++
 apps/admin/src/main/native-dialogs.ts            | 101 +++++++++++++++++++++++
 apps/admin/src/main/project.ts                   |   4 +-
 apps/admin/src/main/signing.test.ts              |   4 +-
 apps/admin/src/main/studio.ts                    |  28 +++----
 apps/admin/src/renderer/src/hooks/result.test.ts |  23 ++++++
 apps/admin/src/renderer/src/hooks/result.ts      |  35 ++++++++
 apps/admin/src/renderer/src/hooks/useStudio.ts   |  10 ++-
 apps/admin/src/renderer/src/i18n/catalog.ts      |  29 +++++++
 apps/admin/src/renderer/src/i18n/index.tsx       |   7 ++
 apps/admin/src/shared/studio.ts                  |  19 +++--
 apps/launcher/src/main/i18n.test.ts              |  15 ++++
 apps/launcher/src/main/i18n.ts                   |  26 ++++++
 apps/launcher/src/main/index.ts                  |  29 +++----
 apps/launcher/src/main/native-dialogs.test.ts    |  26 ++++++
 apps/launcher/src/main/native-dialogs.ts         |  32 +++++++
 apps/launcher/src/main/product/ipc.test.ts       |  51 +++++++++++-
 apps/launcher/src/main/product/ipc.ts            |  12 +++
 apps/launcher/src/main/product/service.ts        |   1 +
 apps/launcher/src/renderer/src/i18n/index.tsx    |   7 ++
 apps/launcher/src/shared/product.ts              |  10 +++
 docs/handoffs/MAIN-I18N-01.md                    | 110 +++++++++++++++++++++++
 scripts/smoke.mjs                                |   2 +-
 29 files changed, 757 insertions(+), 140 deletions(-)
```
- main 통합은 수행하지 않았습니다. #0 review/integration pending.

## 한계와 다음 담당자가 알아야 할 점

- 언어는 현재 렌더러 세션의 provider가 처음 동작한 뒤 IPC로 동기화됩니다. 그 전 native UI는 `app.getLocale()` fallback을 씁니다. 언어 선호는 main 쪽에 저장하지 않습니다.
- Studio 결과는 구조화 상태로 바뀌어 렌더러 카탈로그의 키가 표시 계약입니다. 향후 결과를 추가할 때 main에서 문장을 만들지 말고 `StudioResult`와 renderer catalog formatter를 함께 갱신해야 합니다.
- 런처 결과/오류 문구는 현재 renderer catalog가 소유합니다. main code enum을 추가하는 후속 변경 시에는 번역 key 추가가 필요한지 LAUNCHER-EN-01 담당자 또는 #0과 조율하세요.
- 실제 Windows/macOS 네이티브 대화상자는 검증하지 않았습니다. macOS 제품 지원은 기존 결정대로 대상이 아닙니다.
