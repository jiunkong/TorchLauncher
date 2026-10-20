# TorchLauncher 단일 배포 규격 v1.0

FMT-01 계약 초안. 통합 승인은 #0이 담당한다. 구현 계약은
`packages/core/src/deployment/contracts/`에 있으며 writer·reader·동기화는 이 작업에 포함하지 않는다.
아키텍처의 미확정 바이너리 규격은 이 문서를 기준으로 구체화한다.

## 컨테이너와 호환성

권장 확장자는 `.torchpack`이다. 파일은 `[64바이트 헤더][JSON 인덱스][페이로드]` 하나로
구성한다. 모든 정수는 unsigned little-endian이다. HTTP byte range는 파일 시작 기준이며
끝을 포함한다. 헤더 요청은 `bytes=0-63`, 인덱스 요청은 `bytes=64-(63+indexLength)`이다.

| 바이트 위치 | 길이 | 의미 |
| --- | --- | --- |
| 0 | 8 | ASCII `TORCHDEP` (`54 4f 52 43 48 44 45 50`) |
| 8 | 2 | major = 1 |
| 10 | 2 | minor = 0 |
| 12 | 4 | flags = 0 |
| 16 | 8 | indexLength: 실제 UTF-8 인덱스 바이트 수 |
| 24 | 8 | totalLength: 헤더·인덱스·페이로드를 합친 전체 바이트 수 |
| 32 | 32 | 인덱스 원본 바이트의 SHA-256 (binary digest) |

v1.0은 버전이 정확히 1.0이고 flags가 0인 입력만 수락한다. 미래 minor, major, 새로운 필드,
압축 방식 또는 적용 정책을 추측해서 처리하지 않는다. 새 필드나 의미 변경에는 버전 갱신이
필요하다. writer는 헤더와 인덱스에 같은 버전을 기록한다. 헤더의 u64는 변환 전에
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
  별도 전용 런처/Studio 설정이며 v1 인덱스의 필수 필드에 포함하지 않는다.
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

목록 순서가 페이로드 순서다. 첫 offset은 0, 이후 offset은 이전 offset + storedLength다.
빈 파일은 길이 0의 구간과 빈 바이트의 알려진 SHA-256으로 표현하며 `none`만 허용한다.
중복·겹침·빈틈·미참조 데이터·
trailer는 허용하지 않는다. 마지막 구간 끝은 `totalLength - 64 - indexLength`와 같아야 한다.
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
전환하지 않는다. 실제 다운로드·검증·압축 해제·적용 절차는 후속 reader/sync 작업이다.

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
바이너리 인코딩/디코딩과 HTTP/실제 gzip/해시 검증은 이 작업의 검증 완료 범위가 아니다.
