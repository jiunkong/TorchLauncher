# LAUNCHER-L2B — 세션·복구 자동화와 로그 출처 구분

- 세션: `launcher develop #3`
- 브랜치: `feat/launcher-l2b-automation`, 기준 커밋 `7d3d380` (main). 최종 커밋은 최종 보고에 기재.
- 범위: 런처 메인 프로세스와 상태 계약만. `packages/core`, 렌더러 페이지 재작성, Studio, 인증 방식, manifest/lockfile 변경 없음.

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `apps/launcher/src/shared/product.ts` | `ProductLogEntry` 추가, `logs` 타입 변경 |
| `apps/launcher/src/main/product/service.ts` | `checkEnvironment`(점검+안전한 자동 복구), 시작/플레이 시 호출, 런처 로그 기록, 로그 출처 분리 |
| `apps/launcher/src/main/product/service-automation.test.ts` (신규) | 시나리오 테스트 8개 |
| `apps/launcher/src/renderer/src/pages/Pages.tsx` | 로그 표시를 `entry.text`로 바꾼 최소 수정(컴파일·동작 유지) |

## 상태 계약 변경

```ts
// 전
logs: string[];
// 후
export interface ProductLogEntry { source: 'launcher' | 'game'; text: string }
logs: ProductLogEntry[];
```

그 외 필드·명령(`refresh`, `inspect`, `recover` 포함)은 그대로다. 새 필드 없음.
`logs`는 `[런처 항목(최대 200), 게임 항목(최대 300)]` 순서로 이어 붙인다(시간 순 인터리브가 아니다. 출처별 필터는 렌더러가 한다).
게임 항목은 게임 실행마다 해당 실행의 로그로 교체된다. 데이터 삭제 시 둘 다 비운다.

## 자동 복구 결정표 (`checkEnvironment`)

호출 시점: 앱 시작(`restoreSession`에서 세션 복원 전), 매 `launch` 시작(`ensure` 전), `inspect` 명령(내부용; UI 불필요).

| 코어 판정 | 동작 | `state.recovery` | 플레이 |
| --- | --- | --- | --- |
| 서버 루트 없음 | 없음 | `null` | 진행 |
| 잠금 `free`, 할 일 없음 | 없음 | `null` | 진행 |
| 잠금 `free`/`stale-verified` + 검증된 설치/동기화/사용자 모드 중단 | `recoverServerEnvironment(acceptUncertain:false)` 자동 실행, launcher 로그 기록 | 성공(복구 필요 없음)이면 `null`. 남은 문제가 있으면 `needed:true`와 코어 `issues` 코드 | 남은 문제 없으면 진행, 있으면 `recovery-required` |
| 잠금 `uncertain` | 아무것도 하지 않음 | `{needed:true, lock:'uncertain', confirmable, issues:['lock-uncertain']}` | `recovery-required`. 사용자가 확인하면 기존 `recover {acceptUncertain:true}` (호스트 확인 창 후 실행) |
| 설치/동기화/사용자 모드 `invalid` (잠금 무관) | 아무것도 하지 않음(코어도 invalid는 건드리지 않음) | `needed:true`, `confirmable`은 잠금 기준(보통 false), `issues`에 `install-invalid` 등 | `recovery-required` |
| 잠금 `held-live` | 복구하지 않음 | `{needed:false 또는 true, lock:'held-live', confirmable:false}` | 기존대로 `ensure`가 `locked` (실행 중/다른 인스턴스). 확인 복구도 코어가 거부 |

- 분리 실행(LAUNCH-EXIT-01)된 게임이 살아 있으면 `held-live`이므로 잠금은 유지되고, 종료 후 기존 `recoverExitedGameLock`(`ensure`)과 이번 점검이 안전하게 회수한다.
- 복구 중 취소는 같은 작업 큐의 signal을 코어에 전달하며 `cancelled`로 끝난다. 새 삭제 로직은 없고 GAME-05 보장을 그대로 쓴다.
- 모호한 경우는 보수적으로: 자동 복구는 `free`/`stale-verified`이면서 `invalid` 항목이 하나도 없을 때만 실행한다(invalid가 섞여 있으면 유효한 부분도 자동으로 건드리지 않고 사용자에게 알린다).
- 다른 관리 명령(`mods` 등)은 여전히 잠금이 남아 있으면 `locked`로 실패한다(시작 시 점검이 먼저 회수한다).

## 세션

- 시작 시 `refresh`(저장 세션 조용한 복원); `no_session`은 오류 표시 없이 로그인 필요 홈. 플레이 중 인증 단계(`authenticate`)가 항상 `refresh`로 토큰을 갱신하고, 실패하면 `account:null`과 오류 코드(`no_session`/`reauthentication_required`)를 유지해 렌더러가 로그인 필요로 표시한다. 두 코드면 어느 경로에서든 `account`를 비운다.
- `refresh` 명령은 내부용으로 유지. 로그아웃은 기존 `host.auth.logout()` 위임 그대로이며 상태에 계정 데이터가 남지 않는다(테스트).

## 로그 출처 규칙

- `launcher`: 고정 코드 문자열만(`session: ready`, `launch: <phase>`, `recovery: automatic recovered`, `<command>: failed <오류코드>`, `game: exited-0` 등). 토큰·계정·URL·경로 없음. 시작 시 `no_session`은 기록하지 않는다.
- `game`: 코어가 마스킹한 게임 출력에 URL을 `[URL]`로 바꾸고 제어 문자를 제거(기존 처리), 최대 300줄.

## 검증 (Linux, WSL2)

- `vitest run apps/launcher/src/main/product`: 55 passed(신규 8개: 시작 시 stale 자동 복구, 플레이 시 복구 후 진행, uncertain 차단→확인 후 진행, 자식 생존 시 확인에도 거부(파일 불변), invalid journal 비삭제, 복구/실행 중 취소, 세션 만료 시 로그인 필요, 로그 출처·마스킹·로그아웃 후 잔존물 없음).
- 시나리오는 실제 `lock.ts`/`recovery`를 호출하고(시스템 probe, 죽은 pid/살아 있는 현재 프로세스 식별), 게임 실행만 mock이다.
- `CI=true pnpm check` 통과, `renderer-functional-smoke.mjs`, `scripts/smoke.mjs` 통과.

## 미검증

- Windows 실제 비정상 종료 후 시작 시 자동 복구(Windows probe는 코어 단위 테스트뿐).
- 실제 로그인·서버·게임 실행.

## L2a가 알아야 할 점

- 로그 페이지: `state.logs`를 `source`로 필터하면 된다. 현재 `Pages.tsx`는 임시로 `text`만 이어 붙여 표시한다.
- "문제 해결"의 세션/복구 버튼은 더는 필요 없다. 복구 확인 창은 `state.recovery?.needed && state.recovery.confirmable`일 때만 띄우고, 확인 시 `{type:'recover', acceptUncertain:true}`를 보낸다(호스트가 네이티브 확인을 한 번 더 요청한다. 이중 확인이 부담이면 #0과 `confirmRecovery` 정책 조정). `confirmable:false`인데 `needed`면 자동 해결이 불가능하므로 `issues`로 안내만 한다.
- `launch`가 `recovery-required`로 끝나면 위 창을 띄운다. `locked`는 게임/다른 런처 실행 중이다.
- 앱 시작 직후에는 점검→세션 복원 순서로 두 작업이 실행되며 그동안 명령은 `busy`일 수 있다.
