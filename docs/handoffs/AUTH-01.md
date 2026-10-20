# AUTH-01 — Microsoft 인증 코어 인계

- 세션: `launcher develop #4` (TorchLauncher worker #4)
- 브랜치/worktree: `feat/auth-01-microsoft`, `.agents/worktrees/agent-4`
- 실제 기준: `866e194` (`docs: assign parallel implementation workstreams`)
- 구현 커밋: `9766d7de844d2e229645ee9e3de15a73eb290d27`
- 최종 인계 커밋: 자기 참조를 피하기 위해 최종 세션 응답에 기록한다.
  브랜치에서 `git log -1 -- docs/handoffs/AUTH-01.md`로도 확인할 수 있다.
- 수정 범위: `packages/core/src/auth/**`, 이 인계 문서만.
  공유 manifest/export/lockfile/IPC, `main`, 진행 문서는 수정하지 않았다.

## 구현과 연결 계약

`MicrosoftAuthenticator`는 필수 `clientId`, `redirectUri`, `browser`, `storage`와 선택
`fetch`, `now`, `timeoutMs`를 받는다. 기본 클라이언트 ID, 타 런처 ID, 클라이언트 secret,
자격 증명, 실제 계정 fixture는 없다. 테스트 ID와 토큰은 합성 값이다.

- `login(signal?)`: 시스템 브라우저 어댑터 → OAuth authorization code + PKCE S256 →
  Microsoft 토큰 → Xbox User Token → XSTS → Minecraft 토큰 → Java entitlement → 프로필.
- `refresh(signal?)`: 저장한 Microsoft refresh token으로 전체 하위 흐름을 다시 수행한다.
  매번 소유권/플레이 권한과 초기화된 Java 프로필을 확인하며 오프라인 계정을 생성하지 않는다.
- `logout()`: 진행 중인 작업을 취소하고 이미 시작된 원자적 저장이 끝난 뒤 저장 값을 지운다.
  브라우저 쿠키, Microsoft 동의, 이미 발급된 다른 사본의 access token은 철회하지 않는
  **로컬 로그아웃**이다. 호출자는 보유한 실행 결과도 버려야 한다.
- 실행 결과는 #0이 승인한 다음 계약이다. `expiresAt`은 Unix epoch **밀리초**,
  `profile.id`는 하이픈 없는 소문자 UUID이며 `xuid`는 서비스가 제공할 때만 포함한다.

```ts
interface MinecraftAuthResult {
  accessToken: string;
  expiresAt: number;
  profile: { id: string; name: string };
  userType: 'msa';
  clientId: string;
  xuid?: string;
}
```

결과는 main 프로세스/게임 실행기로만 전달하고 renderer IPC나 로그로 그대로 보내지 않는다.
`auth/index.ts`가 내부 진입점이며 패키지 루트 및 subpath 공개 export는 추가하지 않았다.
후속 연결 작업에서 #0이 export 수정 담당을 지정해야 한다.

`AuthenticationBrowser.authorize({url, redirectUri, signal})`은 loopback listener를 먼저
바인딩하고 시스템 브라우저를 연 뒤 전체 콜백 URL을 반환해야 한다. listener와 포트 선택,
취소 시 자원 회수는 후속 Electron 어댑터 소유다. 코어는 HTTP loopback host만 허용하고
origin/port/path/state, 중복 code/state/error, fragment, userinfo를 검사한다.
PKCE verifier와 state는 시도마다 암호학적 난수로 만들며 유효하지 않은 콜백은 교환하지 않는다.

`MicrosoftTokenStorage`는 main 프로세스의 OS 자격 증명 저장소/암호화 어댑터다.
`read(key)`, `write(key, {version:1, refreshToken})`, `clear(key)`를 구현하고 원자적 교체와
실패 전파를 보장해야 한다. 평문 fallback은 제공하지 않는다. 키는
`torchlauncher.microsoft.<소문자 clientId>`이며 Minecraft/Xbox access token은 저장하지 않는다.
하위 Xbox/Minecraft 오류로 회전된 refresh token을 잃지 않도록 OAuth 성공 직후 저장한다.
따라서 저장 값의 존재 자체는 로그인/소유권 확인 성공을 뜻하지 않는다.
`invalid_grant`나 잘못된 저장 값은 지우고, 일시적인 네트워크 실패에는 값을 보존한다.

동시 로그인/갱신은 `busy`로 거부하며 logout이 늦은 콜백/저장으로 되살아나지 않게 처리한다.
동일 키에는 authenticator 하나를 공유해야 한다. 프로세스 간 잠금과 OS 저장소 가용성은
호스트 책임이다. 저장소 작업은 원자성을 위해 강제로 중단하지 않으므로 어댑터가 자체적으로
유한 시간 안에 완료/실패해야 한다. 기본 네트워크/브라우저 작업 제한은 전체 5분이다.

오류는 `AuthenticationError`의 code/stage/status/숫자 Xbox 오류만 노출한다. 원격 설명,
응답 본문, redirect URL과 원본 exception cause는 전달하지 않는다. HTTP redirect는 거부하고,
응답 본문은 256 KiB로 제한하며 취소 시 읽는 스트림도 닫는다. grant 교환 자동 재시도는 없다.

## 앱 등록 확인과 외부 미검증 사항

1. TorchLauncher 발행자 소유 Microsoft Entra 앱 등록과 그 Application (client) ID가 필요하다.
   Xbox 문서는 개인 Microsoft 계정 유형을 안내하며, 코어는 `consumers` authority를 사용한다.
   [Microsoft Xbox 인증 문서](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication).
2. 공개 desktop client로 시스템 브라우저 loopback redirect를 등록하고 실제 앱 설정과 맞춰야 한다.
   client secret은 desktop 배포물에 넣지 않는다. 코어의 요청 scope는
   `XboxLive.signin offline_access`이며 authorization code + PKCE를 사용한다.
   [Microsoft OAuth protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
   [Desktop 구성](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration),
   [Redirect URI 제약](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).
3. 등록한 client ID로 Xbox와 Minecraft Services 호출이 허용되는지 **별도 확인이 필요하다**.
   Entra 앱 등록 성공을 Minecraft 접근 승인으로 간주하지 않는다. 이번 조사에서 현행 승인
   접수 경로를 보장하는 공식 Minecraft 문서는 확보하지 못했으므로 오래된 신청 양식이나
   커뮤니티 답변을 확정 절차로 기록하지 않았다. 등록 담당자가 Microsoft/Mojang에 현재
   Minecraft API 접근 조건을 확인해야 한다. Minecraft HTTP 403은 상태/단계를 유지한
   `http_failed`로 보고하며 본문 문자열만으로 승인 여부를 추정하지 않는다.
4. 실제 테스트에는 해당 앱, Minecraft Java 플레이 권한과 프로필을 가진 동의 가능한 계정,
   시스템 브라우저/안전 저장 어댑터가 필요하다. 이 입력과 어댑터는 제공되지 않았다.
   실제 OAuth, 재시작 후 안전 저장, 토큰 회전/철회, 연령/지역 제한, 세 OS 실행은 미검증이다.

Microsoft 문서는 OAuth/Xbox 흐름의 근거다. Minecraft 단계는 현재 공개 런처 구현을
프로토콜 관찰 자료로 확인해 `POST /launcher/login` (`xtoken`, `platform: PC_LAUNCHER`),
`GET /entitlements/license?requestId=UUID`, `GET /minecraft/profile`을 사용했다.
Java entitlement 이름 `game_minecraft` 또는 `product_minecraft`와 프로필을 모두 요구한다.
이는 공식 Minecraft API 안정성 보장이 아니며 실제 계정으로 재검증해야 한다.
구 API로 자동 우회하거나 타 런처 ID를 사용하지 않는다. entitlement는 인증된 HTTPS 응답으로
검사하며 오프라인 검증이나 응답 내 서명에 대한 별도 암호학적 검증은 구현하지 않았다.

확인한 구현 자료는 PrismLauncher `77f2bee593eb9e0cdeef530e0e8686524b68d9d9`의
[토큰 교환](https://github.com/PrismLauncher/PrismLauncher/blob/77f2bee593eb9e0cdeef530e0e8686524b68d9d9/launcher/minecraft/auth/steps/LauncherLoginStep.cpp),
[entitlement 요청](https://github.com/PrismLauncher/PrismLauncher/blob/77f2bee593eb9e0cdeef530e0e8686524b68d9d9/launcher/minecraft/auth/steps/EntitlementsStep.cpp),
[응답 구조](https://github.com/PrismLauncher/PrismLauncher/blob/77f2bee593eb9e0cdeef530e0e8686524b68d9d9/launcher/minecraft/auth/Parsers.cpp)다.
외부 소스 코드를 이식하지 않았으며 endpoint/응답 구조만 참고해 독립 구현했다.

## 검증

환경: Linux/WSL, Node `v24.21.0`, pnpm `10.34.7`.
이 worktree에 `pnpm install --frozen-lockfile`로 별도 `node_modules`를 설치했다.
기본 store 디렉터리 생성 제한으로 첫 설치가 실패한 뒤 sandbox 승인을 받아 재실행해 성공했다.
Windows pnpm 경로 대신 `/tmp/torchlauncher-tools/node_modules/.bin`을 PATH 앞에 놓았다.

- `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH pnpm check` — **성공**.
  Biome, 모든 workspace TypeScript, Vitest **93/93** (인증 **81/81**), 두 앱 build 성공.
- 인증 테스트: PKCE와 state/redirect 검증, 반복 로그인 난수 분리, refresh 회전 및 회전 생략,
  철회/네트워크 오류에서의 저장 정책, 계정 제한, 소유권/프로필 부재, 잘못된 응답/HTTP 오류,
  만료, 본문 크기 제한, secret 오류 노출 방지, 저장 실패, 취소/timeout, 스트림 취소,
  logout과 늦은 콜백/원자 저장 경합을 모두 모의 응답으로 검증했다.
- 실제 Microsoft/Minecraft 서버로 로그인 요청을 보내지 않았으며 모의 성공을 실계정 성공으로
  취급하지 않는다. UI/IPC, 패키징/OS 안전 저장, 실제 게임 실행 smoke는 이번 범위에 없다.

완료 판단과 통합 검증은 #0 소유다. AUTH-01 이외 후속 작업에는 착수하지 않았다.
