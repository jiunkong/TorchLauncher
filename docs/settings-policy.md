# 설정 정책 v1/v2 (`torchlauncher/settings-policy.json`)

USER-02 코어 명세(v1)와 SET-CORE-01 확장(v2, 아래 "v2: 설정 파일 항목과 셰이더"). 구현: `packages/core/src/instance/settings/`. UI/IPC 연결은 아직 없다.

## 개요

`options.txt`처럼 개인 설정과 필수 설정이 섞인 파일은 파일 전체를 배포하지 않고 **항목별**로 적용한다.
운영자는 일반 `always` 파일 `torchlauncher/settings-policy.json`을 배포하고, 런처 코어가 동기화 후 게임 실행 전에
`applySettingsPolicy`로 이를 `options.txt`에 적용한다. `options.txt` 자체는 `always` 대상이 되어서는 안 된다
(`initial-only`는 허용: 동기화가 한 번 배치한 뒤 항목별 적용이 이어서 동작).

## 스키마

```json
{
  "version": 1,
  "file": "options.txt",
  "required": { "renderDistance": "12" },
  "initial": { "musicVolume": "0.2", "key_key.inventory": "key.keyboard.i" },
  "resourcePacks": {
    "required": ["file/server-pack.zip"],
    "initial": ["vanilla", "file/server-pack.zip"]
  }
}
```

| 필드 | 필수 | 의미 |
| --- | --- | --- |
| `version` | 예 | 정수 `1` |
| `file` | 예 | v1은 `"options.txt"`만 |
| `required` | 아니오 | 키 -> 문자열 값. 매 적용마다 강제 |
| `initial` | 아니오 | 키 -> 문자열 값. 최초 구성에서만 설정 |
| `resourcePacks.required` | 아니오 | 항상 활성화할 팩 ID 목록(순서 = 운영자 지정 상대 순서) |
| `resourcePacks.initial` | 아니오 | 최초 구성의 기본 활성 목록 |

규칙: 엄격한 JSON(주석·후행 쉼표·중복 객체 키 거부, 깊이 8). 알 수 없는 필드 거부. 옵션 키는 `[A-Za-z0-9_.-]{1,128}`,
값은 제어문자 없는 2048자 이하 문자열. `resourcePacks` 키는 `required`/`initial` 맵에 쓸 수 없고 `resourcePacks` 절을 써야 한다.
같은 키가 `required`와 `initial`에 모두 있으면 거부(`invalid-policy`). 팩 ID는 1~256자, 제어문자 없음, 목록 내 중복 없음.
모든 위반은 `invalid-policy`, 크기 초과는 `limit-exceeded`이며 어떤 파일도 변경하지 않는다.

## 적용 동작

1. `acquireServerDataLock(root,'maintenance')`를 얻는다(게임 실행·설치 중이면 `locked`).
2. 정책이 없으면 `no-policy`로 아무것도 하지 않는다.
3. `options.txt`를 줄 단위로 파싱한다. `key:value` 줄만 키로 취급하고 그 외 줄(빈 줄, 주석성 줄), 알 수 없는 키, 키 순서,
   줄바꿈(CRLF/LF/CR), BOM을 보존한다. 필요한 값만 교체하고 없는 키는 파일 끝에 파일의 줄바꿈으로 추가한다.
   중복 키·UTF-8 아님·NUL·1 MiB 초과는 수정 없이 `invalid-options`/`limit-exceeded`로 거부한다.
4. `required` 키는 매번 값을 강제한다.
5. `initial` 키는 최초 구성에서만 설정한다. 최초 구성 시 이미 파일에 있는 키는 덮어쓰지 않고(`user-value-present`) 처리된 것으로 기록한다.
6. 변경이 있을 때만 임시 파일(같은 디렉터리, fsync) -> 원자적 rename으로 쓴다. 읽은 뒤 파일이 바뀌었으면 `file-changed`.
   `options.txt`가 없으면 required/initial/resourcePacks 항목만으로 새로 만든다.
