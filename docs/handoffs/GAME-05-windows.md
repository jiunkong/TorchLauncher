# GAME-05 Windows 실제 프로세스 테스트 인계

- 세션: `launcher develop #3`, 브랜치 `test/game-05-windows` (main `1cb8617` 기준)
- 상태: Linux에서 전체 통과(`pnpm check` 포함). **Windows 실제 미실행** - 사용자가 실행해 결과를 보내야 한다.

## 변경

- `recovery/kill.test.ts`: `linux`와 `win32` 모두 실행(그 외 skip). 강제 종료는 Linux SIGKILL / Windows `process.kill`·`child.kill`(TerminateProcess).
  종료 판정은 플랫폼 독립(`wasKilled`: Linux는 signal SIGKILL, Windows는 exit code != 0). 합성 호스트의 `die()`는
  `process.kill(self,'SIGKILL')` 후 `process.exit(137)` 폴백. 경로는 `pathToFileURL`/인자 배열(shell 미사용, 공백 경로 안전),
  `windowsHide: true`, 임시 디렉터리 삭제는 `maxRetries`로 재시도.
- `identity.test.ts`: 실제 `systemProcessProbe()` 테스트를 Linux/Windows에서 실행: 머신 ID 해시, 자기 PID 시작 식별자 형식
  (`windows:<ticks>` / `linux:<boot>:<ticks>`), 자식 프로세스 running -> 종료 후 `absent`, 존재하지 않는 PID `absent`.
  PID 재사용(`reused`)은 `kill.test.ts`의 시작 식별자 불일치 시나리오(`owner-pid-reused`)가 실제 프로브로 검증한다.
- `lock.ts`: `renameWithRetry` 추가. Windows에서만 EPERM/EACCES/EBUSY를 최대 8회(25ms 단위 증가) 재시도하며
  `owner.json` 원자 교체(`recordChild`)와 reclaim의 owner 이동에 사용. 다른 플랫폼/ENOENT는 즉시 전파. 단위 테스트 `recovery/rename-retry.test.ts`.

## Windows에서 실행할 명령 (PowerShell, Node 24 / pnpm 10.34.7)

```powershell
git fetch origin
git checkout test/game-05-windows
git pull
pnpm install --frozen-lockfile
pnpm exec vitest run packages/core/src/minecraft/identity.test.ts packages/core/src/minecraft/recovery/kill.test.ts packages/core/src/minecraft/recovery/recovery.test.ts packages/core/src/minecraft/recovery/rename-retry.test.ts --reporter=verbose
```

필요한 환경 변수 없음(`SystemRoot`는 Windows 기본값 사용). 전체 확인: `pnpm exec vitest run packages/core/src/minecraft`.
`powershell.exe`가 정책/보안 제품으로 차단되면 프로브가 `unknown`이 되어 identity 테스트가 실패한다(제품 결함이 아닌 환경 문제로 구분해 보고).

## 결과 보고 방법(안전한 요약)

1. 마지막 요약줄의 `Test Files`/`Tests`의 passed/failed/skipped 개수를 그대로 복사.
2. 실패 시 테스트 이름과 오류 메시지 첫 3-5줄만 복사. 경로의 사용자 이름은 치환:
   ```powershell
   pnpm exec vitest run <위 파일들> --reporter=verbose 2>&1 | Select-String -Pattern 'Tests|Test Files|FAIL|✓|×|↓|Error|expected' | ForEach-Object { $_.Line -replace [regex]::Escape($env:USERNAME),'<user>' -replace [regex]::Escape($env:USERPROFILE),'<home>' }
   ```
3. 머신 GUID, 전체 로그, 환경 변수 값은 보내지 않는다.

## 의심 지점(수정하지 않음)

- 디렉터리 rename(`runtime/java` -> backup)은 해당 디렉터리 안에 열린 핸들이 있으면(실행 중 Java, 백신) EPERM/EBUSY. 재시도 없이 기존 rollback 경로로 처리됨.
- `rm`/`unlink`(복구의 backup 삭제, staging 정리)는 읽기 전용/열린 핸들 파일에서 EPERM/EBUSY 가능; 복구는 재실행 가능(idempotent)하므로 실패로 보고된다.
- `reclaim`의 `link(aside, ownerPath)`(소유자 변경 시 원복)은 NTFS에서는 동작하나 FAT/exFAT/네트워크 드라이브에서는 실패할 수 있다(실패 시 무시됨).
- 경로 비교는 대소문자 구분(`journal.root !== paths.root`, `staged` 집합); 저널은 같은 `resolve()` 결과로 쓰이므로 정상 흐름에서는 일치하나, 드라이브 문자 대소문자가 바뀐 경로로 재진입하면 `journal-root-mismatch`가 될 수 있다. `\\?\` 접두 경로는 미검증.
- PowerShell 프로브는 호출당 수백 ms 소요; kill 테스트의 `waitAbsent`(최대 5초 폴링)가 느린 PC에서 부족할 수 있다.
- `process.kill(self,'SIGKILL')`의 Windows 종료 코드는 구현 의존이라 `code != 0`로만 판정한다.
