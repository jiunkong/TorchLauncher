# Studio 프로젝트 파일 형식 (`.torchproj`)

2026-10-24 사용자 결정: Studio 프로젝트는 JSON이 아니라 전용 확장자의 **바이너리** 파일로 저장한다. 사용자에게 보이는 파일 형식 이름은 **TorchLauncher Studio 파일**이다. 개발 중이므로 기존 `.json` 프로젝트를 읽는 경로는 두지 않는다(열면 `INVALID`, "지원하지 않는 형식").

- 확장자: `.torchproj`(키 백업 `.torchkey`, 배포 `.torchpack`과 같은 방식). 기본 파일 이름 `server-project.torchproj`.
- 저장/열기 대화상자 필터 이름: `TorchLauncher Studio 파일`, 확장자 `torchproj`. 문서·문구의 "Studio 프로젝트 JSON" 표현은 "TorchLauncher Studio 파일"로 바꾼다.
- 목적: 브랜딩 이미지를 base64 JSON 대신 원본 바이트로 담아 크기를 줄이고, 손상/잘림을 확실히 감지한다. 암호화·서명은 하지 않는다(서명 키는 프로젝트 파일에 들어가지 않고 앱 userData에 따로 보관).

- 키 백업 파일 확장자도 `.tlkey`에서 `.torchkey`로 바꾼다(내용 형식 `v1`과 암호화는 그대로, 기본 이름 `signing-key.torchkey`, 대화상자 필터 `torchkey`). 옛 `.tlkey`는 확장자 필터에서 빠지며 별도 호환 코드는 두지 않는다.

## 컨테이너 v1

모든 정수는 little-endian.

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 8 | magic `89 54 4C 53 0D 0A 1A 0A` (`\x89TLS\r\n\x1a\n`) |
| 8 | 2 | `format` 정수 1 |
| 10 | 2 | flags, 0이어야 한다 |
| 12 | 4 | section count (1~8) |
| 16 | 섹션 반복 | 섹션 엔트리 |
| 끝 | 32 | 앞의 모든 바이트의 SHA-256 |

섹션 엔트리: `id`(4바이트 ASCII), `length`(u32, 아래 data 길이), `sha256`(32바이트, data의 해시), `data`.

| id | 필수 | data |
| --- | --- | --- |
| `META` | 예 | 프로젝트 모델(현재 `StudioProject`에서 branding 이미지 바이트를 뺀 것) JSON UTF-8을 zlib(deflate) 압축 |
| `ICON` | 아니오 | 앱 아이콘 바이트(PNG; 선택 시 필요하면 변환된 결과, 기존 branding 검증 규칙) |
| `BGND` | 아니오 | 홈 배경 원본 바이트 |

- `META` 안의 branding 메타데이터가 `ICON`/`BGND` 섹션과 일치해야 한다(역할, 길이, 해시). 이미지 섹션은 해당 메타데이터가 있을 때만 허용한다.
- 엄격한 파서: 알 수 없는 `id`, 중복 섹션, flags≠0, 섹션 길이 합이 파일 크기와 안 맞음(뒤에 남는 바이트 포함), 해시 불일치, 압축 해제 후 크기 초과는 모두 `INVALID`. 압축 해제는 크기 상한(예: 8 MiB)을 두고 스트리밍으로 검사한다(압축 폭탄 방지).
- `META`의 선택 `memory:{maxMiB, initialMiB?}`는 서버 기본 게임 메모리다(서버 구성 `memory`와 같은 검증: `maxMiB` 512–65536 정수, `initialMiB` 선택·256 이상·`maxMiB` 이하, 다른 키 금지, `initialMiB`만 있으면 거부). 새 프로젝트는 `{maxMiB:2048}`로 만들고 Xms는 비운다. 필드가 없으면 "미설정"이다. 열 때와 `update` 때 main 프로세스가 다시 검증하며, 이전 형식 변환 코드는 없다. 값은 `torchlauncher-server.json`(런처 ZIP 내보내기)과 테스트 실행에만 쓰이며 torchpack에는 들어가지 않는다.
- 크기 상한: 전체 파일 32 MiB, `META` 압축 해제 8 MiB, 이미지는 기존 branding 한도(역할별, 합계 20 MiB)를 그대로 쓴다.
- 쓰기: 기존처럼 같은 디렉터리의 임시 파일에 쓰고 fsync 후 원자적 rename. 읽기는 크기 제한 후 전체를 메모리에 읽어 검증(대용량 스트리밍 불필요).
- 직렬화는 결정적이어야 한다(같은 프로젝트는 같은 바이트: 키 순서 고정, 압축 레벨 고정). 그래야 "마지막 저장과 같은가" 비교와 테스트가 안정적이다.
- 상위 호환 여부와 무관하게 `format` 값이 1이 아니면 `INVALID`.

