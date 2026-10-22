# TorchLauncher 단일 배포 규격 v1.0 / v1.1 / v1.2

FMT-01 계약과 BRAND-CORE-01 브랜딩 확장. 통합 승인은 #0이 담당한다. 구현 계약은
`packages/core/src/deployment/contracts/`, reader와 writer는 인접 모듈에 있다. 브랜딩 런타임·캐시·UI는 후속 작업이다.
아키텍처의 미확정 바이너리 규격은 이 문서를 기준으로 구체화한다.

## 컨테이너와 호환성

권장 확장자는 `.torchpack`이다. 파일은 `[64바이트 헤더][JSON 인덱스][페이로드]` 하나로
구성한다. 모든 정수는 unsigned little-endian이다. HTTP byte range는 파일 시작 기준이며
끝을 포함한다. 헤더 요청은 `bytes=0-63`, 인덱스 요청은 `bytes=64-(63+indexLength)`이다.

| 바이트 위치 | 길이 | 의미 |
| --- | --- | --- |
| 0 | 8 | ASCII `TORCHDEP` (`54 4f 52 43 48 44 45 50`) |
| 8 | 2 | major = 1 |
| 10 | 2 | minor = 0 (일반 배포), 1 (브랜딩 확장) 또는 2 (서명 + 브랜딩) |
| 12 | 4 | flags = 0 |
| 16 | 8 | indexLength: 실제 UTF-8 인덱스 바이트 수 |
| 24 | 8 | totalLength: 헤더·인덱스·페이로드를 합친 전체 바이트 수 |
| 32 | 32 | 인덱스 원본 바이트의 SHA-256 (binary digest) |

새 reader는 정확히 1.0, 1.1 또는 1.2이고 flags가 0인 입력만 수락한다. 미래 minor, major, 새로운 필드,
압축 방식 또는 적용 정책을 추측해서 처리하지 않는다. 새 필드나 의미 변경에는 버전 갱신이
필요하다. writer는 헤더와 인덱스에 같은 버전을 기록하며 서로 다른 minor는 거부한다.
브랜딩 입력이 없으면 기존 1.0을 쓰고, 브랜딩 입력이 있으면 빈 객체나 제거만 있어도 1.1을 쓴다.
**이전 런처는 1.1 전체를 거부한다.** 브랜딩 배포 전 런처 업그레이드가 필요하며, 알 수 없는 필드를
무시하거나 이미지 제거 의도를 잃는 자동 1.0 다운그레이드는 하지 않는다. 헤더의 u64는 변환 전에
`Number.MAX_SAFE_INTEGER` 이하인지 검사한다. 계약의 정수는 JavaScript `number`이며
음수·소수·NaN·무한대와 안전하지 않은 정수를 거부한다.

## 인덱스

인덱스는 BOM 없는 strict UTF-8 JSON 객체다. 중복 객체 키와 알 수 없는 필드를 거부한다.
JSON 공백·키 순서는 자유이고 해시는 파싱/재직렬화한 값이 아닌 **저장된 바이트 그대로**
계산한다. writer는 중복 키가 없는 JSON을 생성해야 한다. UTF-8 디코드·JSON 구문/중복 키
검사·헤더 바이너리 해석은 후속 reader의 책임이며 이 작업의 객체 validator에 포함하지 않는다.

```json
{
  "formatVersion": { "major": 1, "minor": 0 },
  "serverId": "11111111-1111-4111-8111-111111111111",
  "deploymentId": "22222222-2222-4222-8222-222222222222",
  "game": {
    "minecraftVersion": "1.21.1",
    "loader": { "kind": "neoforge", "version": "21.1.200" }
  },
  "files": [
    {
      "path": "config/server.toml",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "offset": 0,
      "storedLength": 0,
      "originalLength": 0,
      "compression": "none",
      "policy": "initial-only"
    }
  ]
}
```

