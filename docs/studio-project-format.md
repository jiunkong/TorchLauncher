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
| `ICON` | 아니오 | 앱 아이콘 원본 바이트(PNG 등, 기존 branding 검증 규칙) |
| `BGND` | 아니오 | 홈 배경 원본 바이트 |

- `META` 안의 branding 메타데이터가 `ICON`/`BGND` 섹션과 일치해야 한다(역할, 길이, 해시). 이미지 섹션은 해당 메타데이터가 있을 때만 허용한다.
- 엄격한 파서: 알 수 없는 `id`, 중복 섹션, flags≠0, 섹션 길이 합이 파일 크기와 안 맞음(뒤에 남는 바이트 포함), 해시 불일치, 압축 해제 후 크기 초과는 모두 `INVALID`. 압축 해제는 크기 상한(예: 8 MiB)을 두고 스트리밍으로 검사한다(압축 폭탄 방지).
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
└── files/               # 게임 데이터 파일 (mods/, resourcepacks/, shaderpacks/, config/ 등)
```

- **새 프로젝트 (`new`)**: 앱 안 모달에서 프로젝트 이름을 입력하고 네이티브 선택창으로 상위 폴더를 고르면 Studio가 `<상위>/<이름>/`을 만들고 `project.torchproj`와 `files/`를 생성한다(저장 상태 `dirty: false`). 이름은 한 경로 단위로 검증한다(공백 제거 후 1~64자, `<>:"/\|?*`·제어 문자·끝의 `.`·Windows 예약 장치 이름 금지, 위반 시 `FOLDER_NAME_INVALID`). 같은 이름의 파일/폴더가 있으면 건드리지 않고 `FOLDER_EXISTS`로 거부하며, 이후 단계가 실패하면 만든 폴더를 제거한다.
- **프로젝트 열기 (`open`)**: 프로젝트 폴더를 선택한다. 폴더 내에 `project.torchproj`가 없으면 `INVALID`로 거부된다 (과거 단일 파일 열기는 비지원).
- **저장 (`save`)**: 대화상자 없이 현재 프로젝트 폴더의 `project.torchproj`에 직접 원자적으로 덮어쓴다.
- **다른 이름으로 저장 (`saveAs`)**: `new`와 같은 이름 입력·상위 폴더 선택으로 새 폴더를 만들고 `files/`와 `project.torchproj`를 전체 복사한 뒤 새 폴더로 전환한다. 원본과 같거나 포함 관계인 대상은 `INVALID`로 거부한다.
- **파일 추가**: 프로젝트 폴더 밖의 파일은 항상 `files/`로 안전하게 복사된다. 대상 경로에 이미 내용이 다른 파일이 존재할 경우 덮어쓰지 않고 `INVALID`로 거부된다.
- **프로젝트 폴더 표시**: 파일 메뉴 `파일 > 프로젝트 폴더 표시` 및 파일 페이지의 버튼을 통해 OS 기본 파일 관리자로 프로젝트 폴더를 연다.