## 영향 범위

- 코덱 모듈(순수 함수): `encodeProjectFile(project) -> Buffer`, `decodeProjectFile(bytes) -> StudioProject`. 위치 `apps/admin/src/main/project-file.ts`.
- 기존 JSON 직렬화 지점(`studio.ts`의 저장/열기, `index.ts` 대화상자 필터와 기본 이름, `filesystem.ts` 쓰기)을 코덱으로 교체. 프로젝트 모델(`StudioProject`)과 내부 검증(`parseProject`)은 유지한다.
- 테스트·스모크·fixtures의 `.json` 프로젝트 저장/열기를 `.torchproj`로 교체. 루트 `scripts/smoke.mjs`의 저장 검증은 JSON 파싱 대신 magic 헤더와 재열기 확인으로 바꾼다.
- 추후(범위 밖): Windows 파일 연결(더블클릭으로 열기), 최근 파일 목록.

## 프로젝트 폴더 구조 (2026-10-24 사용자 결정)

프로젝트는 단일 파일이 아니라 **프로젝트 폴더** 단위로 관리된다. 외부 "소스 폴더" 의존성을 없애고 모든 데이터 파일을 프로젝트 폴더 안에 포함한다.

```
<프로젝트 폴더>/
├── project.torchproj    # 위 컨테이너 v1 형식의 프로젝트 파일
├── branding/            # 선택한 아이콘·배경 원본 사본 (있는 역할만)
│   ├── icon.png
│   └── background.png|jpg
└── files/               # 게임 데이터 파일 (mods/, resourcepacks/, shaderpacks/, config/ 등)
```

브랜딩 이미지 선택(`brandingSelect`)은 main 프로세스에서 다음 순서로 처리한다. 계약(아이콘 PNG ≤ 512×512 px·1 MiB,
배경 PNG/JPEG ≤ 3840×2160 px·8,294,400 px·8 MiB)은 바뀌지 않았고, 그 제한에 맞추는 일을 Studio가 대신한다.

1. 원본 파일은 최대 32 MiB까지 안전 읽기로 읽는다(초과하면 `fileTooLarge`). PNG/JPEG는 디코딩 **전에** 헤더에서 크기를 읽어
   6,400만 화소를 넘으면 `tooManyPixels`로 거부한다(압축 폭탄 방지). 헤더가 깨졌으면 `corrupt`(`part: header`).
2. 원본이 이미 규칙에 맞으면(역할에 맞는 형식, 크기·화소·바이트 제한 이내) **원본 바이트를 그대로** 저장한다(해시 불변).
3. 아니면 `nativeImage`로 디코딩한다(실패 시 PNG/JPEG면 `corrupt`(`part: data`), 그 외 형식이면 `unsupported`). 가로·세로·화소 제한에
   맞게 비율을 유지하며 축소(고품질)하고 PNG(아이콘은 항상 PNG; 배경은 JPEG 원본이면 JPEG, 그 외는 PNG를 먼저 시도하고 제한을
   넘으면 JPEG)로 다시 인코딩한다. 바이트 제한을 넘으면 JPEG 품질을 낮추거나(92→80→68→56) 배율을 줄이며 최대 10번 인코딩을
   시도하고, 그래도 안 되면 `cannotFit`(시도 횟수와 마지막 크기 포함)으로 거부한다.