- `serverId`: 소문자 UUID v4. Studio 프로젝트 생성 시 한 번 생성하고 실행 파일 이동·환경
  업데이트·배포 링크 교체 후에도 유지한다. 런처의 신뢰된 서버 설정과 반드시 일치해야 한다.
  다른 서버의 인덱스로 현재 서버의 파일을 수정하거나 삭제하지 않는다.
- `deploymentId`: 생성할 때마다 새로 발급하는 소문자 UUID v4. 동일 바이트를 재배포할 때는
  유지한다. 시간순 정렬이나 업데이트 서열을 뜻하지 않으며 rollback 방지 수단이 아니다.
- `game.minecraftVersion`, `game.loader.version`: 1–64자의 ASCII 버전 토큰
  `[A-Za-z0-9][A-Za-z0-9._+\-]*`. `loader.kind`는 `fabric` 또는 `neoforge`다.
  문법 검증 성공은 해당 Minecraft/로더 조합의 지원·호환성 검증을 뜻하지 않는다.
- `files`: 운영자가 제공하는 일반 파일 목록. 디렉터리·심볼릭 링크·하드 링크·실행 권한
  메타데이터는 표현하지 않는다. 빈 목록도 유효하다. 서버 이름·접속 주소·브랜딩·공개 URL은
  별도 전용 런처/Studio 설정이다. 이미지 갱신만 v1.1의 선택 역할로 제공하며 아래 규칙을 따른다.
- `sha256`: 압축 해제 후 원본 파일의 SHA-256, 소문자 64자리 hex.
- `offset`: **페이로드 시작점 기준** 위치. 절대 위치는 `64 + indexLength + offset`이다.
  인덱스 길이가 변해도 상대 offset은 변하지 않으므로 writer의 직렬화 순환 의존이 없다.
- `storedLength`: 저장 구간 길이. `originalLength`: 압축 해제 후 정확한 파일 길이.
- `compression`: `none` 또는 `gzip`. gzip은 각 파일당 독립된 RFC 1952 단일 member로
  저장하고 연결된 member·뒤따르는 데이터는 거부한다. gzip 압축 해제 중에도 원본 길이
  제한을 적용한다. `none`은 저장 길이와 원본 길이가 같아야 한다.
- `policy`: `initial-only`는 최초 환경 구성에만 제공하고 이후 수정·삭제한 개인 설정을
  복구하거나 덮어쓰지 않는다. `always`는 운영자의 최신 내용에 맞춰 관리한다.
  동일 파일의 항목별 혼합 정책·리소스팩 활성화/순서·모드 ID는 v1에 없다. 혼합 설정을
  `always`로 배포해 개인 설정을 덮어쓰는 대체 구현을 하지 않는다. USER-02에서 확장한다.
  최초 제공한 `initial-only` 파일은 이후 배포에서 빠져도 사용자 파일로 보존한다.
  같은 경로의 정책 전환을 자동 덮어쓰기·삭제 허가로 해석하지 않는다. 구체적인 전환과
  충돌 처리는 SYNC-01/USER-02에서 확정하고, 미지원 전환은 명시적으로 거부한다.

일반 파일 목록 순서가 페이로드의 앞부분 순서다. 첫 offset은 0, 이후 offset은 이전 offset + storedLength다.
v1.1에서는 일반 파일 다음에 icon, background 순서로 실재하는 브랜딩 자산을 이어 붙인다.
빈 파일은 길이 0의 구간과 빈 바이트의 알려진 SHA-256으로 표현하며 `none`만 허용한다.
중복·겹침·빈틈·미참조 데이터·
trailer는 허용하지 않는다. 마지막 구간 끝은 `totalLength - 64 - indexLength`와 같아야 한다.
v1.0은 일반 파일, v1.1은 일반 파일과 실재하는 브랜딩 자산 전체를 대상으로 이 경계를 검사한다.
빈 파일은 HTTP 요청을 만들지 않고 로컬에서 빈 바이트의 해시를 검사한다. 비어 있지 않은
파일의 HTTP 범위는 `[absoluteOffset, absoluteOffset + storedLength - 1]`이다.

