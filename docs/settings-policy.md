# 설정 정책 v1 (`torchlauncher/settings-policy.json`)

USER-02 코어 명세. 구현: `packages/core/src/instance/settings/`. UI/IPC 연결은 아직 없다.

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

`resourcePacks:["vanilla","file/foo.zip"]`(JSON 배열)를 관리한다. 키가 없으면 Minecraft 기본값 `["vanilla"]`로 간주한다.

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
`options-owned-by-sync`, `required-pack-removed`, `required-pack-reordered`, `sync-not-initialized`, `unsafe-path`. 모두 `SettingsError.code`.
