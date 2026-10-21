# GAME-05 — 중단된 설치 잠금·저널 검증, 크래시 복구 API, 강제 종료 검증

- 세션: `launcher develop #3`
- 브랜치/worktree: `feat/game-05-recovery` / `.agents/worktrees/agent-3`
- 기준 커밋: `52dcf6f` (main)
- 범위: 코어만. UI/IPC 연결, 상위 export(`packages/core/src/index.ts`, `minecraft/index.ts`) 연결 없음.
- macOS 미지원(사용자 결정): macOS 프로세스 식별 조회는 구현하지 않았고 항상 `unknown`으로 폴백한다(자동 회수 없음, `uncertain`).

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/minecraft/identity.ts` (신규) | `ProcessProbe` 경계, Linux/Windows 시스템 조회, 파서 |
| `packages/core/src/minecraft/lock.ts` | owner.json v2, `recordChild`, `readLockOwner`/`parseLockOwner`, `reclaimServerDataLock`, `ServerDataLockedError`에 구조 정보 |
| `packages/core/src/minecraft/install-transaction.ts` (신규) | 설치 journal 쓰기·commit/rollback을 installer에서 분리(동작 동일), `InstallRollbackError` |
| `packages/core/src/minecraft/installer.ts` | 위 모듈 사용으로 교체(journal 형식·순서 불변) |
| `packages/core/src/minecraft/process.ts` | `processProbe` 옵션, spawn 직전 `child: starting`, spawn 후 Java pid/시작 식별자 기록 |
| `packages/core/src/minecraft/recovery/{lock-assessment,install,environment,index}.ts` (신규) | 판정·복구 API. `index.ts`는 만들었으나 상위 export 미연결 |
| `packages/core/src/minecraft/identity.test.ts`, `recovery/recovery.test.ts`, `recovery/kill.test.ts` (신규) | 단위·실제 프로세스 SIGKILL 테스트 |

`packages/core/src/instance/data/marker.ts`는 **수정하지 않았다.** v2도 `purpose`/`pid` 필드를 유지하고 4 KiB 이하라
`inspectServerDataLock`이 그대로 읽는다(테스트로 확인). sync/mods 내부, manifest, lockfile, export, 인증 코드 변경 없음.

## 공개 API (`packages/core/src/minecraft/recovery/index.ts`)

```ts
inspectServerEnvironment(root, { probe? }): Promise<ServerEnvironmentInspection>   // 부작용 없음
recoverServerEnvironment(root, { serverId?, acceptUncertain?, probe?, signal? }): Promise<ServerRecoveryReport>
```

`ServerEnvironmentInspection`: `{ root, serverLock, install, synchronization, userMods, needsRecovery }`
(루트가 없거나 일반 디렉터리가 아니면 throw).

### 서버 잠금 `serverLock: { state, purpose?, evidence[], childAlive, confirmable }`

| state | 의미 | 자동 회수 | `acceptUncertain` |
| --- | --- | --- | --- |
| `free` | 잠금 없음 | — | — |
| `held-live` | 주인 또는 기록된 자식 Java가 살아 있음(같은 프로세스가 보유한 경우 포함) | 거부 | 거부 |
| `stale-verified` | 같은 머신에서 주인과 기록된 자식이 모두 종료/PID 재사용 확인 | 회수 | — |
| `uncertain` | 식별 불가·모호 | 거부 | `confirmable`이면 회수(살아 있는 자식 확인 시 거부) |

`evidence` 코드: `owner-alive`, `owner-exited`, `owner-pid-reused`, `owner-state-unknown`, `child-alive`, `child-exited`,
`child-pid-reused`, `child-state-unknown`, `child-unrecorded`(spawn 직전 충돌), `host-different`, `host-unknown`,
`owner-v1`, `owner-missing`, `owner-invalid`, `lock-unsafe`(symlink/비디렉터리; 확인해도 회수하지 않음),
`loader-installer-alive`, `loader-installer-unverified`(아래 로더 staging 잠금).

### 설치 transaction `install: { state, phase?, operations?, reason? }`

| state | 의미 / 복구 |
| --- | --- |
| `none` | `.torchlauncher-install-lock` 없음 |
| `rollback-needed` | `phase: 'staging'`(journal 전 중단: staging 폐기) 또는 `'publishing'`(일부 게시: 역순 복원) |
| `complete-needed` | 모든 operation이 게시됨(정리 전 중단): 기록된 backup만 삭제 |
| `invalid` | `reason`: `lock-unsafe`, `unexpected-entry`, `journal-invalid`, `journal-root-mismatch`, `unsafe-path`, `inconsistent-state`. 아무것도 건드리지 않음 |

`synchronization`, `userMods`: `none | present | invalid` (`.torchlauncher-sync`의 journal/pending/transaction 존재,
`readIntent` 결과).

### 복구 결과 `ServerRecoveryReport: { status, actions[], issues[], environment }`

- `status`: `clean`(할 일 없음), `recovered`, `blocked`(잠금을 얻지 못함, 아무것도 변경 안 함), `incomplete`(남은 문제 있음).
- `actions[].kind`: `server-lock-reclaimed`(`basis: verified | user-confirmed`), `install-staging-discarded`,
  `install-rolled-back`, `install-completed`(`operations`), `synchronization-recovered`(`result`),
  `user-mods-recovered`(`outcome`, `temporaryRemoved`).
- `issues[].code`(UI 사유 코드, `detail`은 errno/하위 오류 코드만): `lock-held-live`, `lock-uncertain`(→ 사용자 확인 후
  `acceptUncertain: true`로 재호출), `lock-child-alive`, `lock-unsafe`, `lock-contended`, `lock-release-failed`,
  `install-invalid`, `install-recovery-failed`, `server-id-required`, `synchronization-invalid`,
  `synchronization-recovery-failed`, `user-mods-invalid`, `user-mods-recovery-failed`, `aborted`.
- `environment`: 복구 후 다시 검사한 결과.

### 기존 진입점 오류

설치·실행·동기화·삭제는 기존처럼 `ServerDataLockedError`(메시지·클래스 동일)로 실패한다. 추가 필드:
`code: 'locked'`, `recovery: 'inspect-server-environment'`, `root`. 기존 호출자 변경 불필요. 게임 실행의
`GameStartError('EINSTALLRECOVERY')`도 그대로이며, UI는 이 두 경우에 `inspectServerEnvironment(root)`로 안내하면 된다.

## 소유자 식별 (owner.json v2)

```json
{"version":2,"id":"<uuid>","pid":123,"purpose":"game","start":"<opaque|null>","host":{"machine":"<sha256|null>"},
 "child":null | {"state":"starting"} | {"state":"running","pid":456,"start":"<opaque|null>"}}
