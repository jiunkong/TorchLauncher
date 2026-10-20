# FMT-02 인계

- 작업: FMT-02 — 확정된 v1 계약을 사용하는 단일 배포 파일 writer.
- 담당: `launcher develop #1` / TorchLauncher worker #1.
- 브랜치: `feat/fmt-02-writer`.
- Worktree: `.agents/worktrees/agent-1`.
- 기준: `58fe23ea2c7d13e52d63a9e6f69220c04df359c2`.
- 구현 커밋: `33e36bbac8e1bbcd26b77ec7f5d89708c560b468` —
  `feat(core): stream atomic single-file deployment writes`.
- 최종 test-only 수정 커밋: 인계 문서를 포함하는 커밋. 자기 참조를 피하고자 해시는 최종
  응답과 #0 완료 메시지에 별도로 제공한다. 통합과 완료 판정은 #0 소유이며 `main`에 직접
  반영하지 않았다.

## 변경 범위와 API

수정은 `packages/core/src/deployment/writer/**`와 이 인계 문서뿐이다.

- `types.ts`: 입력 파일, 진행 이벤트, 생성 옵션과 결과 타입.
- `writer.ts`: preflight, 파일 시스템 입력 검사, 스트리밍 SHA-256/독립 gzip, 임시 payload와
  완성 컨테이너 생성, 마지막 rename을 통한 게시, 취소/실패 정리.
- `index.ts`: writer 내부 진입점. 패키지 manifest/루트 export를 추가하지 않았다.
- `writer.test.ts`: 41개 테스트와 작은 독립 검증기. 제품 reader는 포함하지 않았다.

```ts
import { writeDeployment } from './deployment/writer/index.js';

const result = await writeDeployment({
  sourceRoot: '/absolute/pack-root',
  outputPath: '/existing/output-parent/server.torchpack',
  serverId: project.serverId,
  deploymentId: newDeploymentId,
  game: { minecraftVersion: '1.21.1', loader: { kind: 'neoforge', version: '21.1.200' } },
  files: [
    { sourcePath: 'mods/server.jar', compression: 'none', policy: 'always' },
    {
      sourcePath: 'config/settings.toml',
      path: 'config/서버 설정.toml', // optional: defaults to sourcePath
      compression: 'gzip',
      policy: 'initial-only',
    },
  ],
  signal,
  onProgress: async (event) => { /* optional, awaited for backpressure */ },
});
// result = { outputPath: canonicalOutputPath, header, index }
```

`sourcePath`는 sourceRoot 내부 실제 디스크 이름의 slash-separated 상대 경로다. NFD로
저장된 실제 파일명은 그대로 읽고, 컨테이너 목적 경로는 NFC로 변환한다. 목적 경로의
정규화/대소문자/파일-prefix 충돌과 나머지 계약 검증은 기존 FMT-01 validator를 재사용한다.
입력 목록 순서를 페이로드 순서로 유지한다. 빈 입력 파일 목록도 허용한다. 명시적인
`compression`은 `none`/`gzip`만 받으며, 빈 gzip 입력은 규격에 맞게 `none`으로 기록한다.
gzip이 규격의 1000:1 압축률 제한을 넘으면 `limit-exceeded`로 실패한다. 자동 압축 선택이나
압축률 실패 시 숨은 fallback은 없다. 호출자는 재시도 시 `none`을 선택할 수 있다.

`onProgress`의 `reading` 이벤트는 sourcePath와 해당 파일의 누적 원본 바이트 수를,
`assembling`은 전체 저장 payload의 복사 누적 바이트 수를 전달한다(시작 이벤트는 0).
콜백은 await하므로 느린 UI/작업 어댑터가 backpressure를 걸 수 있다. 콜백 예외도 실패로
전파해 게시를 막는다. 입력 파일·게임 metadata는 첫 await 전에 복사해 호출자 변경과 분리한다.

## 안전성과 자원 사용

- 실제 컨테이너 헤더는 규격의 64바이트 little-endian 구조다. 인덱스는 제한을 확인하며
  구성하는 UTF-8 JSON이고 저장한 원본 바이트의 SHA-256을 헤더에 넣는다. 파일 hash는
  원본 바이트 기준이다. 최종 index/header를 기존 validator로 다시 검사한 뒤 게시한다.
