# USER-02 인계: 설정 정책 코어

- 세션: `launcher develop #2` / 브랜치 `feat/user-02-settings` / 기준 커밋 `72af685`
- 상태: 구현·단위 테스트 완료(통합 전). 최종 커밋 해시는 세션 보고에 기재.

## 변경 파일

- `packages/core/src/instance/settings/{types,policy,options,io,ownership,api,index}.ts`, `settings.test.ts`
- `docs/settings-policy.md`(스키마·동작 명세), 이 문서. 상위 export·기존 sync/deployment/minecraft 파일은 수정하지 않았다.

## 공개 API (`instance/settings/index.ts`)

| API | 설명 |
| --- | --- |
| `applySettingsPolicy(root, {signal?, ownership?})` | 잠금 아래 정책을 `options.txt`에 적용, `ApplySettingsResult` 반환(`status`, `enforcedKeys`, `initialApplied`, `initialSkipped`, `resourcePacks`) |
| `getResourcePacks(root, {signal?})` | 현재 팩 목록(`required` 구분), `missingRequired`, `requiredOutOfOrder`. 읽기 전용, 잠금 없음 |
| `setUserResourcePacks(root, packs, {signal?})` | 목록 교체. required 누락/순서 변경은 거부. 잠금 아래 |
| `classifySettingsPath(path, ownership)` | `required`/`initial-default`/`user` |
| `describeManagedFiles(ownership)`, `describeManagedSettings(policy)` | 관리 파일/항목 설명 |
| `assertOptionsNotSyncOwned`, `parseSettingsPolicy` | 검증 헬퍼 |

오류는 모두 `SettingsError`(`code`): `aborted`, `file-changed`, `invalid-argument`, `invalid-options`, `invalid-policy`, `invalid-state`, `io-error`,
`limit-exceeded`, `locked`, `options-owned-by-sync`, `required-pack-removed`, `required-pack-reordered`, `sync-not-initialized`, `unsafe-path`.

## 상한

정책 64 KiB, options.txt 1 MiB, settings.json 64 KiB, 맵당 키 512, 키 128자, 값 2048자, 목록당 팩 256, 팩 ID 256자, JSON 깊이 8.

## 결정(보수적 선택)

- 최초 구성 때 이미 존재하는 initial 키/`resourcePacks`는 덮어쓰지 않고 `user-value-present`로 건너뜀.
- 이후 추가된 initial 키는 `initial-skipped`(`already-configured`)로 보고만 함. 이유는 `docs/settings-policy.md`.
- options.txt의 중복 키는 수정하지 않고 `invalid-options`로 거부. required 팩 재정렬 요청은 `setUserResourcePacks`에서 거부.
- `initial-only`로 배포된 `options.txt`는 허용, `always`만 `options-owned-by-sync`.
- 읽기 API는 잠금을 잡지 않아 쓰기 중 일시적으로 `file-changed`가 날 수 있다.

## 검증

- `pnpm exec vitest run packages/core/src/instance/settings`: 27 통과
- `pnpm exec biome check packages/core/src/instance/settings`, `pnpm exec tsc --noEmit -p packages/core`: 오류 없음
- `biome check .` 및 `vitest run packages/core` 전체 통과. 전체 `pnpm check`는 apps/launcher typecheck에서 `prismarine-auth` 모듈 미설치(임시 toolchain 환경 문제, 이 변경과 무관)로 실패해 빌드 단계까지 진행하지 못함.

## 미검증 / 제약

- 실제 USER-01 `readSyncOwnership` 및 sync 엔진과의 통합, 실제 게임에서의 `options.txt` 호환(Minecraft가 다시 쓰는 형식) 미검증.
- Windows/macOS 실행 미검증(rename 원자성은 POSIX에서만 테스트). 리소스팩 파일 존재 여부는 검사하지 않음.
- symlink 거부는 테스트했으나 hardlink(nlink != 1)는 단위 테스트 없음.

## #0이 연결할 지점

1. `packages/core/src/index.ts`(또는 상위 export)에 `instance/settings` 연결.
2. 호출 순서 제안: 인증 -> 설치 -> `synchronizeDeployment` -> `readSyncOwnership`(USER-01) -> `applySettingsPolicy(root,{ownership})` -> `assertSynchronizedForLaunch` -> 게임 실행. 게임 잠금 전에 호출해야 한다(잠금을 쥐고 있으면 `locked`).
3. 운영자 도구(Studio)가 `options.txt`를 `always`로 배포하지 못하게 검증하는 지점은 이 모듈의 `assertOptionsNotSyncOwned`/`parseSettingsPolicy`를 재사용 가능(Studio 연결은 별도 작업).
4. 추가 요청 없음(의존성·공유 파일 변경 불필요).