## 이식 가능한 경로와 소유권

경로는 서버별 **게임 디렉터리 기준** slash-separated 상대 경로다. 한글 등 Unicode
파일명을 지원하며 **인덱스에 기록한 문자열 자체가 NFC**여야 한다. writer는 원본 경로를
NFC로 변환해 기록하되, 원본의 서로 다른 이름이 같은 대상이 되면 생성 단계에서 충돌로
거부한다. validator/reader는 non-NFC 입력을 조용히 바꾸지 않고 거부한다. 예를 들어
`resourcepacks/서버 리소스팩.zip`, `config/한글/설정.toml`, `config/é.txt`는 유효하고
분해된 자모나 `e` + combining acute로 표현한 동일 이름은 인덱스에서 거부한다.

길이는 **UTF-8 바이트 수**로 계산한다. 전체 경로는 slash를 포함해 1–240바이트, 각
구성 요소는 1–120바이트다. 한글 40글자는 120바이트로 허용되며 41글자 구성 요소는
거부된다. 구성 요소에는 Unicode 문자·결합 문자·숫자·구두점·기호(범주 L/M/N/P/S)와
ASCII 공백을 허용한다. Windows 금지 문자 `< > : " \\ | ? *`와 `%`는 추가로 거부한다.
구성 요소의 앞/뒤 공백, 뒤의 점, `.`·`..`, 절대 경로, drive/UNC 경로, backslash,
빈 구성 요소, 제어/서식 문자(예: bidi override·zero-width joiner), 고립 surrogate,
private-use/미할당 문자, ASCII 공백 이외의 구분 공백도 거부한다.

Windows 예약 이름 `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`,
`CONIN$`, `CONOUT$`는 확장자와 대소문자에 관계없이 각 구성 요소에서 거부한다.
Windows device alias인 `COM¹`/`COM²`/`COM³`, `LPT¹`/`LPT²`/`LPT³`와
확장자 앞 공백이 있는 예약 이름(`NUL .txt`)도 거부한다.
위 첨자 숫자 예약 이름은 [Microsoft 파일명 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)을 따른다.
`.torchlauncher`로 시작하는 최상위 구성 요소는 런처 내부용으로 예약한다.
충돌 키는 locale에 의존하지 않는 JavaScript 연산
`path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')`로 만든다.
이 보수적인 키로 중복 경로와 파일/하위 경로 충돌(`config`와 `config/a`)을 양방향으로
거부한다. `É`/`é`, `straße`/`STRASSE`, Greek sigma의 두 소문자, case 변환 후 다시
NFC가 필요한 이름도 충돌로 처리한다. 이 키는 원본 경로나 저장 파일명을 바꾸지 않으며
모든 OS의 실제 파일 시스템 비교 규칙을 그대로 재현한다는 의미도 아니다.

파싱 성공은 디스크 쓰기 권한을 뜻하지 않는다. 적용자는 실제 루트 containment와 기존
심볼릭 링크/reparse point를 검사하고, Java·Minecraft 설치 파일 및 런처/자격 증명 저장소와
충돌하는 대상은 거부해야 한다. 삭제는 이전 운영자 관리 목록에 근거하며 사용자 모드와
미등록 파일을 이 목록에 편입하지 않는다. 디스크 소유권·원자적 적용·복구는 SYNC-01,
사용자 모드 충돌은 USER-01에서 결정한다. 계약 validator는 파일 시스템을 접근하지 않는다.

## v1 하드 제한

| 항목 | 상한 |
| --- | --- |
| UTF-8 인덱스 | 16 MiB (0은 불가) |
| 파일 개수 | 100,000 |
| 전체 컨테이너 | 64 GiB |
| 파일별 저장 길이 / 원본 길이 | 각각 4 GiB |
| 전체 원본 길이 합 | 128 GiB |
| gzip 원본 길이 / 저장 길이 | 1,000 이하 |

