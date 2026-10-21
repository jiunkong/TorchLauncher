# Windows reader gzip 취소 테스트 멈춤 조사 결과

- 세션: Windows 검증 워커 (Claude Code, Sonnet 5.5)
- 브랜치: `verify/windows-reader-cancel`, 기준 커밋 `b36c958` (main)
- 환경: Windows 11 Pro 10.0.26300, Node 24.22.0, pnpm 10.34.7

## 재현
`vitest run packages/core/src/deployment/reader/reader.test.ts -t "cancels while a gzip stream"` 반복:
- 첫 25회 중 11회 실패, 이어서 6회 중 3회 실패(≈45%). 실패는 모두 `Test timed out in 30000ms`(30초 끝까지 감, 느림이 아니라 영구 pending). 통과 시 약 0.33초.
- 계측 후 6회 중 3회 실패(재현율 변화 없음).

## 멈춘 위치 (사실, 임시 계측 로그 기준)
`reader.ts` gzip 경로에서 `takeChunk got → write start → consume chunk → consume threw Error: cancel while inflating`까지는 동일. 이후
- 통과 시: `write cb null` → `awaiting consume` → `consume settled`.
- 멈춤 시: 위 `consume threw` 이후 로그가 더 없음. 즉 **피드 쪽 `inflater.write(chunk, cb)`의 콜백이 호출되지 않아** `await new Promise(... write cb ...)`가 영원히 pending이고, `finally`의 `await consume`에 도달하지 못함. 의심 지점 1이 맞음.
- 메커니즘(추측): 소비자가 abort로 throw → `for await`의 `return()`이 inflater를 destroy → zlib이 스레드풀에서 write 처리 중일 때 destroy되면 write 콜백이 유실되는 경쟁. Node/Windows 타이밍 의존으로 보이며 Node 이슈 여부는 확인하지 않음.
- 제품 결함임: 취소가 영영 끝나지 않을 수 있음(Linux에서는 25회 통과, 같은 경쟁이 드물 뿐일 가능성은 배제 못 함).
- 의심 지점 2·3·4는 로그상 해당 없음(takeChunk는 완료, writeOutput의 abort throw 이후 멈춤, 파일 정리 단계에 도달하지 않음).

## 제안 패치 (`proposal:` 커밋 `3f9e54b`)
`reader.ts`: write 대기 Promise가 inflater `'close'`에서도 reject되도록 하고(콜백 도착 시 리스너 제거), 이 경우 소비자의 실패(`consumeResult.error`)를 보고하는 오류로 우선하도록 `feedError`를 비움.
- 같은 테스트 30회 반복: 실패 0.
- `vitest run packages/core/src/deployment`: 188 통과 / 6 skip / 0 실패. biome, typecheck 통과.
- 한계: 근본 원인이 Node 내부 콜백 유실이라 우회 수정임.

## `pnpm check` (패치 적용 상태)
exit 0. 테스트 37 파일 통과 / 4 skip, 686 통과 / 27 skip / 0 실패. 이전 검증 때 실패했던 writer EPERM 2건도 이번 기준 커밋에서는 통과(원인 미조사).

## 하지 못한 것
Node 이슈 트래커 확인, 최소 재현 스크립트(vitest 밖)로 Node 버그 단독 확인, Linux 재현 시도.