7. 적용 기록 `.torchlauncher-user/settings.json`은 `options.txt`를 쓴 **뒤** 원자적으로 갱신한다(중간 중단 시 initial은 건너뛸 뿐 사용자 값은 잃지 않음).

### 최초 구성과 `initial-skipped`

`.torchlauncher-user/settings.json`: `{"version":1,"initial":null | {"keys":[정렬된 처리 완료 키],"resourcePacks":bool}}`
(64 KiB 상한, 정확한 필드만 허용, 위반 시 `invalid-state`). 정책이 있는 첫 적용이 "최초 구성"이며 이때 `initial`이 `null`에서 채워진다.
이후 정책에 새 `initial` 키가 추가되어도 자동 적용하지 않고 `initialSkipped: [{key, reason:'already-configured'}]`로 보고한다.
이유: 사용자가 이미 같은 설정을 바꾸었거나 의도적으로 지웠을 수 있어, 기존 사용자 데이터 보존을 우선한다. 운영자가 값을 사용자에게 넣어야 하면
`required`를 쓴다. 한 번 적용·건너뛴 키는 사용자가 이후 바꾸거나 지워도 복구하지 않는다.

### 리소스팩

`resourcePacks:["vanilla","file/foo.zip"]`(JSON 배열)를 관리한다. 키가 없으면 형식 프로파일의 기본값(현재 모두 `[]`)으로 간주한다. 이전 구현은 `["vanilla"]`를 가정했으나, Minecraft Wiki의 기본값이 `[]`이고 실제 1.21.1 클라이언트 파일도 `resourcePacks:[]`이므로 변경했다(vanilla는 내장 팩으로 암묵 적용). 운영자가 `vanilla`를 명시하면 그대로 유지된다.

- required 팩이 없으면 추가: 운영자 순서상 앞선 required 팩 바로 뒤, 없으면 뒤따르는 required 팩 앞, 둘 다 없으면 목록 끝(최우선).
- required 팩들의 상대 순서가 어긋나면 기존 required 팩이 차지한 자리 안에서 운영자 순서로 되돌린다.
- 사용자 팩은 삭제하지 않고 서로의 상대 순서를 유지한다. 중복 ID는 첫 항목만 남긴다.
- `initial` 목록은 최초 구성에서 `resourcePacks` 키가 없을 때만 기본 목록이 된다(이미 있으면 `user-value-present`로 건너뜀). required 팩은 그 위에 병합된다.
- 팩 파일 존재 여부는 검사하지 않는다(파일 배포는 일반 동기화 소유).

## 소유권 분류

동기화 원장은 주입받는다: `SyncOwnership = {serverId, deploymentId, initialized, files:[{path, policy:'always'|'initial-only', sha256, length}]}`.
`classifySettingsPath(path, ownership)`: `always` -> `required`, `initial-only` -> `initial-default`, 없음 -> `user`(경로는 대소문자·NFC 무시 비교).
`describeManagedFiles(ownership)`는 관리 파일 목록(경로 정렬)을, `describeManagedSettings(policy)`는 혼합 설정 `options.txt`의 항목별 운영자 통제 목록을 돌려준다.
`options.txt`가 `always`이면 `applySettingsPolicy`는 `options-owned-by-sync`로 거부한다. 원장이 미완료(`initialized:false`)면 `sync-not-initialized`.

## 오류 코드

`aborted`, `file-changed`, `invalid-argument`, `invalid-options`, `invalid-policy`, `invalid-state`, `io-error`, `limit-exceeded`, `locked`,
`options-owned-by-sync`, `config-owned-by-sync`, `invalid-config`, `required-pack-removed`, `required-pack-reordered`, `sync-not-initialized`, `unsafe-path`, `unsupported-options-version`. 모두 `SettingsError.code`.

## 버전별 형식 프로파일 (`profiles.ts`)