MiB/GiB는 2의 거듭제곱이다. gzip 저장 길이·원본 길이는 모두 1 이상이다. 제한보다 작은
로컬 운영 예산을 추가할 수 있지만 이 규격 한도를 완화하지 않는다. 헤더의 인덱스 길이는
할당 전에 검사하고, 실제 응답 길이는 헤더와 일치해야 한다. gzip 실제 출력이 원본 길이를
초과하면 즉시 중단하고 정확한 최종 길이·해시·단일 member 여부를 확인한다.

## 무결성·신뢰·원격 교체

v1은 **서명되지 않은 배포 규격**이다. 헤더의 인덱스 해시와 파일 해시는 손상 감지 수단이며
공격자가 인덱스와 해시를 함께 바꿀 수 있는 경우 배포자를 인증하지 않는다. 운영자가 고른
공개 HTTPS 배포처와 런처에 포함한 서버 식별자를 신뢰 기준으로 삼는다. HTTP 평문이나
HTTPS에서 HTTP로의 redirect는 허용하지 않는다. 서버 ID 일치는 다른 서버의 실수 방지이며
암호학적 인증은 아니다. 인증 토큰·개인 키·배포처 계정 자격 증명은 담지 않는다.

독립적인 publisher 인증/rollback 방지가 필요한 환경은 신뢰된 외부 채널로 얻은 인덱스
해시를 추가 pin하거나 후속 서명 버전을 사용해야 한다. 동일한 원격 파일에서 받은 해시를
신뢰 anchor로 취급하지 않는다. 외부 pin의 배포·갱신이나 키 관리는 FMT-01에서 구현하지 않는다.

reader는 헤더 → 인덱스 → 필요한 페이로드 순서로 읽고, 인덱스 SHA-256을 확인한 뒤
`validateDeploymentIndex`로 필드·경로·레이아웃을 검증한다. 런처의 expectedServerId와
컨테이너 totalLength를 함께 검증한다. strong ETag 등 동일 원격 버전 조건을 전송 계층에
전달한다. 일관된 버전을 보장하지 못하거나 길이·해시가 바뀌면 다운로드를 폐기하고 인덱스부터
다시 확인한다. ETag가 없어도 인덱스/파일 해시와 길이 검사는 생략하지 않는다. 해시가 모두
일치하는 데이터만 해당 인덱스의 배포로 사용할 수 있다. 검증 전 기존 환경을 수정하지 않는다.
전송 계층은 206·Content-Range·본문 길이를 검사하며 Range 무시에 조용히 전체 다운로드로
전환하지 않는다. reader는 실제 다운로드·검증·압축 해제·scratch 저장을 수행하고, sync가 게임 파일 적용을 담당한다.

## 코드 계약과 검증 예제

- `DeploymentHeader`, `DeploymentIndex`, `DeploymentFile`, 버전/크기 상수: `types.ts`.
- `validateDeploymentHeader(unknown)`: 디코드된 헤더 객체의 정확한 필드·버전·길이 검사.
  `magic`은 디코드된 문자열, `indexSha256`는 32바이트를 변환한 소문자 hex다.
- `validateDeploymentIndex(unknown, header, { expectedServerId })`: 객체 문법, 서버 일치,
  경로·레이아웃·크기 검사 후 타입이 좁혀진 객체를 반환한다. 인수 header도 재검증한다.
- `getDeploymentFileRange(header, file)`: 검증된 계약을 받아 inclusive range 또는 빈 파일의
  `null`을 반환한다. 전체 인덱스 검증을 대체하지 않는다.
- 실패는 `DeploymentValidationError`이며 `code`와 문제 위치 `field`를 제공한다.
  검증 성공 객체는 입력 자체이므로 caller는 검증 이후 수정하지 않아야 한다.