- 전체 원본/컨테이너를 메모리에 모으지 않는다. 입력 읽기와 payload 복사는 최대
  256 KiB 청크이고 gzip은 파일별 독립 스트림이다. 인덱스만 최대 16 MiB까지 버퍼링한다.
  zlib/stream 버퍼와 bounded metadata 객체는 별도로 존재한다. 작업 디스크에는 기존
  결과물 외에 저장 payload 약 2배 + 인덱스/헤더 공간이 필요하다.
- sourceRoot 자체 링크, 하위 경로 링크, 비정규 파일과 nlink != 1인 다중 hard link 입력을
  거부한다. 경로 이탈·backslash·drive/제어 문자·빈/dot 구성 요소를 거부하고 실제 경로의
  root containment를 검사한다. sourceRoot/output parent 위의 OS 경로 alias는 realpath로
  고정한다. 기존 output의 symlink/비정규 파일과 input/output 동일 파일은 거부한다.
- 입력 디렉터리는 dev/ino/mode를, 파일은 dev/ino/mode/size/mtimeNs/ctimeNs/nlink를
  확인한다. 파일 fd를 열 때 가능한 OS에서는 O_NOFOLLOW/O_NONBLOCK를 사용한다.
  읽기 전후 및 게시 직전 경로/파일/디렉터리를 재검사한다. append·truncate·동일 크기
  수정·파일 교체·부모 디렉터리 교체를 감지하면 기존 결과물을 보존하고 실패한다.
- 출력 부모의 private `.torchpack-*` 디렉터리에 payload와 candidate를 생성한다.
  candidate 파일은 sync/close 후, 소스와 기존 output이 바뀌지 않았는지 재검사한다.
  마지막 signal 검사 다음의 같은 부모 파일 시스템 내 rename이 commit 지점이다.
  이전 출력은 쓰기 모드로 열지 않는다. 그 전 취소·실패 시 staging을 제거한다.
  commit 뒤 늦은 취소는 결과를 취소하지 않는다. 성공 후 빈 임시 디렉터리 삭제만 실패한
  경우 결과를 되돌리거나 이미 게시된 결과를 실패로 보고하지 않는다.
- 자체 실패는 `DeploymentWriteError.code`(`invalid-input`, `unsafe-path`, `source-changed`,
  `output-changed`, `limit-exceeded`)로 구분한다. FMT-01 오류와 native fs/zlib/AbortError,
  progress 콜백 예외는 유지한다. 기존 output을 다른 actor가 변경하면 덮어쓰지 않는다.

## 검증