`options.txt`의 `version:` 줄(데이터 버전, 1.10-pre1에서 추가)로 프로파일을 고른다. 줄이 없으면 호출자의 `minecraftVersion`, 둘 다 없으면 기존 동작(1.21.1 프로파일). 둘 다 있는데 서로 다른 프로파일이면 `unsupported-options-version`.
`versionPolicy`(적용/읽기/팩 설정 API 공통 옵션): `verified-only`(기본) / `allow-researched` / `allow-any`. 지원 밖 버전은 기본적으로 파일을 수정하지 않고 `unsupported-options-version`으로 거부한다.
`allow-any`는 조사 범위 상한(5023, 26.3)을 넘는 데이터 버전만 최신 프로파일(`java-1.21.2+`)로 처리하며 `result.warnings`에 경고를 남긴다. 1519 미만(1.13 이전)은 항상 거부한다.
결과의 `formatProfile`, `warnings`로 사용된 프로파일을 알 수 있다.

| 프로파일 | 데이터 버전 | Minecraft | 근거 수준 |
| --- | --- | --- | --- |
| `java-1.21.1` | 3955 | 1.21.1 | **검증**(실제 클라이언트 파일 fixture로 테스트) |
| `java-1.13-1.21` | 1519–3954 | 1.13, 1.14, 1.16–1.20, 1.20.5, 1.21 | **미검증(조사 기반)**: 구현만 있고 실파일 테스트 없음 |
| `java-1.21.2+` | 3956–5023 | 1.21.2–1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 | **미검증(조사 기반)**: 3955와 같은 레이아웃이라는 문서 근거만 있고 실파일 테스트 없음 |
| (없음) | <1519 | 1.12 이하 | 미지원: 항상 거부 |
| (없음) | >=5024 | 26.3 이후(조사 시점 이후 릴리스) | 기본 거부, `allow-any`만 `java-1.21.2+`로 처리(경고) |

프로파일이 결정하는 것: 기본 팩 목록(`[]`), 단축키 값이 이름 형식(`key.keyboard.*`/`key.mouse.*`)이어야 하는지(숫자 키코드 거부 -> `invalid-policy`),
`file/` 팩 ID 검증(빈 이름, `..`/빈 세그먼트, 역슬래시 거부). 정책의 `version` 키는 게임 소유라 `invalid-policy`.

조사 출처:
- https://minecraft.wiki/w/Options.txt_(Java_Edition): `version`은 마지막으로 저장한 클라이언트의 데이터 버전(1.10-pre1 추가), `resourcePacks`(13w36a)·`incompatibleResourcePacks`(1.8.8) 기본값 `[]`, 단축키 `key_key.*` = `key.keyboard.w` 등.
- https://minecraft.wiki/w/Key_codes: LWJGL 3 전환(17w43a)으로 키코드 재설계, 17w45a부터 `key.keyboard.` 접두사(1.13). 이전은 숫자 코드.
- https://minecraft.wiki/w/Data_version: 1.13=1519, 1.21=3953, 1.21.1=3955, 1.21.2=4080.

조사로 확인하지 못해 구현하지 않은 것: 버전별 팩 ID 표기 변화(`vanilla`, `file/` 접두사 도입 시점, 모드 내장 팩 ID, 서버 리소스팩 표기), 1.12 이하 숫자 키코드·평문 팩 이름 처리, 1.21.2 이후 레이아웃 변화.

### 3955 초과 조사 결과 (2026-10-22 확인)

