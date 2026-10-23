# AUTH-SHARE-01 — 인증 공유 패키지 추출 인계

- 세션/모델: Codex 구현 작업자(agent-2) / GPT-6. #0이 아님.
- 작업 ID: AUTH-SHARE-01.
- 브랜치/worktree: `feat/auth-share`, `/mnt/d/Projects/mclauncher/.agents/worktrees/agent-2`.
- 기준 커밋: `9d8f03b` (시작 당시 main, 사용자 승인). 시작 전 coordinator/worker checkout 모두 clean 확인.
- 최초 추출 커밋: `cda8ee30f7cf97a8513bc248750cee191a383616`.
- 최종 구현 커밋: `960dfe8c57ab5da11c8ce2e3baff7bbf90787494` (승인된 게임 검증 도구 참조 수정 포함). main 미통합.
- 최종 인계 커밋은 자기 참조를 피하기 위해 최종 응답과 `git log -1 -- docs/handoffs/AUTH-SHARE-01.md`로 식별.
- 진행/작업 배정 문서와 main은 수정하지 않음. 통합/완료 판정은 #0 소유.

## 승인 및 범위

사용자가 `진행해`로 `packages/desktop-auth` (`@torchlauncher/desktop-auth`) 신설,
package.json/tsconfig, launcher manifest와 lockfile 변경을 승인했다. `packages/*` glob이
이미 있으므로 workspace/루트 설정 변경 없음. 새 외부 의존성을 추가하지 않고 기존
`prismarine-auth@3.1.1`의 소유권만 옮겼다. lockfile은 importer/link만 변경했다.
`scripts/auth-smoke.mjs`의 worker 입력 경로 변경은 별도 사용자 승인을 받았다.

타입 검사/전체 참조 검색에서 범위 밖 참조 2곳을 추가 발견해, 사용자에게 각각 승인받은 뒤
`apps/launcher/src/main/game-smoke/outcome.ts`의 오류 클래스 import 한 줄과
`scripts/game-smoke.mjs`의 worker 입력 경로만 추가 수정했다. 검증 도구 동작 변경은 없다.

## 구현 및 다음 작업자 계약

- 기존 auth 파일 15개(기존 테스트 포함)를 `packages/desktop-auth/src/`로 이동했다.
  기준 커밋과 바이트 단위 비교 결과 15개 모두 동일하다. core 공개 계약도 수정하지 않았다.
- launcher에 남은 파일은 `electron.ts`, `public-java-electron.ts`, `smoke-entry.ts`뿐이다.
  Electron 준비/앱 경로/safeStorage/코드 창/브라우저 연결과 수동 검증 harness를 유지한다.
- 패키지는 Electron을 직접 import하지 않으며 앱 간 import도 없다.
- `createDesktopPublicJavaAuthenticator({ cacheDirectory, safeStorage, workerPath, showCode,
  timeoutMs?, spawn? })`: `PublicJavaAuthenticator` 반환. `login(signal?)`, `refresh(signal?)`,
  `logout()`은 기존과 동일. cacheDirectory, workerPath는 호스트가 주는 절대 경로.
  앱 이름/번역/브라우저 열기는 주입한 `showCode` UI 어댑터가 소유한다.
- `SafeStorageBoundary`, `HostAuthenticationError`, `EncryptedPublicJavaCache`,
  `EncryptedMicrosoftTokenStorage`, `LoopbackAuthenticationBrowser` 등은 패키지 루트에서 export.
  결과 `MinecraftAuthResult`, `AuthenticationError`는 계속 `@torchlauncher/core/auth` 계약이다.
  전체 결과/토큰/장치 코드/원문 오류를 renderer IPC나 로그에 보내면 안 된다.
- 캐시 암호화/키/파일명, Win32 장치 메타데이터, 공개 Java title, 비공개 worker 메시지,
  검증/정화/취소/로그아웃/저장 완료 장벽을 변경하지 않았다. 세션은 앱별 userData로 격리한다.
- WSL 등 안전한 키링이 없으면 현재 launcher와 동일하게 `secure_storage_unavailable`로 거부.
  평문/메모리 전용 로그인 우회는 추가하지 않는다. 키링이 잠겨도 logout 암호문 삭제는 유지.

## Studio 연결 및 번들

`packages/desktop-auth/examples/studio-main.ts`가 launcher import 없이 Studio 호스트를
주입받는 최소 예제다. TESTRUN-MAIN-01은 Studio manifest에 workspace 의존성 추가,
Studio 전용 userData, single-instance lock, app.whenReady 이후 safeStorage 연결과
코드 창/고정 Microsoft 브라우저 어댑터, 상태/IPC/i18n 연결을 담당한다.