4. 변환 결과는 기존 `validateImage`(최종 검증)를 그대로 통과해야 하며, **변환된 바이트·메타데이터·해시**가 프로젝트 스냅샷,
   `branding/` 사본, 내보낸 서버 구성과 torchpack에 저장된다.

실패는 `{ok:false, code:'IMAGE_FAILED', image:{reason, role, ...}}`로 보고한다. `reason`은 `unsupported`, `corrupt`
(`part`: `empty`/`header`/`data`, `format`, 알려진 크기), `fileTooLarge`, `tooManyPixels`, `cannotFit`, `unreadable`
(`cause`), `storeFailed`(`cause`)이며, 값은 숫자·열거형·파일 이름뿐이고 경로와 오류 원문은 담지 않는다. 렌더러가 ko/en 카탈로그
템플릿으로 문구를 만든다. 실패하면 프로젝트와 기존 `branding/` 사본은 바뀌지 않는다. `brandingRemove`는 프로젝트를 자동 저장한
뒤 `branding/<role>.png|jpg` 사본도 지운다(다른 역할은 그대로).

선택한 이미지를 처리한 뒤 유효성 검사를 마친 결과를 `branding/` 아래에 원자적으로 복사하고,
프로젝트의 메타데이터와 이미지 바이트를 `project.torchproj`에 즉시 저장한다. `project.torchproj`의
이미지 섹션은 프로젝트를 다시 열 때 쓰는 자체 포함 스냅샷이다. `branding/` 사본은 사용자가 프로젝트
폴더에서 확인·복사할 수 있도록 보관하며, 다른 이름으로 저장할 때 함께 복사한다.