데이터 버전(Data_version 위키, WebFetch 요약): 1.21.2=4080, 1.21.3=4082, 1.21.4=4189, 1.21.5=4325, 1.21.6=4435, 1.21.7=4438, 1.21.8=4440, 1.21.9=4554, 1.21.10=4556, 1.21.11=4671, 26.1=4786, 26.1.1=4788, 26.1.2=4790, 26.2=4903, 26.3=5023. 26.1(2026-03-24)부터 `연도.드롭.핫픽스` 표기(26.1 문서). 3955 직후 릴리스가 1.21.2(4080)이므로 프로파일 하한은 3956으로 둔다.
- https://minecraft.wiki/w/Options.txt_(Java_Edition) (옵션 표 원문 wikitext 확인): `version`(데이터 버전 정수, 없으면 기본 설정으로 대체), `resourcePacks`(13w36a)/`incompatibleResourcePacks`(1.8.8)는 문자열 목록 기본 `[]`, 키 `key_key.*` 값은 Key codes. 1.21.2~26.3 사이 이 항목들의 변경 기록은 표에 없다. 이 구간의 변경은 옵션 추가/삭제뿐(1.21.2 `inactivityFpsLimit` 등, 1.21.5 `startedCleanly`, 1.21.6 `musicFrequency`, 1.21.9 `toggleAttack` 등, 1.21.11 `graphicsPreset`(`graphicsMode` 대체), 26.1 `exclusiveFullscreen`, 26.2 `sharePresence` 등, 26.3 `quitShortcuts` 등, `touchscreen`·`rawMouseInput` 제거). `key:value` 줄 구조, 줄바꿈, 인코딩에 대한 변경 서술은 없음.
- https://minecraft.wiki/w/Key_codes (History 확인): 26.3-snapshot4에서 정의 없는 키 코드가 `scancode.###` -> `key.keyboard.###`로 바뀌고 SDL3 사용. 값은 여전히 비숫자 이름 형식이라 `namedKeyCodes` 검사와 충돌하지 않는다.
- https://minecraft.wiki/w/Java_Edition_26.1: 26.1에서 월드 리소스팩(`resources.zip`)이 `resourcepacks` 하위로 이동(options.txt 영향 서술 없음).

판단: 위 근거로 TorchLauncher가 쓰는 부분(`version:` 줄, `resourcePacks` 목록, 단축키 값 형식)의 레이아웃이 3955와 같다고 보아 하나의 프로파일로 구현했다. 단 근거는 "문서에 변경 기록이 없음"이라는 부재 증거이고 실제 클라이언트 파일로 확인하지 못했으므로 `allow-researched`에서만 쓰인다.
미지원/미확인: 3955 이후의 팩 ID 표기(`vanilla`, `file/`, 모드·서버 내장 팩 ID)는 위키에 서술이 없어 확인 못함(프로파일은 기존처럼 잘못된 `file/` ID만 거부). 26.3 이후 릴리스(26.4 등)는 확인 불가라 범위에서 제외. 26.3-snapshot4 이전 `scancode.###` 값의 의미는 확인 못함.


## v2: 설정 파일 항목과 셰이더 (SET-CORE-01)

### 버전 결정

`options.txt` 외의 `key=value` 파일(셰이더 설정, 단순 모드 설정)을 항목별로 다루기 위해 **정책 `version: 2`**를 추가했다. 선택지는 (a) v1에 선택 필드 추가, (b) 새 버전이었다.
v1 파서는 알 수 없는 필드를 거부(`invalid-policy`)하므로 (a)는 새 정책을 받은 구버전 런처가 `configFiles`를 **조용히 무시하고 필수 설정을 적용하지 않는** 위험이 있다. (b)는 구버전 런처가 명확히 거부한다.
따라서 v2를 쓰고, v1 파일은 파서·동작 모두 그대로 유효하다(v1에서 `configFiles`는 여전히 알 수 없는 필드). 도구가 만드는 정책은 설정 파일 항목이 있을 때만 `version: 2`, 없으면 `version: 1`을 출력한다(`serializeSettingsPolicy`).

### 스키마 추가분

```json
{
  "version": 2,
  "file": "options.txt",
  "required": { "renderDistance": "12" },
  "configFiles": {
    "config/iris.properties": {
      "required": { "enableShaders": "true" },
      "initial": { "shaderPack": "BSL_v8.zip" }
    },
    "shaderpacks/BSL_v8.zip.txt": {
      "format": "properties",
      "initial": { "shadowMapResolution": "2048" }
    }
  }
}
```

