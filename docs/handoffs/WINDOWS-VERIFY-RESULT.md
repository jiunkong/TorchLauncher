# Windows 네이티브 검증 결과

- 세션: Windows 검증 워커 (Claude Code, Sonnet 5.5)
- 브랜치: `verify/windows-20261022` (기준 커밋 `484b42e`, main)
- 환경: Windows 11 Pro 10.0.26300, Node 24.22.0, pnpm 10.34.7, Electron 44.9.1, 개발자 모드 꺼짐(일반 권한)
- 제품 코드 수정 없음. 테스트 1건만 `proposal:` 커밋 `a298b53`.

## A. symlink 거부 테스트 — 건너뜀(미수행)
- 개발자 모드가 꺼져 있고 `New-Item -ItemType SymbolicLink`가 "Administrator privilege required"로 실패함. 개발자 모드 설정은 사용자 조작이 필요해 켜지 않음.
- 참고(기존 상태): `vitest run packages/core/src/minecraft packages/core/src/instance` → 234 통과 / 14 skip / 실패 0 (proposal 적용 후 235 / 14 / 0).

## B. held-live 실프로세스 (Windows)
- 실험(Node 스크립트, 저장소 밖): 호스트 강제 종료 후 2초 시점 자식 생존 여부
  - 일반 spawn: 자식 **죽음**
  - `detached: true` + `unref()`: 자식 **생존** (PowerShell Start-Process 호스트, Node spawn 호스트 모두, windowsHide 유무 무관)
- 따라서 테스트 추가: `proposal:` 커밋 `a298b53` — `kill.test.ts`의 HOST `game` 모드에 `extra === 'detached'`일 때 `detached` + `unref`를 적용하고, win32 전용 테스트 `keeps the lock while a detached game child outlives a killed host (Windows)` 추가(`held-live`/`['owner-exited','child-alive']` → 복구 거부 → 자식 종료 후 `stale-verified` → 복구 `free`). Linux 기대값은 변경하지 않음.
- 결과: `minecraft` + `instance` 범위 235 통과 / 14 skip / 0 실패. biome 통과.

## C. Electron 메인 강제 종료 시 자식
- 방법: 저장소 밖 최소 Electron 앱(`electron@44.9.1`의 `electron.exe`), 메인이 `spawn('node', ['-e','setInterval…'])`, 외부에서 `taskkill /F /PID <main>`(`/T` 없음), 2초 후 `Get-Process`.
- 일반 spawn: 자식 **죽음**. `detached: true`(+unref): 자식 **생존**. Node 단독 결과와 동일.
- 추측: 일반 자식이 죽는 것은 부모가 만든 job object(kill-on-close) 때문으로 보이나 직접 확인하지 않음. 제품이 Java를 띄울 때 `detached`를 쓰는지에 따라 `held-live` 경로 도달 여부가 갈림(사실: 이 코드 경로는 확인하지 않음).

## D. BASE-03
1. `pnpm install --frozen-lockfile` 정상. `pnpm lint`(180 파일), `pnpm typecheck` 통과.
2. `pnpm check` **테스트 단계에서 실패**: 41 파일 중 8개 실패 / 714 테스트 중 13 실패, 675 통과, 26 skip.
   - 실패 12건은 `Test timed out in 5000ms` 등 부하성(전체 병렬 실행 시에만). 해당 파일을 각각 단독 실행하면 모두 통과(data, mods, settings, sync, installer, process, kill). kill 테스트 1건은 병렬 실행 중 `child-pid-reused`(기대 `child-exited`)로 실패했고 단독에서는 통과 — 부하 시 간헐 실패(원인 미분석, 추측).
   - **결정적 실패 2건** `packages/core/src/deployment/writer/writer.test.ts`: `rejects a source changed during reading: replace`, `rejects directory replacement during generation`. 기대 `code: 'source-changed'`, 실제 `EPERM: operation not permitted`. 단독 실행에서도 재현. 두 테스트 모두 writer가 열어 둔 소스 파일/디렉터리를 `rename`으로 교체하는데, Windows에서는 열린 핸들 때문에 이 `rename` 자체가 EPERM으로 실패하는 것으로 보임(추측: 스택은 정밀 확인하지 않음). 즉 테스트 가정 문제일 가능성이 높고 제품 결함인지는 미확인. 이 문서에서는 수정 제안 없음.
   - 이 때문에 `pnpm check`의 빌드 단계는 실행되지 않았으나 `pnpm smoke`가 두 앱을 빌드했고 성공.
3. `pnpm smoke`: exit 0. "TorchLauncher: renderer, IPC, and sandbox checks passed", "TorchLauncher Studio: renderer, IPC, and sandbox checks passed".
4. 패키징: `pnpm package:launcher`, `pnpm package:studio` 모두 exit 0.
   - `apps/launcher/dist/TorchLauncher-0.1.0-win-x64.exe` 96.1 MB (`win-unpacked/` 동반)
   - `apps/admin/dist/TorchLauncher Studio-0.1.0-win-x64.exe` 95.6 MB
   - 두 exe 모두 실행 12초 후에도 살아 있고 창 제목 `TorchLauncher` / `TorchLauncher Studio`의 메인 창 확인. 이후 강제 종료함.
   - 서명: `NotSigned`. SmartScreen/백신 경고는 PowerShell `Start-Process` 실행에서 관찰되지 않았으나 다운로드된 파일(Mark of the Web)이 아니라서 의미 있는 SmartScreen 검증은 아님.

## 하지 못한 것
- A (개발자 모드 필요), 서명/MOTW 상태에서의 SmartScreen 확인, writer 테스트 EPERM 정밀 원인 분석.