- **새 프로젝트 (`new`)**: 앱 안 모달에서 프로젝트 이름을 입력하고 네이티브 선택창으로 상위 폴더를 고르면 Studio가 `<상위>/<이름>/`을 만들고 `project.torchproj`와 `files/`를 생성한다(저장 상태 `dirty: false`). 이름은 한 경로 단위로 검증한다(공백 제거 후 1~64자, `<>:"/\|?*`·제어 문자·끝의 `.`·Windows 예약 장치 이름 금지, 위반 시 `FOLDER_NAME_INVALID`). 같은 이름의 파일/폴더가 있으면 건드리지 않고 `FOLDER_EXISTS`로 거부하며, 이후 단계가 실패하면 만든 폴더를 제거한다.
- **프로젝트 열기 (`open`)**: 프로젝트 폴더를 선택한다. 폴더 내에 `project.torchproj`가 없으면 `INVALID`로 거부된다 (과거 단일 파일 열기는 비지원). 열 때(그리고 `rescan` 때) `files/mods/`(.jar), `files/resourcepacks/`, `files/shaderpacks/`(.zip)에서 목록에 없는 유효한 파일(이름 규칙·크기 상한·ZIP 시그니처·심볼릭/하드 링크 거부·목록 개수 상한)을 목록 끝에 이름순으로 추가한다(모드는 `required`, 리소스/셰이더 팩은 `initial`). 잘못된 파일은 조용히 건너뛰고, 파일이 없는 기존 항목은 지우지 않으며, 이 추가만으로는 `dirty`가 되지 않는다.
- **저장 (`save`)**: 대화상자 없이 현재 프로젝트 폴더의 `project.torchproj`에 직접 원자적으로 덮어쓴다.
- **자동 저장**: 파일을 프로젝트 폴더에 넣는 명령(`settingsPackAdd`, `settingsPackRemove`(목록 항목과 `files/` 안의 파일을 함께 제거), Files 페이지 `files` 추가, 브랜딩 이미지 선택)이 성공하면 `save`와 같은 원자적 경로로 즉시 저장하고 `dirty: false`가 된다(다른 미저장 편집도 함께 저장). 브랜딩 이미지는 별도 `branding/` 사본과 `project.torchproj` 내장 스냅샷을 함께 갱신한다. 자동 저장이 실패하면 변경은 메모리에 남고 `dirty`는 `true`로 유지되며 결과(`saveFailed` / `autosaveFailed`)로 알린다.
- **다른 이름으로 저장 (`saveAs`)**: `new`와 같은 이름 입력·상위 폴더 선택으로 새 폴더를 만들고 `files/`, 존재하는 `branding/`, `project.torchproj`를 전체 복사한 뒤 새 폴더로 전환한다. 원본과 같거나 포함 관계인 대상은 `INVALID`로 거부한다.
- **파일 추가**: 프로젝트 폴더 밖의 파일은 항상 `files/`로 안전하게 복사된다. 대상 경로에 이미 내용이 다른 파일이 존재할 경우 덮어쓰지 않고 `INVALID`로 거부된다.
- **파일 항목 (`project.files`, 2026-10-25)**: 각 항목은 정확히 `path`, `targetPath`, `policy` 세 필드를 가진다.
  - `path`: `files/` 기준 원본 경로(페이로드를 읽는 곳). `targetPath`: 게임 폴더 기준 배포 경로로, 배포 인덱스의 `path`에 기록된다. 둘 다 배포 경로 규칙(코어 `validateDeploymentPath`: 상대·`/` 구분·`..`/빈 요소/제어 문자/`.torchlauncher` 금지 등)을 따르고 `targetPath`끼리는 대소문자를 무시하고 중복될 수 없다. 새로 추가한 파일은 `targetPath = path`, `policy = always`로 시작한다.
  - `policy`는 `always` 또는 `initial-only`만 허용한다. 예전의 `excluded`는 제거됐다. 프로젝트에 없는 `files/` 안의 파일은 배포에 들어가지 않고 Files 페이지에도 나열되지 않는다(진단용 `state.files`에는 `excluded`로 남는다).
  - 관리 파일(`options.txt`·플레이어 설정 정책 `torchlauncher/settings-policy.json`·`mods/*.jar`·`resourcepacks/`·`shaderpacks/`)은 설정·모드·팩 화면이 관리하므로 `path`와 `targetPath` 어느 쪽에도 둘 수 없고(프로젝트 파싱이 `INVALID`), 파일 추가 선택에서는 건너뛴다. 팩 목록에서 자동 등록된 파일은 `managed`로 표시되어 Files 페이지에 나타나지 않는다.
  - 명령: `filesPolicy`(이미 등록된 파일의 정책 변경), `filesTarget`(`targetPath` 변경, 원본이 링크가 아닌 실제 파일이어야 함, 위 규칙 위반은 `INVALID`), `filesRemove`(항목과 `files/`의 원본 파일을 함께 삭제, 링크는 따르지 않고 거부, 이미 없는 파일은 항목만 제거). `files`/`filesTarget`/`filesRemove`는 성공 시 자동 저장한다.
  - `lastBuild.files[]`는 `sourcePath`, `path`(= 배포 `targetPath`), `sha256`, `length`, `policy`를 모두 가진다. 변경 비교는 `sourcePath`로 매칭하며 `path`나 `policy`가 달라도 `modified`다. 삭제된 항목은 `removed`로 보인다.
  - 호환: 개발 단계 정책에 따라 `targetPath`가 없는 항목, `excluded` 정책, `sourcePath`가 없는 `lastBuild.files`를 읽는 호환 reader나 마이그레이션은 없다. 이런 프로젝트는 `INVALID`로 거부된다.
- **프로젝트 폴더 표시**: 파일 메뉴 `파일 > 프로젝트 폴더 표시` 및 파일 페이지의 버튼을 통해 OS 기본 파일 관리자로 프로젝트 폴더를 연다.