- `configFiles`: 경로 -> `{format?, required?, initial?}` 객체(엄격 JSON이므로 경로 중복 거부). `format`은 생략하거나 `"properties"`만. 최대 32개 파일, 파일당 키 512개. 정책 전체는 기존과 같이 64 KiB 상한.
- 허용 경로(`validConfigPath`): `config/**`(세그먼트 최대 5) 또는 `shaderpacks/<이름>`(바로 아래 한 단계), 확장자는 `.properties`/`.txt`만. `/` 구분, NFC, 각 세그먼트 1~128자, `\ : * ? " < > |`·제어문자·앞뒤 공백·끝 점·`.`로 시작하는 이름·Windows 예약 이름 거부, `..`·빈 세그먼트·절대 경로 거부, 대소문자/NFC 무시 중복 거부.
  따라서 `options.txt`, 정책 파일, `.torchlauncher*`, `mods/`, `versions/` 등은 표현 자체가 불가능하다. 디스크 쪽 확인은 기존 `gamePath`(실제 디렉터리 철자·심볼릭 링크·하드 링크·일반 파일 검사)를 그대로 쓴다.
- 키: `[A-Za-z0-9_.-]{1,128}`. 값: 인쇄 가능한 ASCII 0x20~0x7E, 2048자 이하, 백슬래시 없음, 앞뒤 공백 없음. 이유: `java.util.Properties`는 ISO-8859-1로 읽고 `\` 이스케이프·앞공백 제거를 하므로 그 밖의 값은 게임이 다르게 읽는다. 한글 셰이더팩 이름 등은 현재 표현할 수 없다(한계).
- `required`/`initial`은 같은 파일 안에서 키가 겹치면 거부.

### 파일 파서 (`properties.ts`)

options.txt와 같은 방식의 줄 보존 모델이다: `#`/`!` 주석, 빈 줄, 모르는 키, 키 순서, CRLF/LF/CR, BOM 보존, 값 변경은 해당 줄만, 없는 키는 파일 끝에 추가. 안전하게 편집할 수 없는 형태는 **수정 없이** `invalid-config`로 거부한다: 중복 키, `=` 없는 줄, `:`/공백 구분자, 키 앞뒤 공백·들여쓰기, 줄 이어쓰기(`\` 끝), NUL, UTF-8 아님. 1 MiB 초과는 `limit-exceeded`.

### 적용 순서와 의미

`applySettingsPolicy`는 같은 유지보수 잠금 아래에서 다음을 한다.
1. 소유권 확인: 정책의 `configFiles` 경로가 동기화 원장에서 `always`이면 `config-owned-by-sync`로 거부(`initial-only`는 허용: 동기화가 한 번 배치, 정책이 항목별 적용). 거부 시 아무것도 쓰지 않는다.
2. options.txt와 모든 설정 파일을 **메모리에서 먼저 편집**한다(여기서 `invalid-config` 등이 나면 어떤 파일도 쓰지 않음).
3. options.txt -> 설정 파일(경로 순) -> 상태 순으로 임시 파일 + fsync + 원자적 rename. 읽은 뒤 바뀌었으면 `file-changed`. 설정 파일이 없고 쓸 항목이 있을 때만 상위 디렉터리를 만든다.
4. `required`는 매번 강제, `initial`은 아래 규칙. 사용자가 이미 가진 값은 `initial`로 절대 덮어쓰지 않는다(`user-value-present`).
5. 결과 `ApplySettingsResult.configFiles[]`: `{path, created, changed, enforcedKeys, initialApplied, initialSkipped}`.

`initial`의 "최초 구성"은 **파일 단위**다. 상태 파일 `.torchlauncher-user/settings.json`은 설정 파일 항목이 기록될 때 `{"version":2,"initial":{"keys":[...],"resourcePacks":bool,"files":{"<경로>":[처리된 키]}}}`가 되고(`initial`이 있는 파일만 기록, 키 정렬, 보존 한도 64개 파일 — 초과 시 정책에 없는 경로부터 삭제), 설정 파일 항목이 없으면 v1 형식 그대로 쓴다. 상태 v1은 계속 읽힌다.
- 상태에 기록되지 않은 파일(처음 정책에 등장)은 options.txt의 최초 구성 여부와 무관하게 그 파일의 최초 구성이다: 없는 키만 설정하고 있는 키는 건너뛴다. 이유: 운영자가 나중에 셰이더 기본값을 추가하는 것이 주된 사용 사례이고, 값이 이미 있으면 어차피 덮어쓰지 않아 사용자 데이터는 안전하다.
- 이미 기록된 파일에 나중에 추가된 `initial` 키는 options.txt와 같이 자동 적용하지 않고 `initialSkipped: already-configured`로 보고한다. 한 번 처리된 키는 사용자가 바꾸거나 지워도 복구하지 않는다.
- 중단 안전성: 설정 파일을 쓰고 상태 기록 전에 중단되면 다음 실행에서 이미 쓴 initial 값이 `user-value-present`로 읽혀 건너뛸 뿐이다.

