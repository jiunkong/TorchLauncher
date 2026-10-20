# AUTH-02 — 인증 host 어댑터 인계 / 실계정 검증 대기

- 세션: `launcher develop #4` / TorchLauncher worker #4
- 브랜치: `feat/auth-02-host-adapters`, worktree: `.agents/worktrees/agent-4`
- 실제 기준 커밋: `58fe23e` (`docs: assign second-wave implementation tasks`)
- 구현 커밋: `6fae6097ff572aac5e1375222221bf119c9dc4b7`
- 최종 인계 커밋 해시는 자기 참조를 피하기 위해 최종 응답과 #0 알림에 기록한다.
- 상태: **구현과 독립 자동 검증은 인계 가능하나 AUTH-02 전체 완료가 아니다.**
  실제 안전 저장 성공·재시작·Microsoft/Minecraft 로그인 cycle은 아래 외부 조건으로 미검증이다.

## 구현 범위

`apps/launcher/src/main/auth/**`, `scripts/auth-smoke.mjs`, 이 문서와 배정받은
`packages/core/package.json`의 `./auth` export만 변경했다. 의존성 추가와 lockfile 수정은 없다.
제품 main 진입점·renderer·IPC·진행 문서·다른 worktree는 수정하지 않았다.

- `LoopbackAuthenticationBrowser`: 설정한 loopback 포트를 먼저 연 뒤 주입받은
  `openExternal`을 호출한다. 실제 Electron 팩터리는 `shell.openExternal`을 연결한다.
  Microsoft `consumers` authorization endpoint만 허용하며 PKCE/redirect/state 형태를 검사한다.
  HTTP callback은 정확한 Host/port/path와 state, GET, 단일 code 또는 error를 요구한다.
  잘못된 콜백에는 정적 오류를 보내고 올바른 콜백을 계속 기다린다. 반환 페이지에 코드나
  provider 설명을 반영하지 않는다. 완료·실패·취소·timeout에 listener와 idle socket을 닫는다.
- redirect는 명시적인 1024 이상 포트를 가진 `http://localhost`, `http://127.0.0.1`,
  `http://[::1]`만 받는다. localhost 설정은 IPv4 loopback에 바인딩한다. 직접 HTTP 테스트는
  IPv4/localhost를 검증했으며 IPv6와 Windows/macOS 브라우저 동작은 추가 실검증이 필요하다.
- `EncryptedMicrosoftTokenStorage`: Electron `safeStorage` 경계와 파일 저장을 분리했다.
  OS 암호화 가용성을 확인하고 Linux에서는 `gnome_libsecret`, `kwallet`, `kwallet5`,
  `kwallet6`만 허용한다. `basic_text`, `unknown`, 미등록 backend는 거부한다.
  `setUsePlainTextEncryption`이나 평문 fallback은 호출하지 않는다.
- 저장 내용은 `{key, session:{version:1, refreshToken}}`의 암호문뿐이다. 계정 키의 SHA-256을
  파일명으로 사용하고 복호화 후 원래 키를 확인한다. 0700 전용 디렉터리/0600 임시 파일,
  file sync와 같은 디렉터리의 atomic rename으로 교체한다. 읽기는 256 KiB로 제한한다.
  심볼릭 링크·하드 링크·잘못된 권한/소유자·손상된 암호문을 거부하며 저장/삭제는 직렬화한다.
  OS 저장소가 나중에 잠겨도 `clear(key)`로 해당 ciphertext 삭제는 가능하다.
- `createElectronAuthenticator`: `app.whenReady()` 후 위 어댑터를 AUTH-01에 연결한다.
  기본 계정 위치는 `app.getPath('userData')/accounts`다. 서버별 데이터 삭제 범위 밖에 두어야
  하며 caller는 `app.requestSingleInstanceLock()`을 먼저 확보해야 한다. UI 연결은 후속 작업이다.

