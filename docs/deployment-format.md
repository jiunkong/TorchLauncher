# TorchLauncher 단일 배포 규격 v1.2

현재 구현 규격은 `packages/core/src/deployment/`가 기준이다. 개발 중 구형 형식 호환은 유지하지 않는다.
서명된 **1.2만 생성·판독**하며 1.0/1.1 입력, 무서명 출력, 자동 형식 전환은 지원하지 않는다.
이전 개발 배포물은 현재 Studio에서 다시 생성·내보내야 한다. 마이그레이션 reader는 제공하지 않는다.

## 컨테이너

확장자는 `.torchpack`이다. `[64바이트 헤더][64바이트 Ed25519 서명][JSON 인덱스][페이로드]`로
구성한다. 모든 정수는 unsigned little-endian이다. HTTP byte range는 파일 시작 기준이며 끝을 포함한다.
헤더는 `bytes=0-63`, 서명은 `bytes=64-127`, 인덱스는 `bytes=128-(127+indexLength)`다.

| 바이트 위치 | 길이 | 의미 |
| --- | --- | --- |
| 0 | 8 | ASCII `TORCHDEP` (`54 4f 52 43 48 44 45 50`) |
| 8 | 2 | major = 1 |
| 10 | 2 | minor = 2 |
| 12 | 4 | flags = 0 |
| 16 | 8 | indexLength: 실제 UTF-8 인덱스 바이트 수 |
| 24 | 8 | totalLength: 헤더·서명·인덱스·페이로드 전체 길이 |
| 32 | 32 | 인덱스 원본 바이트의 SHA-256 (binary digest) |
| 64 | 64 | Ed25519 서명 |

reader는 정확히 1.2와 flags=0만 수락한다. 이전/미래 버전은 헤더 검사에서 거부하며 서명·인덱스나
페이로드를 추가 요청하지 않는다. writer는 헤더와 인덱스 모두 동일한 1.2를 기록한다.
헤더 u64는 `Number.MAX_SAFE_INTEGER` 이하인지 변환 전에 검사한다. 음수·소수·NaN·무한대와
안전하지 않은 정수는 거부한다. 현재 형식은 기능/브랜딩 유무에 따라 바뀌지 않는다.

## 인덱스

인덱스는 BOM 없는 strict UTF-8 JSON 객체다. 중복 객체 키와 알 수 없는 필드를 거부한다.
JSON 공백·키 순서는 자유이고 해시는 파싱/재직렬화한 값이 아닌 **저장된 바이트 그대로**
계산한다. writer는 중복 키가 없는 JSON을 생성해야 한다. UTF-8 디코드·JSON 구문/중복 키
검사·헤더 바이너리 해석은 reader의 책임이며 객체 validator와 분리한다.

