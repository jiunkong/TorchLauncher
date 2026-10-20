# FMT-01 인계

- 작업: FMT-01 — 단일 파일 배포 규격과 공유 계약·검증 테스트.
- 담당 세션: `launcher develop #1` (TorchLauncher worker #1).
- 브랜치: `feat/fmt-01-contracts`.
- Worktree: `.agents/worktrees/agent-1`.
- 기준 커밋: `866e194f95487af9353348a72ee03fd0ecbd5987`.
- 구현 커밋: `4a5a92dbd17421a8980fb2c6a3e41b289f834ed3` —
  `feat(core): define deployment v1 contracts and validation`.
- 초기 인계 커밋: `1227e5a6d031b3e979ecf055947916db5b058d58`.
- #0 검토 반영: ASCII-only 제한을 제거하고 NFC Unicode 경로·정규화 충돌·UTF-8 바이트
  제한과 관련 테스트를 추가했다. 최종 커밋은 이 개정도 포함한다.
- 최종 인계 커밋: 이 문서를 포함하는 커밋. 자기 참조를 피하기 위해 정확한 해시는 최종
  응답과 #0에게 보내는 완료 메시지에 별도로 기록한다.
- 통합 상태: 구현 브랜치에서 검증 완료, #0 검토·통합 대기. `main`과 진행 문서 미수정.

## 변경 파일과 계약

- `docs/deployment-format.md`: 64바이트 little-endian 헤더, `TORCHDEP` magic, v1.0/flags=0,
  실제 인덱스 바이트의 SHA-256, strict UTF-8 JSON 인덱스, payload-relative 파일 범위를 명세.
- `packages/core/src/deployment/contracts/types.ts`: 헤더·인덱스·파일·Minecraft/로더·
  정책·압축·inclusive byte range·expected server context·크기 제한.
- `packages/core/src/deployment/contracts/validation.ts`: 객체 schema, 정확한 버전,
  UUIDv4 식별자, 서버 일치, SHA-256 표기, portable NFC Unicode 경로와 alias/prefix 충돌,
  연속 페이로드 범위, 압축/길이/확장량 제한 검증. `DeploymentValidationError`의
  `code`·`field`로 실패를 구분한다.
- `packages/core/src/deployment/contracts/index.ts`: 해당 디렉터리 내부 진입점.
- `packages/core/src/deployment/contracts/fixtures/valid.ts`: Minecraft 1.21.1의 Fabric과
  NeoForge 예제. 실제 SHA-256, plain/gzip/빈 데이터와 JSON 인덱스 바이트를 제공한다.
  포함 데이터는 테스트용이며 실행 가능한 모드가 아니다.
- `packages/core/src/deployment/contracts/validation.test.ts`: 계약 테스트 137개.

호출 예:

```ts
const header = validateDeploymentHeader(decodedHeader);
// reader가 실제 인덱스 길이/해시/UTF-8/중복 JSON 키를 먼저 검사한다.
const index = validateDeploymentIndex(decodedIndex, header, {
  expectedServerId: trustedLauncherConfig.serverId,
});
for (const file of index.files) {
  const range = getDeploymentFileRange(header, file);
  // range === null이면 빈 파일. 그 외 start/endInclusive는 절대 위치.
}
```

헤더의 u64는 reader가 BigInt 상태에서 안전 범위를 확인한 뒤 number로 변환한다.
파일 offset은 페이로드 기준이므로 인덱스 직렬화 길이에 따른 writer 순환 의존이 없다.
파일별 `none`/단일-member `gzip`, `initial-only`/`always`만 지원한다. 빈 파일은 `none`,
길이 0과 빈 SHA-256으로 표현한다. 검증 함수는 입력을 수정하지 않고 같은 객체를 반환하며
계약 필드는 readonly다. 호출자가 검증 후 입력을 변경하지 않아야 한다.

## 검증 결과

환경: Linux x86_64, WSL2 (`6.18.54.1-microsoft-standard-WSL2`), Node.js `24.21.0`,
pnpm `10.34.7`. 명령은 모두 이 worktree에서 수행했다. 중첩 스크립트까지 Linux pnpm을
사용하도록 `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`를 설정했다.

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile --store-dir /tmp/torchlauncher-pnpm-store` | 성공. 전용 node_modules, 354개 패키지, manifest/lockfile 변경 없음 |
| `pnpm exec biome check --write packages/core/src/deployment/contracts` | 성공, 해당 범위만 포맷 적용 |
| 초기 `pnpm test -- packages/core/src/deployment/contracts/validation.test.ts` | 성공. 이 인수 형태에서는 Vitest가 전체 suite를 실행해 당시 118개 통과 |
| Unicode 개정 후 `pnpm exec vitest run packages/core/src/deployment/contracts/validation.test.ts` | 성공, 계약 테스트 137개 통과 |
| `pnpm --filter @torchlauncher/core typecheck` | 성공 |
| Unicode 개정 후 `pnpm check` | lint·모든 앱/core TypeScript·149개 테스트·두 앱 build 성공 |
| `git diff --check` 및 구현 커밋 전 staged diff 검사 | 성공 |

첫 기본 저장소 설치는 `/home/jiun11/.local/share/pnpm` 생성 제한으로 실패했다. #0이
안내한 `/tmp/torchlauncher-pnpm-store`를 명시하여 권한 승인 후 frozen 설치를 완료했다.
이 환경 문제 때문에 저장소 설정이나 의존성을 수정하지 않았다.

## 제한 사항과 후속 책임

- v1은 unsigned다. SHA-256은 손상을 검사하며 독립적인 배포자 인증이나 rollback 방지를
  제공하지 않는다. 신뢰된 HTTPS 배포처와 런처 내 고정 serverId를 기본 경계로 명시했다.
  공격자가 인덱스/해시를 함께 변경하면 해시만으로 인증할 수 없으며, 별도 신뢰 채널의
  index hash pin이나 미래 서명 버전이 필요하다. 키 관리/서명 구현은 포함하지 않았다.
- reader/writer/네트워크/UI/동기화는 미구현이다. 바이너리 파싱, 실제 인덱스 길이/해시,
  strict UTF-8·JSON 중복 키, 206/Content-Range·원격 교체, 실제 gzip member/출력 한도,
  원본 해시 검사와 실제 디스크 적용은 후속 작업의 책임이다. 객체 validator만 호출하고
  이 검사를 완료한 것으로 간주하지 않는다.
- portable v1 경로는 NFC Unicode를 허용하고 UTF-8 바이트 수로 길이를 제한한다.
  인덱스의 non-NFC 입력은 자동 변경하지 않고 거부한다. writer는 원본 경로를 NFC로
  기록하기 전에 정규화 alias를 탐지해 충돌로 거부해야 한다. 충돌 비교는 명세의
  `NFC → toUpperCase → toLowerCase → NFC` 키로 locale에 의존하지 않게 수행한다.
  이는 보수적인 비교 키이며 모든 OS의 실제 파일 시스템 규칙을 재현하지 않는다.
  Windows/macOS의 실제 alias와 심볼릭 링크/reparse point 적용 검증은 수행하지 않았으며,
  문자열 검사로 실제 root containment를 대체할 수 없다. 해당 검증은 reader/apply 책임이다.
- mixed settings·리소스팩 활성화/순서·사용자 모드 ID 충돌·디스크 소유권/복구는 후속
  SYNC-01/USER-01/USER-02에서 다룬다. `initial-only`는 최초 제공 후 수정/삭제/배포에서의
  누락을 보존한다. 미지원 정책 전환을 자동 덮어쓰기/삭제 허가로 해석하지 않는다.
- Minecraft/로더 버전은 토큰 문법만 검사했다. 1.21.1 Fabric/NeoForge 실제 설치·게임 실행,
  Drive 교체, GUI smoke/포터블 패키지, Windows/macOS 실행을 검증한 결과가 아니다.
- 새 의존성·공유 manifest·lockfile·IPC·패키지 루트 export는 변경하지 않았다. 다른 패키지에서
  쓸 public export/subpath는 #0이 후속 공유 파일 작업에 배정해야 한다. core 내부 모듈은
  `deployment/contracts/index.js` 상대 경로로 사용할 수 있다.

규격 초안과 구현 완료 상태는 #0 thread `01a15961-1386-7fd0-bd22-a71aaf70fdd4`에 먼저
전달했다. #0은 v1 prototype 방향을 승인하고 unsigned 신뢰 경계·서버 ID·길이/버전/수치
제한·독립 gzip·빈 파일·portable 경로/충돌을 명시하도록 검토 의견을 보냈다. 해당 조건을
규격과 객체 계약에 반영했으며 실제 byte/decompression 검증은 reader 책임으로 구분했다.
서명/anti-rollback은 출시 정책의 후속 항목이다. 최종 통합·추가 수정 요청·완료 판정은
#0이 담당한다. 이 작업 후 후속 제품 구현을 착수하지 않는다.

#0의 추가 검토 요청으로 한글 리소스팩/설정 이름 지원을 반영했다. 회귀 테스트에는 한글·
악센트·기호가 있는 유효 이름, 분해된 한글/악센트의 NFC alias 거부(양방향), 대소문자·
문자 확장·case 변환 후 NFC 충돌, Unicode 디렉터리/파일 prefix 충돌, 한글을 이용한
정확한 UTF-8 한도와 초과 입력, Unicode 제어/서식/고립 surrogate, Windows 위 첨자
device alias가 포함된다. 디스크 접근과 다른 작업 범위는 추가하지 않았다.
