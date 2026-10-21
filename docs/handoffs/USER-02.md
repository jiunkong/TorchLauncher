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