내부 모듈은 `./deployment/contracts/index.js`에서 가져올 수 있다. 패키지 public subpath와
루트 export 추가는 #0의 후속 공유 파일 배정 대상이며 이번 작업에서 수정하지 않는다.
`fixtures/valid.ts`의 두 로더 예제와 인접 테스트는 writer/reader가 재사용할 계약 예제다.
테스트는 잘못된 버전·경로/alias·범위·길이·압축/해시 문법·서버 ID를 거부하는지 검증한다.
바이너리 인코딩/디코딩과 실제 gzip/해시 검증은 인접 reader/writer 테스트에서 검증한다.
실서버/Windows·이미지 실제 디코드와 UI/캐시는 BRAND-CORE-01의 검증 범위가 아니다.


## v1.1 브랜딩 전용 페이로드

v1.1 인덱스는 필수 `branding` 객체를 추가한다. 객체에는 `icon`, `background`만 허용하며
각 역할은 생략, `null`, 자산 descriptor 중 하나다. v1.0에서는 `branding` 필드를 거부한다.
앱 이름은 원격으로 바꾸지 않는다.

```json
{
  "branding": {
    "icon": {
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "offset": 123,
      "storedLength": 456,
      "originalLength": 456,
      "compression": "none",
      "mediaType": "image/png"
    },
    "background": null
  }
}
```

위 descriptor는 구조 예시이며 offset/해시는 실제 페이로드와 맞춰야 한다. 이미지 역할은 게임
경로·적용 정책을 갖지 않고 일반 `files` 목록, 동기화 원장, 게임 준비 검사에 편입되지 않는다.
자산 개수는 최대 2개이며 임의 역할·추가 필드를 거부한다. `files`의 100,000개 제한은 유지한다.

- 기존 v1.0/`branding` 미지원: 현재 표시 유지.
- v1.1의 `branding: {}` 또는 생략한 역할: 해당 역할 현재 표시 유지.
- 역할 값 `null`: 기본 표시로 전환하는 명시적 의도. 페이로드 없음. 런타임은 제거 상태를
  tombstone으로 지속 저장해 다음 시작에서 동봉 이미지가 다시 나타나지 않게 한다.
- descriptor: 마지막 검증본과 해시를 비교하고, 바뀐 역할만 받는다. 검증/디코드가 끝날 때까지
  기존 표시를 유지한다. 역할 이름이나 파일 경로로 이미지를 조회하지 않는다.

이미지에는 길이 0을 허용하지 않는다. PNG/JPEG는 이미 압축된 데이터이므로 v1.1 이미지
`compression`은 `none`만 허용하고 저장/원본 길이가 같아야 한다. 원본 바이트 해시·안전한 정수·
전체 컨테이너/원본 합 제한도 동일하게 검사한다. 게임 파일 뒤에 **icon → background** 순서로
실재하는 descriptor를 배치한다. JSON 키 순서는 자유다. null/생략은 범위를 소비하지 않는다.
전체 일반 파일·이미지의 offset을 단일 cursor로 검사하므로 교차 중첩·빈틈·미참조 trailer를 거부한다.

| 역할 | 형식 | 인코딩 길이 | 너비 × 높이 | 픽셀 수 |
| --- | --- | --- | --- | --- |
| icon | PNG | 1 MiB 이하 | 512 × 512 이하 | 262,144 이하 |
| background | PNG/JPEG | 8 MiB 이하 | 3840 × 2160 이하 | 8,294,400 이하 |

`branding/index.ts`의 순수 `inspectBrandingImage(role, mediaType, bytes)`는 크기 제한 내 PNG
signature/IHDR와 JPEG marker/SOF를 경계 검사하며 차원을 확인한다. 픽셀 데이터·완전한 이미지
무결성·실제 디코드 성공을 보장하지 않는다. Studio와 런처는 실제 디코드와 동일 차원/픽셀 상한을
검사한 뒤 저장/표시해야 한다. descriptor 검증만으로 image header를 확인할 수는 없다.