```json
{
  "formatVersion": { "major": 1, "minor": 2 },
  "sequence": 1,
  "branding": {},
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
  별도 전용 런처/Studio 설정이다. 이미지 갱신은 `branding`의 선택 역할로 제공하며 아래 규칙을 따른다.
- `sha256`: 압축 해제 후 원본 파일의 SHA-256, 소문자 64자리 hex.
- `offset`: **페이로드 시작점 기준** 위치. 절대 위치는 `128 + indexLength + offset`이다.
  인덱스 길이가 변해도 상대 offset은 변하지 않으므로 writer의 직렬화 순환 의존이 없다.
- `storedLength`: 저장 구간 길이. `originalLength`: 압축 해제 후 정확한 파일 길이.
- `compression`: `none` 또는 `gzip`. gzip은 각 파일당 독립된 RFC 1952 단일 member로
  저장하고 연결된 member·뒤따르는 데이터는 거부한다. gzip 압축 해제 중에도 원본 길이
  제한을 적용한다. `none`은 저장 길이와 원본 길이가 같아야 한다.
- `policy`: `initial-only`는 최초 환경 구성에만 제공하고 이후 수정·삭제한 개인 설정을
  복구하거나 덮어쓰지 않는다. `always`는 운영자의 최신 내용에 맞춰 관리한다.
  컨테이너 파일 항목은 파일 단위 정책만 표현한다. 항목별 혼합 설정·리소스팩 순서는 별도
  [설정 정책](settings-policy.md)으로 제공한다. 혼합 설정 파일을 `always`로 덮어쓰지 않는다.
  최초 제공한 `initial-only` 파일은 이후 배포에서 빠져도 사용자 파일로 보존한다.
  같은 경로의 정책 전환을 자동 덮어쓰기·삭제 허가로 해석하지 않는다. 구체적인 전환과
  충돌 처리는 동기화/설정 정책 규칙을 따르며, 미지원 전환은 명시적으로 거부한다.

일반 파일 목록 순서가 페이로드의 앞부분 순서다. 첫 offset은 0, 이후 offset은 이전 offset + storedLength다.
일반 파일 다음에 icon, background 순서로 실재하는 브랜딩 자산을 이어 붙인다.
빈 파일은 길이 0의 구간과 빈 바이트의 알려진 SHA-256으로 표현하며 `none`만 허용한다.
중복·겹침·빈틈·미참조 데이터·
trailer는 허용하지 않는다. 마지막 구간 끝은 `totalLength - 128 - indexLength`와 같아야 한다.
일반 파일과 실재하는 브랜딩 자산 전체를 대상으로 이 경계를 검사한다.
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

## 하드 제한

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

Studio가 서명하고 서버 구성의 공개키로 런처가 검증한다. 서버 ID 일치는 다른 서버의 실수 방지이며
암호학적 인증은 아니다. 인증 토큰·개인 키·배포처 계정 자격 증명은 컨테이너에 담지 않는다.
HTTP 평문과 HTTPS에서 HTTP로의 redirect를 허용하지 않는다. 롤백 방지는 서버별 sequence와
수락한 배포 identity를 비교한다. 상세 신뢰·저장 정책은 [서명 명세](deployment-signing.md)를 따른다.

reader는 헤더 → 서명 → 인덱스 → 필요한 페이로드 순서로 읽는다. 인덱스 SHA-256과 서명을 검증한 뒤
`validateDeploymentIndex`로 필드·경로·레이아웃, 신뢰 구성의 expectedServerId와
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

내부 모듈은 `./deployment/contracts/index.js`에서 가져온다. 앱과 core 소비자는 현재 타입을 함께 갱신하며
이전 상수·버전별 API alias를 제공하지 않는다.
`fixtures/valid.ts`의 두 로더 예제와 인접 테스트는 writer/reader가 재사용할 계약 예제다.
테스트는 잘못된 버전·경로/alias·범위·길이·압축/해시 문법·서버 ID를 거부하는지 검증한다.
바이너리 인코딩/디코딩과 실제 gzip/해시 검증은 인접 reader/writer 테스트에서 검증한다.
실서버/Windows·이미지 실제 디코드와 UI/캐시는 BRAND-CORE-01의 검증 범위가 아니다.


## 브랜딩 전용 페이로드

인덱스의 `branding` 객체는 필수다. 객체에는 `icon`, `background`만 허용하며
각 역할은 생략, `null`, 자산 descriptor 중 하나다. 자산이 없으면 `{}`를 기록한다.
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

- `branding: {}` 또는 생략한 역할: 해당 역할 현재 표시 유지.
- 역할 값 `null`: 기본 표시로 전환하는 명시적 의도. 페이로드 없음. 런타임은 제거 상태를
  tombstone으로 지속 저장해 다음 시작에서 동봉 이미지가 다시 나타나지 않게 한다.
- descriptor: 마지막 검증본과 해시를 비교하고, 바뀐 역할만 받는다. 검증/디코드가 끝날 때까지
  기존 표시를 유지한다. 역할 이름이나 파일 경로로 이미지를 조회하지 않는다.

이미지에는 길이 0을 허용하지 않는다. PNG/JPEG는 이미 압축된 데이터이므로 현재 이미지
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

## 프로파일 선택 `memory` (서버 기본 게임 메모리)

`torchlauncher-server.json`의 선택 `memory`는 `{maxMiB, initialMiB?}`다. `maxMiB`는 512–65536 정수(MiB)이며
필수다. `initialMiB`는 선택이며 있으면 256 이상 `maxMiB` 이하 정수다. 이 객체의 다른 키, 정수 아님,
범위 밖 값, `maxMiB` 없는 `initialMiB`(Xms 기본값은 같은 블록의 명시적 Xmx 기본값이 필요)는 프로파일 오류다.
`memory`가 없으면 런처 내장 기본값(Xmx 2048 MiB, Xms 없음)을 쓴다. `initialMiB`를 생략하면 Xms 기본값이 없다.
`memory`는 `.torchpack` 배포가 아니라 내보낸 런처 ZIP의 서버 구성에만 들어가므로 바꿔도 torchpack을
다시 만들 필요는 없지만, 런처 ZIP은 다시 내보내 전달해야 한다.

실행 시 유효 메모리는 필드별로 **플레이어 개인 설정(설정 화면에서 저장한 값) → 서버 기본값 → 내장 기본값** 순이다.
Xms는 유효 Xmx 이상이면 적용하지 않고 버린다(플레이어가 Xmx를 서버 Xms 기본값보다 낮게 정하면 Xms 없이 실행한다).
물리 RAM 한도를 넘으면 기존 `memory-limit` 보호가 실행을 막고, 원인이 서버 기본값이면 설정에서 메모리를 낮추라고 안내한다.
서버 구성이 바뀌어도 플레이어 개인 설정 파일은 지우지 않는다.

현재 프로파일은 `signing`이 필수이며, `branding`·`memory`는 선택 기능이다.
JSON 구조·필드·unsafe 경로 등 계약 오류는 프로파일 오류다. 구조상 올바른 참조의 파일 누락·hash 불일치·
실제 decode 실패는 런타임 자산 실패이며 기본/이전 표시를 유지해야 한다. 런타임은 symlink/hardlink와
실제 root 이탈을 거부하고 게임 데이터 밖 캐시를 서버 ID·프로파일 기준으로 분리한다. 원격 전체 인덱스가
잘못되면 여전히 reader 오류다. 이미지 fetch/decode 실패를 게임 실패로 연결하지 않는다.
자산 해시는 바이트 무결성을 검사한다. 원격 배포의 발행자 신뢰와 rollback 방지는 공개키·서명·sequence로 검사한다.


## 서명·코드 계약

- 서명 대상: `"TORCHPACK-SIG-v1\0"`(17바이트, NUL 포함) `||` 헤더 원본 64바이트.
  인덱스는 헤더의 SHA-256·길이를 통해 간접 서명된다. 페이로드는 인덱스의 파일 해시로 보호된다.
- 인덱스의 `sequence`는 안전한 정수 1 이상으로 필수다. `branding`도 필수이며, 생략한 역할은 현재 표시 유지다.
- `deploymentIndexStart()`는 128, `deploymentPayloadStart(header)`는 `128 + indexLength`다.
- reader는 헤더 → 서명 → 인덱스 → 인덱스 SHA-256 → 서명 검증 → 인덱스 파싱·validator 순으로 검사한다.
  검증 전 인덱스 내용에 의존한 요청·스테이징을 하지 않는다.
- `trustedPublicKey`는 정규 base64url 32바이트 문자열 또는 raw 32바이트다. 잘못된 키는 요청 전에 거부한다.
  `reader.verification`은 `verified`(키로 검증 성공) 또는 `unverified`(키 없는 구조 검사)다.
  키 없는 검사는 도구용이며 런처의 무서명/비신뢰 배포 허용 경로가 아니다. 런처는 항상 구성 키로 검증한다.
- 현재 서명 오류는 `signature-invalid`, `signature-malformed`, `invalid-signing-key`다.
  구형 minor는 계약 validator의 `unsupported-version`, reader의 `invalid-header`로 거부한다. 서명 변조와 다른 키는 둘 다 `signature-invalid`다.
- writer는 `sequence`와 `sign(message) => Buffer | Promise<Buffer>`를 필수로 받는다.
  누락·잘못된 sequence는 `invalid-input`, 64바이트가 아닌 서명은 `invalid-signature`다.
  core는 개인 키를 보관하지 않는다. `createEd25519Signer`, `deriveEd25519PublicKey`는 Studio용 헬퍼다.
- 서버 구성의 `signing`은 필수다: `{ "algorithm": "ed25519", "publicKey": "<정규 base64url, 43자, 32바이트>" }`.
  누락·알 수 없는 algorithm·길이·패딩·비정규 인코딩·추가 필드는 구성 거부다.
- `decideRollback(seen | null, incoming)`은 `accept | reject-lower | reject-conflict`를 반환한다.
  입력은 `{sequence, deploymentId, indexSha256}`이며 잘못된 입력은 `TypeError`다.
  상태 저장·성공 후 갱신 시점은 런처 책임이다. [서명 명세](deployment-signing.md)를 따른다.