Linux x64 / WSL2, Node.js `24.21.0`, pnpm `10.34.7`.
명령은 이 worktree에서 `PATH=/tmp/torchlauncher-tools/node_modules/.bin:$PATH`로 수행했다.

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile --store-dir /tmp/torchlauncher-pnpm-store` | 성공, 기존 전용 node_modules 사용, manifest/lockfile 변경 없음 |
| `pnpm exec biome check --write packages/core/src/deployment/writer` | 성공, writer 범위만 포맷 |
| `pnpm --filter @torchlauncher/core typecheck` | 성공 |
| `pnpm exec vitest run packages/core/src/deployment/writer/writer.test.ts` | 41개 성공 |
| `pnpm check` | lint·전체 TypeScript·326개 테스트(기존 285 + writer 41)·두 앱 build 성공 |
| `git diff --check` 및 staged diff 검사 | 성공 |

독립 test-only 검증기는 writer의 encoder/validator를 호출하지 않고 바이너리 헤더,
인덱스 원본 해시/길이, payload-relative 연속 범위, gzip의 단일 deflate 스트림과 trailer,
압축 해제 바이트·원본 길이·원본 SHA-256·최종 컨테이너 길이를 확인한다. Minecraft
1.21.1의 Fabric/NeoForge metadata, plain/gzip/빈 파일, 한글/NFD/NFC 경로, 고정 metadata
반복 생성, 기존 출력 교체, 경로/링크/충돌/파일·인덱스 크기, 입력 변경과 취소/콜백 실패,
외부 output 변경, 임시 파일 정리, 8 MiB 이상 청크 읽기를 검증했다.

초기 실행의 두 timeout은 테스트 데이터가 인덱스 한도보다 작았던 문제와 큰 Buffer의
느린 deep equality 비교 때문이었다. 한도를 실제 초과하는 metadata를 사용하고 바이트
비교를 Buffer.equals로 고쳐 최종 검사를 통과했다.

## 제한과 후속 작업

- 파일 시스템 전체의 atomic snapshot이나 적대적인 프로세스에 대한 sandbox는 아니다.
  정상 편집 중 발생하는 metadata/identity 변경을 감지한다. 중간 디렉터리를 원자적으로
  고정하는 openat 계열이나 OS별 handle-relative API는 이 구현에서 사용하지 않는다.
  마지막 검사 후 rename 사이의 악의적인 directory/output 교체까지 보장하지 않으므로
  source/output 부모는 신뢰된 디렉터리에서 사용하고 동일 output에 동시 writer를 실행하지 않는다.
- 강제 종료/전원 장애 시 staging이 남을 수 있다. parent-directory fsync, crash recovery,
  stale staging 청소는 이 작업에 포함하지 않는다. 기존 결과물을 미리 삭제하거나 실패 시
  제거한 뒤 재생성하는 fallback은 없다. cleanup 자체의 fs 오류는 게시 전에는 전파된다.
- 실제 최대 4 GiB 파일/64 GiB 컨테이너 생성이나 메모리 benchmark는 수행하지 않았다.
  oversized sparse stat 거부·인덱스 한도·multi-chunk 동작을 테스트했다. 실제 Windows/macOS
  파일 시스템 alias·권한·rename·symlink 정책은 별도 OS 검증이 필요하다.
- Windows 계정의 symlink privilege 차이 때문에 symlink를 생성하는 테스트만
  `EPERM`/`EACCES`/`ENOTSUP`/`ENOSYS` 응답에서 capability skip한다. 그 외 오류는 실패한다.
  hard link, directory input, output/input alias 검사는 별도 테스트라 skip 대상이 아니다.
  이 worktree의 Linux/WSL run은 symlink 생성이 가능해 46개 모두 통과했다. Windows에서
  해당 symlink 거부 검증이 실행되었다는 뜻은 아니다.
- unsigned v1의 신뢰 경계는 그대로다. 서명/anti-rollback, 제품 reader, HTTP/Drive,
  Studio 파일 선택/UI/worker 연결, SYNC 적용·혼합 설정 정책은 구현하지 않았다.
- public export는 후속 공유 파일 배정 대상이다. 내부 상대 경로로만 검증했으며 새로운
  의존성·기존 contracts·공유 설정·앱 진입점·IPC·진행 문서는 변경하지 않았다.
- Electron smoke는 API/IPC/앱을 바꾸지 않은 이 작업에서 재실행하지 않았다. 두 앱 build는
  통과했다. 실제 게임 실행·서버 접속이나 Drive 업데이트를 검증한 결과로 취급하지 않는다.

#0에게 API와 검증/제한을 먼저 전달했다. 후속 작업은 자동 착수하지 않는다.

## Windows temp/symlink 검토 반영

기준 commit `525ddf2dd3f6ca3d77d22c816b7b422fc49ebeae` 뒤에 test 전용 보완을 했다.
테스트 scratch root를 `realpath(tmpdir())` 아래 만들어 host temp alias를 고정한다.
symlink source file, parent directory, source root, external target, output 사례를 분리했다.
링크 생성 자체가 해당 권한 제한 목록으로 실패하는 테스트만 Vitest capability skip 한다.
hardlink/directory/output input alias 사례는 개별 non-symlink 테스트에 남겨 두었다.

수정 후 검증: `pnpm exec vitest run packages/core/src/deployment/writer/writer.test.ts`
46개 통과(현재 Linux host에서 skip 0); `pnpm --filter @torchlauncher/core typecheck`
통과; `pnpm exec biome check .` 전체 파일 59개 통과. 이 test-only 변경에는 추가 full
`pnpm check`/app build를 반복하지 않았다.