`openDeploymentReader`는 기존 `DeploymentReader`를 확장한 `BrandingDeploymentReader`를 반환한다.
`stageBrandingAsset(role, newScratchPath, options?)`는 해당 역할의 검증 바이트만 새 파일로 저장하고
`{role, outputPath, length, sha256}`을 반환한다. 기존 `stageFile(path, ...)`는 게임 `files`만 찾는다.
기존 reader 인터페이스와 주입 mock에는 새 필수 메서드를 넣지 않았다. 주입형 소비자는 확장 인터페이스를
요구하거나 메서드 존재를 확인해야 한다. null/없는 역할은 `branding-not-found`이며 요청을 만들지 않는다.
두 경로 모두 동일 source ID/generation/snapshot pin, chunk 범위 제한, 해시, 길이, 취소 및 scratch
정리 규칙을 사용한다. 작은 `maxFileBytes`/`maxStoredFileBytes` 운영 예산은 이미지에도 적용된다.

`writeDeployment` 입력에 `branding?: {icon?: {bytes, mediaType} | null, background?: ...}`를 둔다.
writer는 첫 await 전에 제한 크기를 확인하고 `Uint8Array`를 복사한 후 header/차원을 검사하고 해시를
계산한다. 선택 파일은 Studio가 안전하게 읽고 실제 디코드한 bounded 스냅샷으로 전달한다. 같은 스냅샷을
로컬 sidecar로도 내보낸다. 원본 파일을 나중에 다시 읽어 두 출력의 이미지가 달라지게 하지 않는다.
writer는 게임 파일의 기존 안전한 root 상대경로 스트리밍을 그대로 유지한다.

## 프로파일 v1 선택 브랜딩

`torchlauncher-server.json`의 선택 `branding`은 `{appName?, icon?, background?}`다. 각 이미지
참조는 `{path, sha256, length, mediaType}`이며 위 해시/길이/형식 제한을 적용한다. `path`는 위
portable 경로 규칙을 적용한 NFC 상대 경로이며 **실제 프로파일 JSON 디렉터리**를 기준으로 해석한다.
실행 파일 디렉터리나 게임 루트가 아니다. 바이트·data URL을 JSON에 넣지 않으며 기존 앱의 16 KiB
설정 파일 읽기 제한을 늘리지 않는다. 로컬 이미지 생략은 기본 표시이며 `null`은 허용하지 않는다.
`appName`은 trim된 1–40 Unicode code point이고 제어/서식/고립 surrogate를 거부한다. 창 제목·메뉴
표시에만 쓰며 `app.setName`, appId, userData, 인증 캐시, 홈 서버 이름, 시작 TorchLauncher 로고와
EXE 아이콘은 변경하지 않는다. 생략하면 기존 제목/메뉴 표시를 유지한다.

새 parser는 브랜딩 없는 기존 v1 프로파일을 계속 읽지만 이전 strict parser는 새 필드를 거부한다.
JSON 구조·필드·unsafe 경로 등 계약 오류는 프로파일 오류다. 구조상 올바른 참조의 파일 누락·hash 불일치·
실제 decode 실패는 런타임 자산 실패이며 기본/이전 표시를 유지해야 한다. 런타임은 symlink/hardlink와
실제 root 이탈을 거부하고 게임 데이터 밖 캐시를 서버 ID·프로파일 기준으로 분리한다. 원격 전체 인덱스가
잘못되면 여전히 reader 오류다. 이미지 fetch/decode 실패를 게임 실패로 연결하지 않는다.
프로파일/배포 해시는 무결성 검사이며 운영자 진위 서명이나 rollback 방지를 제공하지 않는다.


## v1.2 서명 컨테이너 (SIGN-CORE-01)

정책·위협 모델·롤백 방지는 [배포 서명과 롤백 방지 명세](deployment-signing.md)가 기준이다. 여기서는 바이너리 규격과 코드 계약만 기록한다.

