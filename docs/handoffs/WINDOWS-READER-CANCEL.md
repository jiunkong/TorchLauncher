# Windows 검증 워커 지시: deployment reader gzip 취소 테스트 간헐적 멈춤 조사

작성: #0 (2026-10-22). 이 문서만 읽고 작업할 수 있게 작성했다. 대화 기록은 필요 없다.

## 역할과 규칙
- 너는 **검증 워커**다(총괄 #0 아님). `AGENTS.md`를 먼저 읽어라. 원본 저장소(`D:\Projects\mclauncher`)는 수정하지 마라.
- Windows 클론 `D:\TorchLauncherWindowsSmoke`에서 `git status`로 상태를 확인(덮어쓰기 금지)한 뒤 `git checkout main && git pull`, 새 브랜치 `verify/windows-reader-cancel`에서 작업한다. `main` 병합 금지, `docs/progress.md`·`docs/tool-handoff.md` 수정 금지.
- 계정·토큰·사용자 이름이 든 경로를 결과·커밋에 넣지 마라. macOS는 지원하지 않는다.
- 사용량 절약: 필요한 명령만 실행하고 긴 출력은 요약해 기록한다.
- 결과: `docs/handoffs/WINDOWS-READER-CANCEL-RESULT.md`를 커밋한다. 제품 코드 수정안은 **`proposal:` 커밋**으로 분리하고 근거를 적는다. #0이 `git fetch D:\TorchLauncherWindowsSmoke verify/windows-reader-cancel`로 가져간다.

## 문제
`packages/core/src/deployment/reader/reader.test.ts`의 테스트 `cancels while a gzip stream is producing output and removes its scratch file`(420행 부근)가 Windows 11에서 **간헐적으로 30초 제한까지 끝나지 않는다**(전체 `pnpm check` 1회 실패, 단독 반복 실행 3회 중 1회 실패). 같은 테스트는 Linux에서 25회 연속 통과했다. 시간 초과가 30초이므로(Windows 제한을 5초→30초로 올린 뒤에도 발생) 느려서가 아니라 **어떤 Promise가 영원히 끝나지 않는 것**으로 의심된다. 제품 결함(취소가 영영 끝나지 않을 수 있음)인지, 테스트의 타이밍 경쟁인지 구분하는 것이 목적이다.

테스트 개요: 512 KiB 무작위 데이터를 gzip으로 넣은 배포 파일을 만들고, `MemorySource.beforeResponse`에서 페이로드 범위 요청이 들어오면 `setTimeout(0)`으로 `AbortController.abort(new Error('cancel while inflating'))`를 호출한다. 기대: `reader.stageFile(...)`이 그 오류로 reject되고 scratch 출력 파일이 남지 않는다.

관련 구현: `packages/core/src/deployment/reader/reader.ts`의 gzip 경로(약 480~570행): `createInflateRaw()`를 두고 `for await (const outputChunk of inflater) await writeOutput(...)`로 소비하는 `consume` 비동기 작업과, 입력 chunk를 `inflater.write(chunk, cb)`로 넣고 cb를 기다리는 피드 루프가 동시에 돈다. 의심 지점(추측, 검증 필요):
1. 소비자가 abort로 throw한 뒤 `inflater.destroy()` 이후에도 피드 쪽 `inflater.write` 콜백이 호출되지 않아 `await new Promise(... inflater.write(chunk, cb))`가 영원히 pending.
2. 피드 쪽 `cursor.takeChunk()`/`getExactRange` 가 abort를 놓치고 대기.
3. 소비자가 `writeAll(output, bytes)`(파일 쓰기) 중이거나 정리(`rm`) 중에 Windows에서 파일 핸들/EPERM/EBUSY로 막힘.
4. 테스트의 `setTimeout(0)` abort가 요청 처리 순서보다 먼저/늦게 발생해 의도한 경로를 못 타는 경우.

## 할 일
1. 재현: `pnpm exec vitest run packages/core/src/deployment/reader/reader.test.ts -t "cancels while a gzip stream"`를 20회 이상 반복해 실패 비율과 소요 시간을 기록한다(실패 시 반드시 제한 시간 30초까지 가는지 확인).
2. 멈춘 위치 특정: 제품/테스트 코드를 **임시 계측**(`console.error` 단계 로그나 각 await 앞뒤 타임스탬프)해 어느 await에서 멈추는지 찾는다. 계측은 커밋하지 말고 결과 문서에 위치와 근거만 적는다(계측이 타이밍을 바꿔 재현율이 변하면 그 사실도 기록).
3. 판단: 제품 결함이면 최소 수정안(예: `inflater.write` 대기를 abort 신호와 경합시키거나, abort 시 write 콜백을 기다리지 않고 정리)을 `proposal:` 커밋으로 만들고, 같은 테스트 20회 반복 통과와 `vitest run packages/core/src/deployment`의 통과를 확인한다. 테스트 경쟁이면 테스트만 안정화(결정적인 abort 시점)하고 근거를 적는다. 확신이 없으면 수정하지 말고 발견한 사실만 기록한다.
4. 마지막으로 `pnpm check` 전체를 1회 실행해 결과(통과/실패 수)를 기록한다.

## 결과 문서 형식
세션 이름, 브랜치, 기준 커밋, 환경(Windows 버전, Node/pnpm 버전), 재현 통계(실행 횟수·실패 횟수·소요 시간), 멈춘 위치와 근거(사실과 추측 구분), 제안 패치 커밋 해시와 효과, 하지 못한 것.