`@torchlauncher/desktop-auth/worker`는 build entry 전용 export다. 앱 main build에서
`fileURLToPath(import.meta.resolve('@torchlauncher/desktop-auth/worker'))`를
`public-java-worker` lib entry로 넣고 `externalizeDeps: false`, CJS 출력과
`[name].cjs` 파일명을 사용한다. worker와 함께 나오는 모든 청크를 같이 패키징해야 한다.
workerPath는 앱 out/main의 `public-java-worker.cjs`로 주입한다. launcher 설정에 적용했고,
Studio 예제와 worker를 standalone 임시 디렉터리로 번들·복사한 후 실제 Node 자식의
3.1.1 self-check가 통과하는 테스트를 추가했다.

Studio가 실제 dependency를 번들할 때 기존 `third-party/prismarine-auth/NOTICE.txt`도
main output에 emit해야 한다(launcher는 기존 동작 유지). 정확한 설정 예제/보안 경계는
`packages/desktop-auth/README.md`에 있다. 이 작업에서는 Studio 제품 파일을 수정하지 않는다.

## 실행한 검증과 결과

환경: Linux/WSL, Node `v24.21.0`, pnpm `10.34.7`, DISPLAY `:0`.
검증용 pnpm은 `/tmp/auth-share-tools/node_modules/.bin`에 설치했다. 기존 기본 npm cache가
sandbox에서 읽기 전용이어서 최초 설치는 EROFS, escalation 재실행 성공.
worktree만 의존성을 재설치했고 coordinator checkout 의존성은 수정하지 않았다.
Electron 바이너리는 `ELECTRON_OVERRIDE_DIST_PATH=/mnt/d/Projects/mclauncher/node_modules/electron/dist`
(실제 버전 44.9.1)로 읽기 전용 재사용했다. 재개 시 환경/경로를 다시 확인할 것.

- `CI=true PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm install --frozen-lockfile --store-dir /tmp/auth-share-pnpm-store`:
  성공, 5 workspace, lockfile up-to-date, 374 packages 설치. 최초 비TTY 실행은 모듈 재생성 확인에서
  중단됐고 CI=true 재실행으로 성공했다.
- `pnpm exec vitest run packages/desktop-auth packages/core/src/auth`: 최종 **8 파일 / 167 통과 / 0 실패 / 0 skip**.
  최초 실행은 166 통과/1 실패(새 저장소 격리 테스트가 이전 worker를 기다리던 timeout).
  새 worker 개수까지 기다리도록 테스트를 수정해 단독 1/1과 인증 전체 167/167을 재검증했다.
- 최초 `pnpm typecheck`: 실패. 공유 패키지/core/Studio는 통과했으나 launcher game-smoke/outcome.ts의
  이동된 errors 참조 때문에 TS2307 및 파생 TS18046 2건. 승인 후 import 수정으로 해결했고,
  최종 pnpm check의 전체 TypeScript 단계는 통과했다.