안전 backend 판별 API와 일치하는 동기 `safeStorage.encryptString/decryptString`을 사용했다.
OS 키링 대화상자가 main 프로세스를 잠시 막을 수 있다. Electron이 권장하는 async API에는
별도 provider/fallback 체계가 있으므로, 향후 이동 시 동일한 평문 거부 조건을 다시 검증해야 한다.
이 선택과 플랫폼별 보호 범위는 [Electron safeStorage 공식 문서](https://www.electronjs.org/docs/latest/api/safe-storage)를 따른다.
Windows DPAPI는 다른 사용자로부터 보호하지만 같은 사용자 권한의 다른 프로세스로부터
완전 격리하지 않는다. macOS는 일관된 코드 서명이 Keychain 동작에 영향을 준다.

`HostAuthenticationError`는 code만 유지하며 원본 경로·URL·exception cause를 전달하지 않는다.
어댑터는 trusted main-process 설정을 전제로 한다. 동일 디렉터리를 여러 인스턴스/프로세스가
공유하는 경우 caller의 잠금이 필요하며 부모 디렉터리는 OS 사용자 데이터의 신뢰 경계다.
파일 rename의 원자성을 사용하지만 전원 차단 후 directory entry 내구성까지 보장하는 별도
복구 프로토콜은 없다. 크래시가 남긴 임시 파일에도 ciphertext만 존재한다.

## 실행 도구와 실제 검증 요청

`node scripts/auth-smoke.mjs --help`로 옵션을 확인한다. 이 스크립트는 기존 Vite로 독립
Electron entry를 임시 디렉터리에 번들하고 실행한다. 제품 entry나 IPC는 변경하지 않는다.
계정 데이터는 명시적으로 지정한 저장소 밖 전용 디렉터리에 둔다. Node/Electron의 플랫폼별
의존성을 혼용하지 않도록 Windows 테스트에는 별도 checkout과 별도 node_modules를 사용한다.

| 모드 | 검증 |
| --- | --- |
| `probe` | 실제 Electron의 OS 암호화 가용성/backend만 확인; 로그인·토큰 저장 없음 |
| `reject-basic` | Linux에서 `--password-store=basic`을 주고 거부를 확인; 로그인 없음 |
| `storage-cycle` | 합성 값 저장 → 새 프로세스에서 읽기 → 삭제 → 새 프로세스에서 빈 상태 확인 |
| `cycle` | 실제 브라우저 로그인 → 새 프로세스에서 refresh/권한/프로필 → 로그아웃 → 새 프로세스에서 빈 상태 확인 |
| `login`, `refresh`, `logout`, `assert-empty` | 위 실계정 단계를 개별 실행 |

로그에는 단계별 성공 여부와 정제된 오류 code/stage/status만 남긴다. profile, 토큰, callback URL,
state를 출력하지 않는다. 전체 cycle이 성공한 경우에만 `liveAuthentication: "verified"`를 출력한다.
도중 실패하면 암호화된 refresh token이 남을 수 있으므로 같은 ID/디렉터리로 `logout`을 실행한다.
로그아웃은 로컬 삭제이며 브라우저 Microsoft 로그인이나 사용자 동의 철회는 별도다.

사용자에게 실제 인증 참여를 직접 요청했고 #0에도 알렸다. 사용자는 **Windows 테스트는
가능하지만 앱 등록은 아직 준비되지 않았다**고 명확히 정정했다. 비밀번호·인증 코드·토큰을
채팅에 요청하지 않았으며 자체 앱 등록의 의미와 공식 문서, 개인 Microsoft 계정 유형 및
desktop loopback 설정을 안내했다. 앱 등록 완료나 Minecraft 접근 승인은 아직 확인되지 않았다.

앱 등록 담당자가 준비할 값:

1. TorchLauncher 소유 Microsoft Entra 앱의 Application (client) ID.
   개인 Microsoft 계정 로그인을 지원하는 공개 desktop client로 등록한다.
   [Microsoft 앱 등록](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
   [Xbox 계정 유형 안내](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication).
2. 테스트 redirect `http://localhost:48127/callback`을 모바일/데스크톱 플랫폼에 등록한다.
   이 desktop PKCE 흐름은 client secret을 배포하거나 요구하지 않는다.
   [Desktop 설정](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration),
   [OAuth code/PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
3. 해당 앱으로 실제 Xbox/Minecraft API 접근을 검증한다. 앱 등록을 API 접근 승인으로
   간주하지 않는다. 승인 절차의 불확실성과 AUTH-01 endpoint 참고 근거는 [AUTH-01](AUTH-01.md)에 있다.

Windows PowerShell 재현 예시 (Node 24 / pnpm 10.34.7, 저장소 루트가 `D:\Projects\mclauncher`인 경우):

```powershell
git clone --no-hardlinks --branch feat/auth-02-host-adapters D:\Projects\mclauncher D:\Projects\torchlauncher-auth-test
cd D:\Projects\torchlauncher-auth-test
pnpm install --frozen-lockfile
node scripts/auth-smoke.mjs probe --data-dir "$env:LOCALAPPDATA\TorchLauncherAuthSmoke"
node scripts/auth-smoke.mjs storage-cycle --data-dir "$env:LOCALAPPDATA\TorchLauncherAuthSmoke"
node scripts/auth-smoke.mjs cycle --data-dir "$env:LOCALAPPDATA\TorchLauncherAuthSmoke" --client-id "자체-앱의-Application-client-ID" --redirect-uri "http://localhost:48127/callback"
```

마지막 명령은 앱 등록 후 실행한다. 로그인은 열린 Microsoft 브라우저에서 사용자가 직접
완료한다. 결과 공유는 정제된 JSON 성공/오류 결과만으로 충분하며 브라우저 주소나 credentials는
공유하지 않는다. Windows/macOS OS 암호화·재시작, 실제 계정 로그인/갱신/로그아웃은 아직 미검증이다.

## 실행한 검증과 관찰

Linux/WSL, Node `v24.21.0`, pnpm `10.34.7`, Electron `44.9.1`.
`CI=true PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH pnpm install --frozen-lockfile --store-dir /tmp/torchlauncher-pnpm-store`
로 이 worktree의 node_modules를 별도로 재설치했다. CI 옵션 없이 store를 바꾸는 첫 시도는
pnpm의 비대화형 purge 확인 때문에 중단됐고 위 명령으로 성공했다.

- `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH pnpm check` — 성공.
  Biome, 전체 TypeScript, **342/342 테스트** (AUTH-02 host **57/57**), 두 앱 빌드 성공.
- 이후 probe 진단 필드와 temp-file 권한 처리 정리를 반영하고 변경 범위 Biome,
  launcher TypeScript, host **57/57**, `node --check scripts/auth-smoke.mjs` 재검증 성공.
- 브라우저 테스트는 실제 loopback HTTP listener/request를 사용했다. 바인딩 순서, 유효/잘못된
  callback, host/state/path/method 제한, bind 실패, browser-open 실패, 동시 시도, 취소/idle
  socket 정리, timeout/포트 해제를 검증했다. 시스템 브라우저 실행은 주입 경계로 모의했다.
- 저장 테스트는 실제 파일/rename/권한 검사를 사용하고 OS 암호화 경계에 독립 AES-GCM 모형을
  주입했다. 평문/unknown backend 거부, 계정 범위, 교체 실패 시 이전 값 보존, 재인스턴스 읽기,
  큐 순서, 손상·크기·symlink/hardlink 거부를 검증했다. OS 암호화 성공 증거는 아니다.
- 실제 Electron `reject-basic --data-dir /tmp/torchlauncher-auth-02-probe` — 성공:
  `plaintextRejected: true`, `liveAuthentication: false`.
- 실제 Electron `probe` — 예상되는 안전한 실패(exit 1): `backend: basic_text`,
  `encryptionAvailable: false`, `code: secure_storage_unavailable`. 자격 증명은 기록하지 않았다.
  이 환경에서 storage-cycle과 실계정 cycle 성공을 주장하지 않는다.

다음 필요한 증거는 Windows에서 `probe`, `storage-cycle`, 자체 앱을 사용한 실제 `cycle` 결과다.
그 결과가 오기 전에는 **AUTH-02 전체 완료로 처리하지 않는다**. 통합/완료 판단은 #0 소유이며
이 작업 외 후속 작업은 시작하지 않았다.
