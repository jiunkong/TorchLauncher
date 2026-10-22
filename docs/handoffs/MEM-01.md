# MEM-01 — 게임 메모리 설정 (Xmx/Xms)

- 작업자: `launcher develop #1` / `mem_01`
- 브랜치/worktree: `feat/mem-01-game-memory` / `.agents/worktrees/agent-1`
- 기준: `cdabfb2`
- 범위: 코어 launch arguments와 launch gate, 플레이어 개인 설정·서비스·IPC, 런처 설정 화면, 메모리 입력 helper 및 최소 앱 smoke.
- 통합 상태: worker branch only. #0이 검토·통합한다.

## 구현

- 코어 `initialMemoryMiB`는 256 MiB 이상, 정수이며 Xmx 이하일 때만 `-Xms…M`으로 전달한다. 미지정이면 JVM 인자에 `-Xms`를 넣지 않는다. 기존 Xmx 기본 2048 MiB와 512–65536 MiB 범위를 유지한다.
- 선택적 `maxMemoryMiB`·`initialMemoryMiB`를 기존 원자적 개인 설정 파일에 추가했다. 이전 `closeOnLaunch` 전용 파일을 읽고, 두 설정 변경은 기존 필드를 보존한다. 손상된 설정은 이전처럼 자동 종료를 끄고, 잘못된 입력/저장 실패는 성공 상태를 게시하지 않는다.
- 설정 파일의 읽기·쓰기와 launch snapshot은 별도 queue로 직렬화한다. launch 시작 시 전체 설정을 한 번 복사하고 해당 실행에는 고정한다. 메모리 저장은 실행 중에도 허용하며 다음 실행부터 적용한다. 이미 시작된 저장은 서비스 종료가 기다린다. 게임 수명과 `Operations` 잠금 동작은 바꾸지 않았다.
- 메인 프로세스만 `os.totalmem()`을 읽어 MiB 단위 상태로 보낸다. 메모리 저장은 512 MiB 이상 및 `min(65536, floor(물리 RAM MiB))` 이하를 검증한다. launch는 기본값 또는 저장값이 현재 물리 RAM을 넘으면 설치/실행 호출 전에 `memory-limit`으로 중단한다. 저장된 값이 하드웨어 교체 뒤 상한을 넘더라도 설정과 `closeOnLaunch`를 보존해 사용자가 수정할 수 있다. RAM 512 MiB 미만에서는 저장과 실행을 거부한다.
- 설정 화면에 Xmx/Xms GB 입력, Xms 선택 해제, 상한/초기값 검증, 물리 RAM 75% 초과 경고와 다음 실행 안내를 추가했다. 모든 문구와 GB 단위는 i18n 사전에 둔다. Xmx는 0.5 GB 간격, Xms는 최소 0.25 GB 간격 입력을 제공한다.
- #0 승인으로 관련 최소 UI 연결에 `renderer/src/hooks/useProduct.ts`, `renderer/src/fixtures.ts`, `renderer/src/labels.ts`, `renderer/src/styles.css`를 추가했다. renderer는 Node API를 호출하지 않으며 기존 테마와 텍스트 드래그 정책을 수정하지 않았다.

## 검증 (Linux/WSL2, Node 24.21.0)

- Vitest: MEM-01 관련 10개 파일, 79개 테스트 통과. 코어 인자 기본/경계, loader forwarding, 구 설정 파일, 잘못된 값, 설정 저장 실패, IPC, 현재 launch snapshot과 다음 실행 반영, live-game 중 저장 및 종료 시 queue drain 포함.
- `pnpm --filter @torchlauncher/launcher typecheck` 통과.
- `pnpm --filter @torchlauncher/core typecheck` 통과.
- `pnpm --filter @torchlauncher/launcher build` 통과.
- `node apps/launcher/scripts/renderer-functional-smoke.mjs` 통과. 설정 저장·기존 close-on-launch 보존·저장 실패 후 입력 draft/확인 상태 보존을 확인했다.
- 변경 파일 Biome 검사를 실행했다. 오류는 없고 기존 `styles.css`의 경고 8개가 남았다 (`!important` 3개, 기존 선택자 specificity 경고 5개).

## 미검증

- Windows 검증은 #0의 main 통합 후 확인 대기.
- 실제 Minecraft 실행/메모리 사용량은 검사하지 않았다. 이 worker는 live game을 시작하지 않았다.