```

- 인자·환경·계정·경로·호스트명은 기록하지 않는다. machine은 OS 머신 ID의 SHA-256(접두 문자열 포함)이다.
- 갱신(`recordChild`)은 같은 디렉터리의 임시 파일 `wx` 작성 후 `rename`으로 원자 교체하고, 이전 내용이 자신의
  기록과 같은지 확인한다. release와 직렬화된다. v1 파일은 읽기 호환(항상 `uncertain`).
- 게임 실행: spawn 직전 `child: starting`, spawn 후 `running`(조회 실패 시 `start: null`→ 이후 `uncertain`).

| OS | 프로세스 시작 식별자 | 머신 식별자 | 상태 |
| --- | --- | --- | --- |
| Linux | `/proc/<pid>/stat` 22번째 필드(부팅 이후 tick) + `/proc/sys/kernel/random/boot_id`. `ENOENT`=absent, Z/X 상태=종료 | `/etc/machine-id`(없으면 `/var/lib/dbus/machine-id`) | 실제 프로세스로 검증 |
| Windows | `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command`의 고정 스크립트(검증된 정수 pid만 삽입): `Get-Process` 없음/HasExited=absent, 그 외 `StartTime` UTC ticks | `System32\reg.exe query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` | 주입 실행기 단위 테스트만 |
| macOS·기타 | 미지원 → `unknown` | `null` | 사용자 결정 |

조회는 shell 없이 `execFile`(15초 timeout, 64 KiB 출력 제한)이며 모든 실패는 `unknown`이다. 머신 ID와 현재
프로세스 식별자는 프로세스당 1회 캐시한다. `ProcessProbe`는 `acquireServerDataLock(root, purpose, { probe })`,
`GameProcessOptions.processProbe`, 복구 API의 `probe`로 주입한다.

## 안전 설계

- 자동 회수 조건: owner v2이고 머신 ID가 양쪽에서 확인되어 같으며, 주인 pid가 없거나(absent) 시작 식별자가 다르고,
  기록된 자식도 같은 기준으로 종료가 확인될 때만. 시작 식별자가 어느 쪽이든 미상이면 `uncertain`. age는 사용하지 않는다.
  Linux 식별자는 boot_id를 포함하므로 재부팅 후 같은 pid·tick이 나와도 일치하지 않는다(재부팅 = 이전 프로세스 종료 증거).
- 로더 설치(`loaders/installer.ts`)의 공식 설치 Java는 서버 잠금이 아니라 `.torchlauncher-loaders/.stage-<uuid>` 의
  자체 잠금에 자식으로 기록된다. 그래서 서버 잠금이 `stale-verified`/`uncertain`이면 모든 stage 잠금도 같은 기준으로 검사한다:
  살아 있으면 `held-live`(`loader-installer-alive`, 확인 회수도 거부), 미상이면 `uncertain`(`loader-installer-unverified`).
  stage 디렉터리(64개 초과 시 미상 처리)는 로더 소유이므로 복구가 정리하지 않는다.
- 주인 pid가 현재 프로세스와 같으면(식별 미상 포함) `held-live`로 보고 확인 회수도 막는다.
- 회수는 잠금 디렉터리를 지우지 않고 그 자리에서 소유권을 넘긴다: 기존 owner.json을 고유 이름으로 `rename`(동시
  회수자 중 하나만 성공) → 내용이 검사 시점과 같은지 비교(다르면 `link`로 복원 후 `lock-contended`) → 새 maintenance
  owner를 `wx`로 작성. 따라서 복구 중 새 호스트가 잠금을 얻을 수 없다.
- 설치 journal: 정확한 키 집합, `root`가 현재 루트와 동일, 64 MiB/250,000개 상한. target은 루트 내부이며
  `.torchlauncher*` 최상위 예약 경로 금지, staged는 `<lock>/staging/<uuid|runtime>`, backup은 `<lock>/backups/<uuid>`만,
  중복 금지. target 상위 경로는 루트부터 lstat으로 검사(symlink 거부), 파일은 일반 파일·`runtime`은 디렉터리여야 한다.
  잠금 디렉터리 안에 예상 외 항목이 있거나 operation 상태가 commit/rollback 루프로 도달 불가능한 조합이면 `invalid`로 두고
  아무것도 바꾸지 않는다(수동 복구). journal은 경로 삭제 지시가 아니라 상태 검증 대상이다.
- 복구 규칙(GAME-01): backup이 있으면 원본이 옮겨진 것 → 게시된 대체물 제거 후 backup을 원래 위치로 rename. 원래 없던
  대상은 staged가 사라지고 대상이 있으면 게시된 것 → 제거. 역순 실행. 모두 게시된 경우만 `complete`(backup 삭제).
- 첫 변경 전에 방향(`recovery.json`: rollback/complete)을 `wx`로 기록하고, 각 단계는 파일 시스템 상태에서 다시 계산되는
  멱등 단계라 중간 SIGKILL 후 재실행으로 이어진다. journal은 모든 복원 뒤 마지막에 삭제한다.
- 재귀 삭제 대상은 검증된 installer 소유 `runtime` 트리(게시된 target/backup/staged)뿐이며 `rm`은 링크를 따라가지 않는다.
- 하드링크: installer 파일에 대해 nlink는 검사하지 않는다(unlink는 이름만 제거하므로 다른 이름의 내용은 보존).
- 남은 간극(보수적으로 문서화): `recoverSynchronization`·`recoverUserMods`는 자체 maintenance 잠금을 얻으므로 설치 복구
  잠금을 놓은 뒤 순차 호출한다. 그 사이 다른 호출자가 잠금을 잡으면 `lock-contended`로 보고하고 재시도하면 된다.
  게임 실행은 기존 sync 가드가 미해결 transaction을 막는다. 잠금을 넘겨받는 locked 변형이 필요하면 SYNC/USER 담당에 요청.
- 복구 rollback 중 runtime 디렉터리 부분 삭제 상태는 "게시됨"과 구분할 수 없다. 이 경우는 installer 내부 rollback 도중의
  크래시에서만 생기며, 방향은 뒤쪽 metadata operation 상태로 rollback으로 결정되므로 backup 복원으로 끝난다.
- 같은 서버 루트를 여러 머신이 공유하는 경우, 머신 ID 불일치는 `uncertain`이다(사용자 확인 필요).

## 검증 (Linux, WSL2 6.18, Node 24.21.0)

- `vitest run packages/core/src/minecraft/recovery packages/core/src/minecraft/identity.test.ts`: 통과
  (recovery 27개, kill 4개, identity 8개).
- `vitest run packages/core`: 619 passed / 7 skipped(기존 live 테스트), 마지막 변경 후 8회 연속 반복 모두 통과.
  초기에 병렬 부하에서 kill 테스트가 5초 기본 timeout을 넘는 경우가 있어 해당 suite에 60초 timeout을 지정했다. 그 전 한 번
  `keeps the lock...` 테스트가 568ms에 실패했으나 원인 출력을 확보하지 못했고 이후 단독 3회·전체 11회 재현되지 않았다
  (환경성 flake 가능성, 재발 시 출력 확인 필요).
- `tsc -p packages/core/tsconfig.json`: 통과. `biome check packages/core/src/minecraft`: 통과.
- 최종 `pnpm check`(Biome 179 files, 전체 TypeScript, Vitest 697 passed / 7 skipped, 두 앱 build): 통과(exit 0).
  이 worktree에서는 launcher typecheck 환경 문제 없음.

실제 프로세스 시나리오(`recovery/kill.test.ts`, Linux만): Node 타입 제거로 실제 `lock.ts`/`install-transaction.ts`/
`recovery/*`를 실행하는 합성 호스트를 SIGKILL.
1. 호스트가 게임 잠금을 잡고 자식 프로세스를 기록한 뒤 SIGKILL → 자식 생존 시 `held-live`, `acceptUncertain`에도 거부.
   자식 종료 후 `stale-verified` → 자동 회수 → `free`.
2. 살아 있는 프로세스의 pid + 다른 시작 식별자 → `owner-pid-reused`/`stale-verified`; 같은 식별자 → `held-live`;
   v1 → `uncertain` 및 확인 없이 `blocked`.
3. 실제 `publishInstallOperations` 중 1~4번째 rename 직후 SIGKILL → 원본으로 rollback; 5번째(전부 게시) 후 → complete.
4. 복구 자체를 1~6번째 단계 직후 SIGKILL → 재실행으로 완료(원본 복원, 잠금·transaction 제거, `needsRecovery: false`).

단위: owner v2 기록/원자 갱신/USER-03 `inspectServerDataLock` 호환, 12개 판정 케이스, 로더 stage 잠금 검사, CAS 회수 실패 시 owner 복원,
symlink 잠금 거부, 경로 탈출/예약 경로/외부 staged·backup/예상 외 항목/root 불일치/symlink 상위 경로 journal 무변경,
journal 전 staging 폐기, sync/user-mod 잔여 보고 및 `server-id-required`, 실행 중 게임 자식 기록 후 종료 시 해제.

## 미검증

- Windows 실제 프로세스 조회·강제 종료(PowerShell/reg 출력, 권한 거부, 속도). 주입 실행기 단위 테스트만 있다.
- macOS: 미지원(사용자 결정).
- 전원 차단·파일 시스템 내구성(fsync 없음), 실제 installer 전체(다운로드 포함) 실행 중 kill, 실제 NeoForge 설치 Java 실행 중 kill
  (stage 잠금 검사는 단위 테스트만), sync/user-mod 복구와 결합한 실제 kill 시나리오.

## #0 연결 지점

1. `packages/core/src/minecraft/index.ts` 또는 desktop export에 `./recovery` 공개(현재 미연결).
2. launcher main: 설치/실행/동기화/삭제가 `ServerDataLockedError`(`recovery === 'inspect-server-environment'`) 또는
   `GameStartError('EINSTALLRECOVERY')`로 실패하면 `inspectServerEnvironment` → `recoverServerEnvironment(root, { serverId })`.
   `issues`에 `lock-uncertain`이 있고 `environment.serverLock.confirmable`이면 "게임/런처가 실행 중이 아님을 확인했나요?"
   확인 후 `acceptUncertain: true`로 재호출. 앱 시작 시 1회 자동 검사를 권장.
3. 로더 설치의 `runInstallerJava`는 stage 루트 잠금에 자식을 기록하며 복구 판정이 이를 검사한다(위). 더 단순하게 하려면
   로더 담당이 서버 루트 install lease의 `recordChild`에도 설치 Java를 기록하도록 할 수 있다(선택, `loaders/` 범위 밖이라 미변경).
4. 요청(선택): SYNC/USER 담당에 이미 보유한 maintenance lease로 실행하는 `recoverSynchronization`/`recoverUserMods` 변형.