- `pnpm lint`: 성공, 358 파일, 기존 37 warnings / 3 infos. 범위 내 Biome 별도 성공.
- `pnpm build`: 두 앱 성공. launcher main index/worker와 prismarine-auth 및 protocol/metadata 청크,
  기존 dependency notice가 함께 출력됨.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=... node scripts/smoke.mjs`: **두 앱 성공 / 실패 0**.
  renderer/navigation/IPC/isolation과 760/1100px 검사. 실제 로그인/게임 검증 아님.
- `ELECTRON_OVERRIDE_DIST_PATH=... node scripts/auth-smoke.mjs worker-check --data-dir /tmp/torchlauncher-auth-share-smoke`:
  성공, libraryVersion 3.1.1, liveAuthentication false/not-asserted.
- `node --check scripts/auth-smoke.mjs`, `git diff --check`: 성공.
- 최초 `pnpm check` (`PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH`, 로그 `/tmp/auth-share-check.log`):
  **실패(exit 2)**. Biome 통과 후 launcher 타입 검사에서 위 TS2307 1건 + 파생 TS18046 2건으로
  중단. 따라서 이 명령의 전체 test/build 단계는 미실행이며 별도로 실행한 인증 테스트/두 앱
  빌드 성공과 구분한다. 사용자 승인 후 원인 import를 수정했다. 최종 재검증 결과는 아래에 기록한다.
- `DISPLAY=:0 ELECTRON_OVERRIDE_DIST_PATH=... node scripts/auth-smoke.mjs reject-basic --data-dir /tmp/torchlauncher-auth-share-smoke`:
  성공, 실제 Electron/Linux `plaintextRejected: true`, liveAuthentication false.
- `ELECTRON_RUN_AS_NODE=1 /mnt/d/Projects/mclauncher/node_modules/electron/dist/electron /tmp/auth-share-worker-check.mjs /mnt/d/Projects/mclauncher/.agents/worktrees/agent-2/apps/launcher/out/main`:
  성공, productionWorker/standalone true, Electron 44.9.1, libraryVersion 3.1.1,
  liveAuthentication false. `/tmp` 검증 스크립트는 빌드된 main 디렉터리를 node_modules 없는
  새 디렉터리로 복사하고 self-check IPC만 실행한 뒤 자식을 kill/reap하고 임시 복사본을 삭제했다.

- 최종 `PATH=/tmp/auth-share-tools/node_modules/.bin:$PATH pnpm check`:
  **성공(exit 0)**. Biome 358 파일(기존 37 warnings / 3 infos), 전체 TypeScript,
  Vitest **91 파일 통과 / 4 파일 skip, 1300 테스트 통과 / 9 skip / 0 실패**, 두 앱 빌드 성공.
  skip은 기존 live opt-in/플랫폼 조건 테스트이며 이번 인증 테스트는 전부 실행했다.
  로그 `/tmp/auth-share-check-final.log`. 사용자 범위 승인 이후 최종 구현 상태에서 실행했다.
- `node --check scripts/game-smoke.mjs`, 변경 2개 파일 Biome, `git diff --check`: 성공.
- Vite 임시 game-smoke 번들 검사: 실제 `apps/launcher/src/main/game-smoke/entry.ts`와
  이동된 worker 입력을 기존 smoke와 같은 SSR/noExternal/Electron external/CJS 설정으로
  번들, **2 진입점 출력 확인 / 실패 0**. 임시 출력은 제거했다. 실제 게임은 실행하지 않았다.

## 미실행/한계/실계정 수동 확인

실제 Microsoft 계정 로그인/재시작 후 refresh/로그아웃 cycle, 실제 OS 키링 암호화 성공,
Windows 네이티브 실행/패키징과 인증된 게임 실행은 미실행이다. 계정/키링/Windows 환경이
필요하다. Studio 실제 연결도 TESTRUN-MAIN-01 후속 범위다. 합성 AES-GCM 경계와 self-check를
실계정/OS 안전 저장 성공 증거로 취급하지 않는다.

안전한 키링이 있는 Windows/Linux에서 Node 24, pnpm 10.34.7로:

```text
pnpm install --frozen-lockfile
node scripts/auth-smoke.mjs worker-check --data-dir <앱 외부의 전용 인증 검증 디렉터리>
node scripts/auth-smoke.mjs probe --data-dir <동일 디렉터리>
node scripts/auth-smoke.mjs storage-cycle --data-dir <동일 디렉터리>
node scripts/auth-smoke.mjs cycle --data-dir <동일 디렉터리>
```

브라우저 로그인은 사용자가 직접 수행한다. cycle은 login/새 프로세스 refresh/logout/빈 캐시를
확인하며 전부 성공한 경우에만 verified를 출력한다. 중단 시 같은 디렉터리로 logout,
assert-empty를 실행한다. 출력 공유는 정화된 성공/오류 코드만으로 제한한다.
Studio 연결 후 각 앱에서 별도로 로그인하고, 한 앱 logout이 다른 앱 세션을 삭제하지 않는지
직접 확인한다. 장치 코드/토큰/계정 정보/비공개 URL은 인계나 로그에 기록하지 않는다.

## 범위 확인과 다음 작업

`git diff --stat 9d8f03b...HEAD`로 확인하는 최종 범위는 **33개 파일**이다.
기존 auth 15개는 100% rename(내용 동일), 새 package 파일 8개, launcher의 기존 어댑터 3개와
manifest/worker build 설정, game-smoke 오류 import, auth/game smoke worker 경로, lockfile
importer, 이 인계 문서다. core/Studio 제품/main/진행/배정 문서와 루트 설정은 수정하지 않았다.
최종 인계 커밋 후 위 명령을 다시 실행해 확인하고 최종 응답에 통계와 커밋을 기록한다.

범위 추가 승인을 받은 뒤 아래 두 참조를 수정했고, 별도 구문/Biome/게임 검증 도구 번들 검사를
통과했다.

1. `apps/launcher/src/main/game-smoke/outcome.ts`:
   `HostAuthenticationError`를 `@torchlauncher/desktop-auth`에서 가져온다.
2. `scripts/game-smoke.mjs`의 `public-java-worker` 입력:
   `packages/desktop-auth/src/public-java-worker.ts`로 바꿨다.

#0은 이 브랜치를 검토하고 통합 후 통합 기준에서 필요한 검증을 실행한다.
TESTRUN-MAIN-01은 위 API/번들 설명에 따라 Studio에 연결한다. 실제 계정 검증과 Windows 확인은
별도 사용자 수동 확인 범위다. main 통합/진행 문서 수정/완료 판정은 이 작업자가 하지 않았다.

이 인계 시점에 모든 검증 명령은 종료됐고 남겨 둔 worker/Electron/개발 서버는 없다.
인증 smoke 디렉터리는 `/tmp/torchlauncher-auth-share-smoke`이며 worker-check/reject-basic만
실행했으므로 실제 계정 자료는 없다. 임시 도구/검증 로그는 환경별 자료이므로 재개 시 존재와
버전을 확인한다. 전체 작업의 통합/완료 판단은 #0이 한다.
