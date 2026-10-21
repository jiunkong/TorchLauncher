# USER-03 서버 데이터 경로·용량·삭제 코어

- 세션: `launcher develop #3` (구현 worker)
- 브랜치 / worktree: `feat/user-03-data` / `.agents/worktrees/agent-3`
- 기준 커밋: `72af685` (main)
- 범위: 코어만. UI·IPC·renderer 연결, 상위 export 연결은 하지 않았다.

## 변경 파일

모두 신규이며 독점 범위 안이다. 기존 `minecraft/`·`sync/`·`loaders/` 파일은 import만 했다
(`minecraft/lock.ts`의 `acquireServerDataLock`·`ServerDataLockedError`, `minecraft/filesystem.ts`의 `stat`).

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/instance/data/errors.ts` | `ServerDataError`(`code`), 오류 코드 타입, 취소 검사 |
| `packages/core/src/instance/data/paths.ts` | UUID v4·base 검증, `resolveServerDataRoot`, realpath 기반 루트 검증 |
| `packages/core/src/instance/data/marker.ts` | 루트 표식·삭제 진행 표식 읽기/쓰기, 잠금 상태 조회, `ensureServerDataRoot` |
| `packages/core/src/instance/data/usage.ts` | 상한 있는 링크 미추적 순회, `getServerDataUsage` |
| `packages/core/src/instance/data/deletion.ts` | `previewServerDataDeletion`, `deleteServerData`, 확인 토큰 |
| `packages/core/src/instance/data/list.ts` | `listServerData` |
| `packages/core/src/instance/data/index.ts` | 모듈 공개 API (상위 미연결) |
| `packages/core/src/instance/data/data.test.ts` | 행동 테스트 28개 (임시 디렉터리) |
| `docs/handoffs/USER-03.md` | 이 문서 |

## 공개 API

모든 함수는 Electron 비의존 비동기 API이며 실패는 `ServerDataError`(`code`)로 던진다.
`userDataBase`는 Electron `app.getPath('userData')`처럼 **이미 존재하는** 절대·정규화 경로여야 한다.

```ts
resolveServerDataRoot(userDataBase, serverId): string            // 순수, 파일시스템 미접근
ensureServerDataRoot(userDataBase, serverId, { adoptExisting? }) // 루트·표식 생성/확인
getServerDataUsage(userDataBase, serverId, { signal, onProgress, limits })
previewServerDataDeletion(userDataBase, serverId, { signal, onProgress, limits, confirmationTtlMs })
deleteServerData(userDataBase, serverId, confirmationToken, { signal, onProgress })
discardDeletionConfirmation(token)                               // 사용자가 대화상자 취소 시
listServerData(userDataBase, { includeUsage, signal, limits })
readServerDataMarker(root, serverId), inspectServerDataLock(root) // 읽기 전용 보조
```

- 용량 결과: `{ status: 'complete', bytes, files, directories, links, others, root }` 또는
  `{ status: 'limit-exceeded', limit: 'entries' | 'depth' | 'time', root }`. 상한 초과 시 부분 합계는 반환하지 않는다.
  링크(symlink, Node가 symlink로 보고하는 junction)는 `links` 개수로만 세고 따라가거나 크기에 넣지 않는다.
  트리 안의 하드링크는 `dev:ino`로 한 번만 합산한다. 진행 콜백 `{ entries, bytes }`는 256개마다와 완료 시.
- 미리보기: `{ serverId, root, exists, marker, deletionInProgress, lock, usage, deletable, blockers, confirmation? }`.
  `blockers`는 `root-not-found | unsafe-path | marker-missing | marker-invalid | marker-mismatch | locked | limit-exceeded`.
  `confirmation`(`token`, `expiresAt`)은 `blockers`가 비었을 때만 발급한다.
- 삭제 결과: `{ status: 'deleted', root, removedEntries, removedBytes }`(표식 파일 제외).
  진행 콜백 `{ phase: 'deleting' | 'finalizing', removedEntries, removedBytes, expectedEntries? }`.
- 목록: `{ serversPath, servers: [{ serverId, root, deletionInProgress, lock, usage? }], unrecognized: [{ name, path, reason }] }`.
  `reason`은 `not-server-id | not-directory | unsafe-path | marker-missing | marker-invalid | marker-mismatch | deletion-marker-invalid`.
  `unrecognized` 항목은 표시만 하며 표식 추가·삭제를 하지 않는다. `servers/` 없으면 빈 목록.

## 오류 코드

| 코드 | 의미 / UI 처리 |
| --- | --- |
| `invalid-server-id` | 소문자 UUID v4 아님 |
| `invalid-base` | base가 상대/비정규화/파일시스템 루트/없음/링크/디렉터리 아님 |
| `unsafe-path` | `servers`·루트가 링크(또는 junction)거나 디렉터리 아님, realpath가 `<realBase>/servers/<id>`와 다름, 삭제 중 디렉터리 교체 감지 |
| `root-not-found` | 서버 루트 없음 |
| `marker-missing` / `marker-invalid` / `marker-mismatch` | 표식 없음 / 손상·4 KiB 초과·추가 키·링크 / 다른 서버 표식 |
| `unmarked-root` | `ensureServerDataRoot`가 표식 없는 비어 있지 않은 기존 폴더를 만남(`adoptExisting` 미지정) |
| `locked` | 게임·설치·유지보수 잠금 보유 중 (`ServerDataLockedError` 변환) |
| `confirmation-required` | 토큰 없음·위조·만료·이미 사용·다른 서버/base용 |
| `target-changed` | 미리보기 후 루트가 삭제·재생성(dev/ino 또는 표식 `rootId` 변화) |
| `limit-exceeded` | 순회 상한(목록 4096개, 삭제 깊이 256) 초과 |
| `aborted` | 취소, 삭제는 아직 아무것도 지우지 않음 |
| `deletion-incomplete` | 일부 삭제 후 중단·실패. `cause`가 원인 `ServerDataError`(`aborted`, `io-error`, `unsafe-path`, `locked` 등). 다시 미리보기 → 삭제로 이어서 진행 |
| `io-error` | 기타 파일시스템 오류(메시지에는 errno 코드만) |

## 상한

| 항목 | 기본값 |
| --- | --- |
| 용량 순회 엔트리 수 | 1,000,000 (`limits.maxEntries`) |
| 용량 순회 깊이 | 64 (`limits.maxDepth`, 루트 자식 = 1) |
| 용량 순회 시간 | 120초 (`limits.timeoutMs`) |
| 표식 / 잠금 owner 파일 | 4 KiB |
| `servers/` 직속 항목(목록) | 4096 |
| 삭제 재귀 깊이 | 256 |
| 확인 토큰 | 32바이트 난수, 10분 TTL, 1회용, 메모리 보관 최대 32개 |

## 삭제 안전 설계

1. **대상 고정**: 경로는 `<base>/servers/<uuid>`로만 계산하고, base·`servers`·루트를 `lstat`으로 링크 아닌
   디렉터리인지 확인한 뒤 `realpath(root) === join(realpath(base), 'servers', id)`를 요구한다. base, 다른 서버,
   형제 디렉터리(`accounts`, `.minecraft` 등)는 경로 계산상 대상이 될 수 없다.
2. **소유 표식**: `.torchlauncher-root.json` = `{ format: 'torchlauncher-server-data-root', version: 1, serverId, rootId, createdAt }`.
   키 집합이 정확히 일치해야 하고 `O_NOFOLLOW`·inode 재확인·4 KiB 상한으로 읽는다. `rootId`는 루트별 난수라
   삭제 후 재생성된 루트에는 이전 확인이 통하지 않는다. 표식 없는 기존 폴더는 삭제·자동 편입하지 않는다.
   빈 기존 폴더만 자동으로 표식을 쓴다. 표식 쓰기는 maintenance 잠금 아래 `wx`로 한다.
3. **확인 토큰**: 미리보기가 base·serverId·realpath·루트 dev/ino·`rootId`에 묶인 1회용 토큰을 발급한다.
   삭제는 토큰을 소비한 뒤 대상을 재검증하고, maintenance 잠금을 얻은 뒤 **다시** 재검증한다.
   미리보기는 잠금 획득·디렉터리 생성·쓰기를 하지 않는다(잠금은 `inspectServerDataLock`으로 조회만).
4. **삭제 순서**:
   1. maintenance 잠금 획득(실패 시 `locked`, 아무것도 지우지 않음).
   2. 잠금 아래 재검증 후 삭제 진행 표식 `.torchlauncher-deletion.json`(serverId·rootId)을 `wx`로 기록.
   3. 루트 직속의 표식 2개와 잠금 디렉터리를 제외한 내용을 깊이 우선으로 제거. 매 엔트리 `lstat`;
      링크/junction은 `unlink`(Windows에서 EPERM/EISDIR이면 `rmdir`로 reparse point만 제거)하고 따라가지 않는다.
      디렉터리는 들어가기 전 dev/ino가 직전 `lstat`과 같은지 확인하고 비재귀 `rmdir`로 지운다.
      Windows 읽기 전용 파일은 재 `lstat`으로 링크가 아님을 확인한 뒤에만 `chmod` 후 재시도한다.
   4. 성공·실패와 무관하게 잠금 해제(잠금 디렉터리는 루트 안이므로 마지막 단계 전에 처리해야 한다).
   5. 마무리: 대상 재검증, 루트에 표식 2개 외에 아무것도 없을 때만 삭제 진행 표식 → 루트 표식 → `rmdir(root)` 순으로 제거.
      그 사이 새 항목(다른 프로세스의 잠금 등)이 생기면 표식을 지우지 않고 `deletion-incomplete`.
5. **재시도**: 2단계 이후의 모든 실패·취소는 `deletion-incomplete`. 루트 표식이 남아 있으므로 다시 미리보기
   (`deletionInProgress: true`, `deletable: true`) → 삭제로 이어간다. 삭제 진행 표식이 있으면
   `ensureServerDataRoot`가 `deletion-incomplete`로 거부해 반쯤 지운 루트에 설치·실행이 진행되지 않게 한다.
   루트 표식 제거 후 `rmdir` 전에 프로세스가 죽으면 빈 무표식 폴더만 남으며, 데이터가 없고 `ensureServerDataRoot`가 다시 편입한다.

### 남는 위험 / 제약

- Node에는 `openat`/`unlinkat`이 없어 `lstat`과 `readdir`/`unlink` 사이 경쟁(디렉터리를 링크로 바꿔치기)을
  완전히 막을 수 없다. dev/ino 재확인과 협조적 잠금으로 범위를 좁혔고, `rmdir`·`unlink`는 링크를 따르지 않는다.
- 잠금 해제(4)와 마무리(5) 사이에 다른 런처 프로세스가 잠금을 잡으면 마무리를 멈추고 `deletion-incomplete`가 된다.
  UI/main은 삭제 중 같은 서버의 설치·실행을 직렬화해야 한다.
- 프로세스가 잠금 보유 중 강제 종료되면 기존 잠금 계약대로 stale lock이 남아 `locked`가 된다(수동 복구, 기존 정책).
- `acquireServerDataLock`의 `secureDirectory`는 base 상위 경로의 symlink도 거부한다. macOS의 `/var`→`/private/var`처럼
  상위가 링크인 위치에서는 잠금이 실패한다(이 모듈 밖의 기존 동작).
- 확인 토큰은 프로세스 메모리에만 있으므로 main 프로세스에서 미리보기·삭제를 같이 호출해야 한다.
- 하드링크로 트리 밖과 공유된 파일은 이름만 지워지고 다른 이름의 내용은 보존된다(용량 표시는 트리 내부 기준).

## 검증

환경: WSL2 Linux, Node 24.21.0, 임시 디렉터리는 `/tmp`(ext4).

- `vitest run packages/core/src/instance/data`: 27 통과, 1 skip(Windows junction, `process.platform !== 'win32'`).
  포함: 경로·UUID·base 거부, 표식 생성·멱등·편입 거부/허용·불일치·손상·과대·링크 표식 거부, 용량(링크 미추적,
  하드링크 1회, 엔트리·깊이·시간 상한, 취소), 미리보기 무부작용·차단 사유, 정상 삭제와 형제·다른 서버·base·`.minecraft`·
  `accounts`·바깥 symlink 대상 보존, 토큰 위조·만료·재사용·타 서버, 잠금 중 거부, 재생성·표식 제거 후 거부,
  시작 전 취소, 중간 취소 후 재시도, 권한 오류(`chmod 0500`, root 사용자가 아닐 때만) 후 재시도, 목록.
- `biome check packages/core/src/instance/data`, `tsc -p packages/core/tsconfig.json`: 통과.
- `pnpm check`(Biome 149파일, 전체 typecheck, Vitest 28 파일 통과·4 skip, 테스트 578 통과·7 skip, admin·launcher 빌드): 통과.

### 미검증

- Windows junction·기타 reparse point(OneDrive 자리표시자, dedup 등): junction 제거 코드 경로(`unlink` → EPERM/EISDIR 시 `rmdir`)와
  win32 전용 테스트(`removes a Windows junction without touching its target`)만 있고 실행하지 않았다. Node가 symlink로 보고하지 않는
  reparse point는 일반 파일/디렉터리로 취급된다. Windows 읽기 전용 파일 `chmod` 경로도 미실행.
- macOS 실행 전무(대소문자 무시 파일시스템에서 realpath 비교 포함).
- 실제 게임 실행 중 삭제 차단은 lock 단위 테스트로만 확인(실제 게임 프로세스와의 통합 아님).

## #0 연결 지점 / 요청

- `packages/core/src/index.ts` 또는 별도 subpath export(`@torchlauncher/core/data` 등)에 `./instance/data` 연결 필요(공유 파일, 미수정).
- 런처 main: 서버 데이터 루트 생성 시 `ensureServerDataRoot(app.getPath('userData'), serverId)`를 설치·동기화 전에 호출하도록
  게임/sync 진입점 연결. 이미 존재하는 개발용 루트를 런처 소유로 편입하려면 사용자 확인 후 `adoptExisting: true`.
- 삭제 UI: `previewServerDataDeletion` 결과의 `root`와 `usage`를 보여주고 확인 시 같은 프로세스에서 `deleteServerData(..., token)`.
  `deletion-incomplete`는 재시도 버튼으로, `locked`는 "게임/설치 실행 중" 안내로 매핑. 취소 시 `discardDeletionConfirmation`.
- 인증 데이터(`userData/accounts`, `userData/public-java`)는 `servers/` 밖이라 구조상 대상이 아니다.
