# LAUNCHER-UI-L2A — 내 모드 · 설정 · 로그 페이지, 확인 창, 실제 순서의 진행 패널

- 세션: `launcher develop #1`
- 브랜치: `feat/launcher-l2a-pages`, 기준 커밋 `e2255de` (main). 최종 커밋은 최종 보고에 기재.
- 범위: 런처 렌더러 + 허가된 main 변경(네이티브 확인 호출 제거). IPC 계약·preload·core·Studio·manifest·lockfile 변경 없음.

## 변경 파일

| 구분 | 파일 |
| --- | --- |
| 신규 | `pages/{Mods,Settings,Logs,PageFrame}.tsx`, `pages/packs.ts`, `components/{Modal,DeleteDialog,RecoveryDialog,ProgressBar}.tsx`, `hooks/useStage.ts`, `format.ts`, `i18n/translate.ts`, `pages.test.ts` |
| 수정 | `App.tsx`, `pages/Home.tsx`, `components/{StopDialog,Icons}.tsx`, `activity.ts`(+test), `labels.ts`, `i18n/catalog.ts`, `styles.css`, `shell.test.ts`, `scripts/renderer-functional-smoke.mjs` |
| 삭제 | `pages/Pages.tsx`, `components/{LegacyPage,EmptyState,ActivityProgressBar}.tsx`, `hooks/useSeenSteps.ts`, 레거시 페이지 CSS |
| main | `main/product/service.ts`(호스트 `confirmRecovery`·`confirmDeletion` 제거, `delete`는 코어 확인 토큰만 검사), `main/index.ts`(두 네이티브 `showMessageBox` 제거), 관련 테스트 |

## 동작 요약