### 셰이더 표현

별도 셰이더 전용 스키마 없이 설정 파일 항목으로 표현한다. 근거(Iris/Oculus 문서화된 관례, 이 저장소에서 실제 클라이언트로는 미검증):
- 사용 여부/선택 팩: `config/iris.properties`의 `enableShaders=true|false`, `shaderPack=<shaderpacks/ 안의 파일 이름>`. NeoForge의 Oculus는 `config/oculus.properties`(같은 키로 추정, 미검증). 빈 `shaderPack=`은 "선택 없음".
- 팩별 옵션: `shaderpacks/<팩 파일 이름>.txt`(예: `BSL_v8.zip.txt`)의 `KEY=value` 줄.
- OptiFine의 `optionsshaders.txt`는 경로 범위 밖이라 지원하지 않는다(Fabric/NeoForge 1.21.1 대상 아님).
- 셰이더팩 파일 자체(`shaderpacks/*.zip`)는 일반 배포 파일이다. 정책은 파일 존재를 검사하지 않는다.

### Studio용 순수 API (`packages/core/src/instance/settings/index`)

- 파싱: `parseOptionsEntries(bytes|string)`, `parsePropertiesEntries(bytes|string)` -> `SettingEntry[]` (`key`, `value`, `kind: 'keybind'|'mod-keybind'|'other'`, `group`, `valueType`, `reserved`), `classifyOptionKey`, `sortSettingEntries`. 런처와 같은 엄격 규칙. 바닐라 단축키는 1.21.1 `key_key.*` 목록(이동/게임플레이/인벤토리/멀티플레이/기타/크리에이티브)으로 구분하고, 그 밖의 `key_*`는 모드 단축키로 번역 키 첫 세그먼트를 그룹으로 삼는다(예: `key_iris.keybind.reload` -> `iris`). `version`/`resourcePacks`/`incompatibleResourcePacks`는 `reserved`.
- 작성: `buildSettingsPolicy({options, resourcePacks, configFiles, minecraftVersion?})` — 항목당 `state: 'unset'|'initial'|'required'`와 `value`. 키 정렬, 빈 섹션 생략, 설정 파일이 없으면 v1. 결과를 런처의 엄격 파서로 다시 파싱하고 형식 프로파일 검사까지 통과해야만 `{policy, json, bytes}`를 돌려준다(위반은 `SettingsError`). `serializeSettingsPolicy(policy)`는 같은 직렬화(2칸 들여쓰기, 끝 개행). `selectionFromPolicy(policy)`는 저장된 정책을 Studio 선택 상태로 되돌린다.
- 셰이더 도우미: `shaderSelectionToConfigFiles({configPath?, enabled, pack, packOptions})`, `shaderPackOptionsPath`, 상수 `IRIS_CONFIG_PATH`, `OCULUS_CONFIG_PATH`.
- 그 밖: `validConfigPath`, `assertConfigFilesNotSyncOwned`, `describeManagedSettings(policy).configFiles`.

### 한계

TOML/JSON/Forge `.cfg` 모드 설정(섹션·타입 있는 형식), 비ASCII 값, 줄 이어쓰기 파일은 지원하지 않는다. 설정 파일 값의 의미(예: 셰이더팩이 실제로 존재하는지)는 검사하지 않는다. Iris/Oculus 파일 관례는 문서 근거이며 실제 게임으로 확인하지 않았다.
