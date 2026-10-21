# Windows 네이티브 검증 작업 지시 (Windows Claude 세션용)

작성: #0 (2026-10-22). 이 문서만 읽고 작업할 수 있게 작성했다. 대화 기록은 필요 없다.

## 역할과 규칙

- 너는 **검증 워커**다. 총괄(#0)이 아니다. `AGENTS.md`를 먼저 읽어라(특히 Agent Coordination & Merge Ownership).
- 저장소 원본(`D:\Projects\mclauncher`, WSL 쪽 체크아웃)은 수정하지 마라. **Windows 전용 클론**에서만 작업한다:
  `D:\TorchLauncherWindowsSmoke`가 있으면 그대로 사용(`git status`로 확인, 덮어쓰지 말 것), 없으면
  `git clone D:\Projects\mclauncher D:\TorchLauncherWindowsSmoke`. Node 24, pnpm 10.34.7 사용.
- 작업은 새 브랜치 `verify/windows-20261022`에서 한다(`main` 기준). `main`에 병합하지 말고 `docs/progress.md`·`docs/tool-handoff.md`는 수정하지 마라.
- 결과는 `docs/handoffs/WINDOWS-VERIFY-RESULT.md`에 적고 커밋한다. #0이 `git fetch D:\TorchLauncherWindowsSmoke verify/windows-20261022`로 가져간다.
- 제품 코드는 고치지 않는다. 실패나 결함을 발견하면 원인 분석과 **제안 패치를 별도 커밋(메시지에 `proposal:`)** 으로 남기고 결과 문서에 구분해 적어라.
- 계정·토큰·MS 로그인·프로필 UUID·사용자 이름이 든 경로를 결과·커밋에 넣지 마라. 로그인이 필요한 작업은 하지 않는다.
- macOS는 지원하지 않는다(사용자 결정). Linux ARM64도 대상이 아니다.
- 사용량 절약: 각 과제는 필요한 명령만 실행하고, 긴 출력은 요약해 기록한다.

## 과제

### A. Windows 심볼릭 링크 거부 테스트 실행 (소)
지금까지 symlink 권한이 없어 14개 테스트가 skip됐다. Windows **개발자 모드를 켠 상태**(설정 → 개발자용)에서 실행해 skip이 줄고 모두 통과하는지 확인한다.
`pnpm exec vitest run packages/core/src/minecraft packages/core/src/instance` — 통과/실패/skip 수와 실패 이름을 기록. 개발자 모드를 켤 수 없으면 건너뛰고 이유를 적는다.

### B. `held-live` 경로의 Windows 실프로세스 검증 (중)
배경: Windows에서 Node 호스트를 강제 종료하면 자식도 함께 종료된다는 것을 확인했다(job object 유사). 그래서 "호스트는 죽었는데 자식(게임)은 살아 있는" 상황을 Windows에서 아직 재현하지 못했다.
1. `detached: true`(분리 실행)로 띄운 자식이 호스트 `kill('SIGKILL')` 이후에도 살아남는지 작은 Node 스크립트로 실험한다(스크립트는 저장소 밖 임시 폴더에).
2. 살아남는다면 `packages/core/src/minecraft/recovery/kill.test.ts`의 Windows 분기에 분리 실행 자식을 쓰는 `held-live → stale-verified` 테스트를 추가한다(`proposal:` 커밋, Linux 기대 변경 금지). 안 살아남으면 그 사실과 근거를 기록한다.
3. 위 `vitest` 실행으로 새 테스트와 기존 테스트가 통과하는지 확인한다.

### C. Electron에서 띄운 자식이 메인 프로세스 강제 종료 시 함께 죽는가 (중)
제품은 Electron 메인 프로세스가 Java를 띄운다. Node 스크립트 결과가 Electron에도 적용되는지 모른다.
1. 저장소의 Electron 의존성(`pnpm install --frozen-lockfile` 후 `apps/launcher`의 electron)을 사용해, 저장소 **밖** 임시 폴더에 최소 Electron 메인 스크립트를 만든다: 메인이 `child_process.spawn`으로 `node -e "setInterval(()=>{},1000)"` 자식을 띄우고 pid를 파일로 출력한 뒤 대기.
2. 외부에서 메인 프로세스를 강제 종료(`taskkill /F /PID <main>`)하고 1~2초 뒤 자식 pid가 살아 있는지 확인(`Get-Process -Id`). 일반 spawn과 `detached: true` 두 경우를 모두 확인한다.
3. 결과(자식 생존 여부)와 전제(Electron 버전, 실행 방법)를 기록한다. 제품 코드는 수정하지 않는다.

### D. BASE-03: 패키징·실행·smoke (중)
1. `pnpm install --frozen-lockfile` 후 `pnpm check` 결과(통과/실패, 테스트 수).
2. `pnpm smoke`(display 필요) — 두 앱의 화면·IPC·격리 smoke 결과.
3. `pnpm package:launcher`, `pnpm package:studio` — 산출물 경로(저장소 기준 상대경로), 크기, 포터블 실행 파일이 실제로 실행되는지(창이 뜨는지, 곧바로 종료해도 됨). 서명 안 된 상태에서의 SmartScreen/백신 경고 여부도 관찰 사실만 기록.
4. 실패하면 오류 메시지 원문 중 경로의 사용자 이름만 치환해 기록.

## 결과 문서 형식 (`docs/handoffs/WINDOWS-VERIFY-RESULT.md`)
세션 이름, 브랜치, 기준 커밋, 실행 환경(Windows 버전, Node/pnpm/Electron 버전), 과제별 명령·결과·통과/실패/skip 수, 발견한 결함과 `proposal:` 커밋 해시(있으면), 하지 못한 것과 이유. 사실과 추측을 구분해 적어라.