- 레이아웃: `[64바이트 헤더][64바이트 Ed25519 서명][JSON 인덱스][페이로드]`. 헤더는 minor = 2, flags = 0이며 나머지 필드는 동일하다.
  `totalLength`는 서명을 포함한 전체 길이다. 인덱스는 절대 위치 `128`부터이고(`bytes=128-(127+indexLength)`), 페이로드 절대 위치는 `128 + indexLength + offset`이다.
  `payloadStart(header) = 64 + (minor === 2 ? 64 : 0) + indexLength`로 모든 범위 계산(`getDeploymentFileRange`, `getDeploymentBrandingRange`)이 공유한다.
- 서명 대상: `"TORCHPACK-SIG-v1\0"`(17바이트, NUL 포함) `||` 헤더 원본 64바이트. 인덱스는 헤더의 SHA-256·길이를 통해 간접 서명된다. 페이로드는 서명 대상이 아니며 인덱스의 파일 해시로 보호된다.
- 인덱스: 1.2는 1.1의 필수 `branding`(생략된 역할 = 현재 표시 유지, writer는 입력이 없으면 `{}`를 기록)에 더해 필수 `sequence`(안전한 정수, 1 이상)를 가진다. `sequence`는 1.0/1.1에서 알 수 없는 필드로 거부한다. 브랜딩 규칙·페이로드 순서는 1.1과 같다.
- reader 검증 순서: 헤더 → (공개 키가 있고 1.0/1.1이면 `signature-required`로 즉시 거부) → 서명 → 인덱스 → 인덱스 SHA-256 = 헤더 값 → 서명 검증 → 그 뒤에야 인덱스 파싱·검증·노출. 검증 전에는 인덱스 내용에 의존하는 요청·스테이징이 없다.
- reader 옵션 `trustedPublicKey`(base64url 32바이트 문자열 또는 raw 32바이트). 형식이 틀리면 요청 전에 `invalid-signing-key`. 결과 `reader.verification`:
  `'verified'`(1.2 + 키 검증 성공), `'unverified'`(1.2 구조 검증만, 키 없음 — 아무도 인증하지 않음), `'unsigned'`(1.0/1.1, 키 불요 구성에서만 가능).
  런처는 구성에 `signing`이 있으면 항상 키를 전달해야 하며, 키가 없을 때의 `unverified`는 서명 도입 전 구성의 호환용이다.
- 오류 코드(`DeploymentReaderError`): `signature-required`(키가 필요한데 서명 없는 1.0/1.1), `signature-invalid`(서명이 해당 키로 검증되지 않음), `signature-malformed`(서명 블록이 64바이트가 아님), `invalid-signing-key`.
  서명 값만으로는 '변조된 헤더·인덱스'와 '다른 키'를 구별할 수 없다(Ed25519 검증은 참/거짓뿐이며 키 ID가 규격에 없음). 둘 다 `signature-invalid`다.
- writer 옵션: `sequence`와 `sign(message) => Buffer | Promise<Buffer>`를 반드시 함께 준다(하나만 있거나 sequence가 안전한 정수 1 이상이 아니면 `invalid-input`). core는 개인 키를 보관하지 않는다.
  반환 서명이 정확히 64바이트가 아니면 `invalid-signature`이고 출력은 만들어지지 않는다. 헬퍼 `createEd25519Signer(privateKey)`, `deriveEd25519PublicKey(privateKey)`는 Studio용이다.
- 서버 구성 `signing`: `{ "algorithm": "ed25519", "publicKey": "<정규 base64url, 43자, 32바이트>" }`. 알 수 없는 algorithm·길이·패딩·비정규 인코딩·추가 필드는 구성 거부. `signing`이 없는 기존 구성은 그대로 유효하다.
- 롤백 판정 순수 함수 `decideRollback(seen | null, incoming)`은 `'accept' | 'reject-lower' | 'reject-conflict'`를 반환한다. 입력은 `{sequence, deploymentId, indexSha256}`이며 잘못된 값은 `TypeError`. 저장·갱신 시점은 런처 책임이다.
- 위 "v1은 서명되지 않은 배포 규격" 서술은 1.0/1.1에 한한다. 1.2에서 신뢰 기준은 서버 구성의 공개 키다.
