# L2a 후속 + L3 스킨 병렬 배정

2026-10-23 사용자 직접 승인. 운영자 브랜딩/배포 자산 형식/Studio는 이번 작업에서 제외한다.
드래그 제거 `4179715`는 먼저 통합했다. 두 작업은 공용 파일 소유자를 한 명으로 정해 병렬 진행한다.

## 작업자와 독점 범위

- #2 `launcher_followups`, `feat/launcher-l2a-followups`, agent-2: GPT-6 Astra medium 요청.
  사용자 정책에 따라 파일 삭제 안전 경계 작업에만 상위 모델을 사용한다.
  독점: launcher `src/main/product/**`, `src/main/index.ts`, `src/shared/product.ts`, 필요한
  `src/main/product/ipc*`/preload 최소 연동, renderer `pages/{Mods,Settings,Logs,PageFrame}.tsx`,
  `App.tsx`, `components/Menu.tsx`의 아바타 prop 전달만, 새 미등록 파일 확인 창,
  관련 renderer 테스트/fixtures/i18n 키/기본 스타일, `scripts/renderer-functional-smoke.mjs`,
  `docs/handoffs/LAUNCHER-L2A-FOLLOWUPS.md`.
  검토 중 추가 승인: `hooks/useProduct.ts`의 open-logs 읽기 전용 독립 요청만. launch의 pending/inFlight와
  응답 state를 건드리지 않아 실행 중에도 열 수 있게 하며 기존 memory-save 경로는 유지한다.
- #3 `player_skin`, `feat/launcher-player-skin`, agent-3: GPT-6.1 Sol medium 요청.
  독점: 새 launcher `src/main/skins/**`, renderer 새 `components/PlayerAvatar.tsx`·전용 CSS·테스트·fixture,
  `docs/handoffs/LAUNCHER-PLAYER-SKIN.md`. 공용 서비스/상태/메뉴 연결은 #2가 맡는다.
  외부 프로필/PNG 응답 검증은 주의가 필요하므로 Sol을 사용한다. 인증 토큰 흐름은 변경하지 않는다.

model/effort는 spawn 도구에 명시적으로 요청한다. 화면의 실제 실행 설정은 #0이 직접 확인할 수 없어
‘요청’과 ‘실제 확인’을 구분한다. 사용자가 계속 low로 보인다고 하면 실제 설정 불일치로 조사한다.
추가 작업자는 만들지 않는다. 새 의존성·root config·lockfile·core 변경은 별도 조정한다.

## L2a 후속

- `open-logs`: 인자 없는 좁은 IPC. main이 현재 서버의 고정 logs 경로를 검증해 연다.
  외부에서 경로/URL/명령을 받지 않는다. 경로 이탈·symlink/junction·존재하지 않는 폴더는 안전하게 실패한다.
  게임 실행 중에도 읽기 전용 열기가 가능하며 파일/폴더를 새로 만들거나 프로세스를 중단하지 않는다.
- 서버 데이터 루트를 상태에 포함해 설정 위치를 삭제 미리보기 없이 표시한다. 미설치/미조회도 구분한다.
- 별도 `remove-unregistered` 명령으로 기존 core `removeUnregistered`를 호출한다.
  대상은 정확한 `mods/` 아래 파일뿐이며 .jar 외의 미등록 파일도 지원한다. 등록/운영자 파일은 거부한다.
  앱 안에서 대상을 확인하고 명시 요청한다. 게임/설치 잠금·재조회·경로/소유권 안전 경계는 유지한다.
  사용자 실제 파일을 검사 목적으로 삭제하지 않는다. 테스트는 임시 fixture만 사용한다.
- 사용자 문구는 i18n, 단일 서버/텍스트 선택·끌기 차단/기존 확인·진행 정책 유지.
  모드 파일 크기/팩 이름/로그 시각 등 추가 상태 확장은 이번에 하지 않는다.

## 스킨 모듈 계약 (#3 → #2)

```ts
// src/main/skins/index.ts
export function createPlayerSkinService(): {
  get(profileId: string, signal?: AbortSignal): Promise<string | null>;
  clear(): void;
};
// components/PlayerAvatar.tsx
export function PlayerAvatar(props: {name: string | null; label: string; skin?: string}): ReactNode;
```

`skin`은 검증·정규화한 PNG data URL(상한 있는 문자열)이다. 반환은 전체 64x64 또는 legacy64x32
스킨이며 renderer는 얼굴(8,8,8,8)과 모자(40,8,8,8)를 투명 레이어로 겹쳐 픽셀 그대로 표시한다.
외부 URL·원본 응답·UUID·토큰을 renderer에 보내지 않는다. 고정 Mojang session 서버에서 UUID로
texture를 조회하고 texture 호스트/경로만 허용한다. 크기·형식·프로필 일치·시간 제한·redirect를 검증한다.
PNG는 디코드 전에 헤더/최대 바이트/치수를 검사하고 실제 디코드도 검증한다. 새 이미지 라이브러리는 쓰지 않는다.
성공은 제한된 TTL/개수의 메모리 캐시, 실패/오프라인은 null. 캐시가 영구 디스크 저장이라고 표현하지 않는다.
clear는 캐시와 진행 요청을 지우며 늦게 도착한 응답이 다시 계정/캐시에 반영되지 않게 한다.

#2는 `ProductHost.skins?`에 위 get/clear 인터페이스를 주입하고 production main에서 인스턴스를 만든다.
state는 `account.skin?: string`만 추가한다. 검증된 로그인/복원/게임 인증 결과의 `profile.id`로 비동기
조회하되 로그인/게임 실행을 스킨 때문에 지연하거나 실패시키지 않는다. generation/계정 일치 검사,
로그아웃·인증 실패·종료 clear를 유지한다. UUID/이메일/MS 계정명을 UI에 노출하지 않는다.
Menu의 기존 첫 글자 아바타를 PlayerAvatar로 연결하며 스킨이 없거나 이미지 디코드가 실패하면 기존 첫 글자로 표시한다.

## 통합과 검증

#3 모듈을 먼저 #0이 검토/--no-ff 통합한다. #2는 그 main을 자기 브랜치에 반영해 마지막 production
import/메뉴 연결을 완료한다. 모듈 준비 전에도 #2는 host 주입과 모의 테스트·L2a 기능을 독립적으로 진행한다.
작업자는 자기 브랜치만 커밋·인계하고 main 머지/진행 문서는 #0이 관리한다.
다운로드는 응답 모의 테스트부터, 실제 네트워크 검증이 있으면 공개 fixture/출처만 기록한다.
삭제 범위·잠금·악성 입력, 늦은 스킨 응답/로그아웃/캐시 만료/응답 상한, 64x32/64x64 얼굴·모자·fallback,
서비스/IPC 연결과 화면 동작을 검증한다. #0이 통합 main에서 pnpm check 및 필요한 Electron smoke를 실행한다.
Windows 사용자 확인과 실제 로그인은 준비된 결과 이후 필요한 범위만 요청한다.