- 모든 사용자 문구는 사전 키(`labels.ts`, `activity.ts`의 인라인 한국어 포함). 영어 값은 임시로 한국어 복사(기존 `common.*`·`launcher.*`만 영어). 서버 이름·파일명·경로·로그 원문은 번역하지 않음.
- 확인 창은 공용 `Modal`(포커스 트랩, Escape 취소, 초점 복원). 앱 셸은 창이 열려 있으면 `inert`. 창 상태는 App이 가진다(페이지 `contain: paint` 안에서는 `position: fixed`가 깨지므로).
- 서버 데이터 삭제: 설정의 버튼 → `preview-delete` → 확인 창(`state.deletion`) → `delete {confirmation}`. 삭제 버튼은 `deletable`이고 토큰이 있을 때만 활성. `usage`가 호출되면 메인이 미리보기를 무효화하므로 설정 진입 시 `packs` → `usage` 순서로만 조회한다. 만료·무효 토큰 오류는 기존 `failureMessage`로 표시.
- **네이티브 확인 제거(#0 지시):** 복구와 삭제 모두 앱 안 창이 유일한 사용자 확인이다. 유지된 안전장치: 코어 확인 토큰(불일치 시 `confirmation-invalid`), IPC 검증, 게임·잠금이 살아 있으면 코어가 복구/삭제 거부, 범위 한정 삭제. 서비스 테스트는 "구 토큰·미지의 토큰은 거부되고 데이터가 남는다"로 교체했고 정상 삭제 테스트(토큰만으로 삭제, 인증 정보·다른 서버 보존)는 유지.
- 복구 창: `recovery.needed && confirmable`이 되면 한 번 자동으로 열림. "나중에"는 닫기만(같은 발생에서는 다시 열리지 않음). `recovery-required`로 막힌 홈 오류 패널에 "이전 실행 확인" 버튼이 있고, 이 경로에서 확인하면 복구 후 계정이 있을 때 이어서 `launch`를 보낸다. `confirmable:false`면 오류 패널이 `issues`를 사용자 문구로 보여 주고 로그 링크만 둔다.
- 로그 페이지: `logs`를 `source`로 필터(전체=런처 줄 다음 게임 줄, 메인이 이어 붙인 순서 그대로). 복사 실패는 경고 문구로 표시. 탭은 role=tab, 좌우 방향키 이동.
- 설정의 리소스팩: 필수 팩은 현재 위치에 고정(이동 버튼 없음), 사용자 팩은 이웃 사용자 팩과만 교환. 초안은 상태 이벤트로 덮어쓰지 않고, 상태에서 사라진 팩은 초안에서 제거된다. 저장 성공 시 초안 삭제.

## 진행 패널 단계 매핑

| 단계(칩 순서 고정) | 구성요소 / phase | 표시 |
| --- | --- | --- |
| 정보 확인 | `metadata`, 모든 `planning` | 불확정 바 |
| 게임 파일 확인·받기 | `game`, `java`, `library`, `asset`, `logging` | `completed`·`total`이 모두 측정되면 "완료 N / 전체 M"과 비율 바, 아니면 불확정 바 |
| 로더 설치 | `loader` | 불확정 바 |
| 서버 파일 동기화 | `server-mod`, `resource-pack`, `server-config`, `server-file` | 비율 없음(항상 불확정 바), `completed`가 있으면 "완료 N개" |

단계는 작업(operation) 동안 `useStage`가 단조 증가로 유지하고 operation 종료 시 초기화한다. 앞 단계는 done, 현재는 now, 뒤는 todo. 다른 단계의 늦은 활동은 문구·수치에 반영하지 않는다. 개별 파일 이름·경로 줄은 없다.

## 시안과 다른 점

- 등록되지 않은 파일: 시안은 "삭제" 버튼이 있으나 `remove-mod`는 `removeUserMod`만 호출하므로(등록되지 않은 경로는 `not-registered`) UI를 만들지 않았다. 코어에는 `removeUnregistered`가 있다. "내 모드로 등록" 버튼은 행 오른쪽에 둔다.
- 모드 파일 크기("1.2 MB")는 상태에 없어 생략. 내 모드 삭제는 기존 동작대로 `window.confirm` 한 번.
- 리소스팩: 상태에는 ID뿐이라 시안의 이름+경로 두 줄 대신 ID 한 줄. 드래그 손잡이(⠿)는 이동 버튼만 있어 생략.
- 서버 데이터 "위치" 행은 `deletion.root`가 있을 때(삭제 미리보기 이후)만 표시(사용량 상태에 경로가 없음). 삭제 창은 항상 표시.
- 로그: 상태에 시각이 없어 시안의 `[16:01:58]` 접두 없음, "폴더 열기" 없음. 전체 탭은 출처 구분 접두 없이 런처 줄 다음 게임 줄.
- 760px 이하에서 두 열 페이지는 한 열로 접힘(시안은 1120px 기준).
- 문구 추가(시안에 없음, 필요한 상태 표시): 모드 상태("파일을 찾을 수 없습니다" 등)·충돌 건수, 팩 로딩/실패/빈 목록, "저장했습니다.", 삭제 불가 안내, 복구 원인 문구, `failure.locked`·`failure.confirmation-invalid`. 오류 문구에서 "문제 해결"을 "로그"/"홈" 안내로 바꿈.

## #0 요청

1. 로그 "폴더 열기": IPC 명령이 없어 미구현. 새 읽기 전용 명령(예: `open-logs`)이 필요하다.
2. 등록되지 않은 파일 삭제: `remove-mod`가 지원하지 않는다. `removeUnregistered`를 쓰는 명령(또는 `remove-mod` 확장)이 필요하다.
3. 설정의 "위치"를 항상 보이게 하려면 `usage` 상태(또는 별도 필드)에 서버 데이터 루트를 포함해야 한다.
4. 모드 파일 크기와 리소스팩 표시 이름이 필요하면 상태 확장이 필요하다.

## 검증 (Linux, WSL2)

- vitest: 런처 렌더러·main/product 전체 통과(신규: 단계 매핑·단조 증가·측정 규칙, 페이지·확인 창·복구 패널 마크업, 팩 배열 로직, 라벨 사전).
- Biome(오류 0), tsc 통과, `node apps/launcher/scripts/renderer-functional-smoke.mjs` 통과(스위치, 사용량, 로그 탭), `.cache/smoke/l2a-*-{760,1100}.png`(커밋 안 함)를 시안과 비교해 수정.
- 최종 전체 `pnpm check`와 `scripts/smoke.mjs` 결과는 최종 보고에 기재.

## 미검증

- Windows 실행, 실제 계정·서버·게임, 실제 삭제/복구 종단 흐름(렌더러는 고정 상태로 화면 확인, 서비스는 단위 테스트).
- Electron에서 `navigator.clipboard` 복사의 실제 동작(실패 시 경고 표시로 처리).