## 후속: 실제 options.txt 호환 + 버전별 포맷 프로파일

- 브랜치 `feat/user-02-versioned-options`(기준 main `cd7377b`). 최종 커밋 해시는 세션 보고에 기재. 범위: `packages/core/src/instance/settings/**`, `docs/settings-policy.md`, 이 절.
- fixture: `settings/fixtures/options-1.21.1.txt` = 실제 1.21.1 클라이언트 파일(`/mnt/d/TorchLauncherSmoke/games/4444.../options.txt`)의 바이트 복사(CRLF, 140줄, `version:3955`). 계정·경로·토큰 값 없음(`lastServer:`는 빈 값, `soundDevice:""`) 확인, 값 제거 없음.
- 테스트(`profiles.test.ts`): 변경 없으면 쓰지 않음, 필수/초기/팩 적용 시 대상 줄만 바뀌고 CRLF·순서·`version:` 유지, `resourcePacks:[]` 위 필수 팩 추가, 재적용 멱등, 프로파일 선택/거부.
- 기본값 변경: 키 없을 때 기본 팩 목록 `["vanilla"]` -> `[]`. 근거: 실제 1.21.1 파일과 위키 기본값. 기존 테스트는 모두 통과(36개).
- 구조/지원 표/출처/미구현 목록은 `docs/settings-policy.md`의 "버전별 형식 프로파일" 절 참조. 요약: 검증은 `java-1.21.1`(3955)뿐, `java-1.13-1.21`은 미검증(조사 기반)이며 `versionPolicy: 'allow-researched'` 선택 시에만 사용.
- 새 오류 코드 `unsupported-options-version`. 새 옵션 `minecraftVersion`, `versionPolicy`(apply/getResourcePacks/setUserResourcePacks), 결과 필드 `formatProfile`, `warnings`(`ApplySettingsResult.warnings`는 필수 필드 추가).
- 제약: 기본 `verified-only`라서 1.21.1(3955) 외 데이터 버전 파일은 호출자가 정책을 고르지 않으면 거부된다(1.21 등 연동 시 #0이 정책 결정). 파일에 `version:`이 없고 `minecraftVersion`도 없으면 기존처럼 1.21.1 프로파일로 처리.

## 후속: 데이터 버전 3955 초과 options.txt 프로파일 (브랜치 `feat/user-02-newer-versions`, 기준 main `4320567`)

- 범위: `packages/core/src/instance/settings/**`, `docs/settings-policy.md`, 이 절. 최종 커밋 해시는 세션 보고에 기재.
- 추가: 프로파일 `java-1.21.2+`(데이터 버전 3956–5023 = 1.21.2–26.3, 근거 "미검증(조사 기반)", `allow-researched` 이상에서만 사용). `LATEST_RESEARCHED_DATA_VERSION`(5023) 초과 데이터 버전은 `allow-any`만 이 프로파일로 처리(경고). `verified-only` 기본 동작과 1.21.1(3955) 검증 프로파일은 불변. 기존 API/오류 코드 호환.
- 조사 출처/날짜(2026-10-22)와 판단은 `docs/settings-policy.md`의 "3955 초과 조사 결과" 절 참조. 요약: Options.txt 위키 표에 1.21.2~26.3 구간의 `version`/`resourcePacks`/줄 구조 변경 기록 없음(옵션 추가·삭제만), 26.3-snapshot4에서 미정의 키 코드 표기만 변경(비숫자 유지).
- 확신 없어 미지원: 3955 이후 팩 ID 표기 변화(위키 서술 없음), 26.3 이후 릴리스, 실파일 검증. 데이터 버전 값은 WebFetch 요약에서 가져왔으므로 구현 전 Data_version 위키와 대조 권장.
- 테스트: `profiles.test.ts`에 조사 기반 테스트 추가(합성 `version:` 입력; 3956–5023 선택/기본 거부/옵트인, 숫자 키코드 거부, 호출자 버전 선택·불일치 거부, 5024 `allow-any`). 3955 fixture 테스트 불변. core settings vitest 39개 통과.
