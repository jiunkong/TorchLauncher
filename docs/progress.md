# TorchLauncher 개발 진행 관리

최종 갱신: 2026-10-21

이 파일을 작업 상태·담당·머지 현황의 기준으로 사용한다. 제품 요구사항은
[아키텍처](architecture.md), 단계의 목적과 완료 기준은 [구현 순서](implementation-plan.md)를 따른다.

## 현재 상태와 다음 작업

- 사용자 승인으로 FMT-03 배포 reader를 #2에 배정하고, 통합 후 SYNC-01을 같은 세션에서 이어간다.
  reader는 Luna(명세 기반 구현), sync는 Sol(소유권·실패 복구)로 작업별 전환한다.
  실제 업로드가 필요한 검증은 #0이 테스트 산출물을 준비한 뒤 사용자에게 요청한다.
- FMT-03을 `9c0dd04`(구현 `375e50e`)로 통합했다. 메인 reader/writer 58개 테스트,
  core TypeScript·scoped Biome 성공. SYNC-01은 [범용 동기화 기준](synchronization.md)에 따라 이어서 구현한다.
- 최신 사용자 결정: 자체 앱 ID 승인·최종 연결은 마지막 단계로 미루고, 개발 중에는 임시 공개
  Java Title ID 인증을 사용한다. AUTH-03 구현을 `a7eba73`으로 통합했다. smoke 기본은
  `public-java`이며 기존 own-app 경로는 명시적 옵션으로 유지한다. Windows 실계정 cycle은 사용자 보고로 성공했다.
  첫 대화형 로그인에서 결과 없이 Electron이 종료된 문제도 `758909b`로 수정 통합했다.
- AUTH-03 통합 검사: `pnpm check` 성공(474개 통과, 기존 실환경 테스트 3개 생략),
  두 앱 빌드와 Electron 화면·IPC·격리·샌드박스 smoke 성공. 공개 ID 실계정 로그인 성공을 뜻하지 않는다.
  메인의 `worker-check`도 pinned 3.1.1 임시 번들 로딩·종료에 성공했다(네트워크·로그인 없음).
  구현 커밋은 `ccac0c7`, 상세 인계와 Windows 명령은 [AUTH-03](handoffs/AUTH-03.md)를 따른다.

- 프로젝트 기반 구축과 Linux 검증은 완료했다. 배포 규격 계약·Range 전송·인증·Minecraft 설치 코어를 통합했다. 앱 연결·실계정 로그인·실제 게임 실행·동기화·Studio 제품 기능은 남아 있다.
- Git 기준 커밋 `4d5b4ab`과 `main`, 네 작업 브랜치·worktree를 준비했다.
- 전체 총괄은 사용자 지정 `#0` 에이전트인 **`launcher develop #0`**이다. #0은 제품 기능을
  구현하지 않고 배정·문서·검토·Git 통합·통합 검증을 맡는다.
- 첫 작업은 #1 FMT-01, #2 DL-02, #3 GAME-01, #4 AUTH-01로 배정했다.
  네 세션의 첫 작업과 검토 수정을 머지했다. #2는 Luna, 나머지는 총괄 모델 상속으로 실행했다.
- AUTH-01과 GAME-01의 이번 코어 범위와 남은 호스트 연결·실환경 검증을 분리했다.
  원래의 제품 완료 기준을 줄이지 않고 AUTH-02·GAME-04·GAME-05로 추적한다.
- 사용자 결정으로 연결 해제 시 게임 자동 종료와 이를 위한 보조 모드를 제외했다.
  MOD-01·MOD-02는 취소했다. 서버 직접 접속은 유지한다.
- 2차 작업 시작 승인에 따라 #1 FMT-02, #2 DL-01, #3 GAME-04, #4 AUTH-02를 배정했다.
  범위와 완료 기준은 [2차 작업 배정](work-distribution.md#2차-작업-배정--2026-10-21)을 따른다.
- 네 세션의 2차 구현과 검토 수정을 모두 머지했다. `pnpm check`가 447개 테스트 성공,
  opt-in 실제 설치 테스트 1개 기본 skip, 전체 타입·린트·두 앱 빌드 성공으로 끝났다.
  이후 Drive 실파일 버전 교체도 검증했다. #4의 사용자 테스트는 앱 등록·개인 계정 설정 후
  Microsoft/Xbox 교환을 진행했으나 Minecraft 토큰 교환에서 HTTP 403으로 중단됐다. 전체 인증 cycle은 미완료다.
- 사용자가 Drive 공개 테스트 링크를 제공했다. #2에 `test/dl-01-live-drive` 브랜치로
  첫 버전의 익명 Range 검증을 배정한다. 파일 교체는 첫 검증 후 별도 요청하며 아직 하지 않는다.
- Drive 첫 버전 실검증 성공: 78,641,842 bytes 파일에서 1-byte probe와 처음·중간·끝
  64 KiB 및 중간 반복 구간이 실제 HTTP 206·정확한 범위·일관된 snapshot을 반환했다.
  중간 반복 SHA-256이 일치했다. 전체 파일 비교는 16 MiB 상한을 넘어 생략했다.
  이어 v1 소스를 유지한 채 사용자의 버전 교체를 확인했다. 이전 소스가 변경을 감지하고,
  reset 후 같은 공유 링크에서 새 크기 78,641,731 bytes와 변경된 중간·끝 구간을 받았다.
  새 중간 반복 해시도 일치했으며 다른 버전 바이트를 이전 소스 결과로 수락하지 않았다.
- [세션별 작업 지시문과 수정 범위](work-distribution.md)를 따른다. FMT-01 계약을 우선 통합하고
  후속 writer·reader·Studio 작업을 연결한다. 독립적인 첫 작업 네 개는 병렬 착수할 수 있다.

## 총괄과 에이전트 역할

| 역할 | 담당 | 책임 |
| --- | --- | --- |
| 전체 총괄 | `#0` — 현재 `launcher develop #0` | 제품 구현 제외. 작업 분배·범위 조정, 이 진행 문서 갱신, 통합 검토·Git 머지·통합 충돌 해결·검증·완료 판정 |
| 구현 에이전트 | 그 외 작업 세션 | 배정된 브랜치·worktree에서 구현·테스트·커밋 후 총괄에게 인계 |

- **이 진행 문서 수정과 `main` 또는 별도 지정한 통합 브랜치로의 반영은 `#0`만 수행한다.**
  통합 목적의 merge·cherry-pick과 그 충돌 해결도 총괄이 관리한다.
- 구현 에이전트는 자기 작업을 통합 브랜치에 직접 머지하지 않는다. 자기 브랜치를 최신 통합
  기준으로 갱신하는 것은 가능하며, 변경과 검증 결과를 인계한다.
- 역할 변경은 사용자의 지정을 따른다. 작업 인계 시 담당 세션 이름을 함께 기록한다.

## 상태와 운영 규칙

| 상태 | 의미 |
| --- | --- |
| 준비 | 선행 작업이 충족되어 담당 배정 가능 |
| 대기 | 선행 작업 또는 설계 결정 필요 |
| 진행 | 담당·브랜치·수정 범위를 배정하고 작업 중 |
| 검토 | 구현과 브랜치 검증 완료, 통합 검토 중 |
| 머지 대기 | 검토 완료, 통합 브랜치 반영 대기 |
| 완료 | 통합 기준에 반영되고 필요한 검증 완료 |
| 차단 | 외부 조건·오류 때문에 진행 불가. 원인과 해제 조건 기록 필요 |
| 취소 | 사용자 결정 등으로 범위에서 제외. 구현 완료를 뜻하지 않으며 후속 작업의 선행 조건에서 제거 |

- **통합 담당자인 `#0`만 이 파일의 상태와 담당을 갱신한다.** 여러 에이전트가 동시에 수정하지 않는다.
- 착수 전 작업 ID, 에이전트, 브랜치, worktree, 수정할 파일 범위를 등록한다.
- 각 에이전트는 별도 브랜치·별도 worktree를 사용한다. 같은 작업 폴더에서 동시에 checkout하지 않는다.
- 선행 작업은 원칙적으로 통합 브랜치에 반영된 후 사용한다. 공유 계약이 확정되지 않았으면
  다른 에이전트가 임의로 가정해 구현하지 않는다.
- 완료 처리 시 검증 명령·결과·미검증 환경과 커밋을 기록한다. GUI 구성이나 CI 설정만으로 기능 완료로 표시하지 않는다.
- 기존 `BASE-01`은 Git 운영 이전에 완료한 기반 작업이다. 기준 커밋은 `BASE-02`에서 기록한다.

## 작업 목록

아래 목록의 담당과 브랜치는 착수 시 배정표에 기록한다. 큰 작업은 착수 전에 `DL-01-a`처럼
세분화할 수 있으나, 선행 관계와 수정 범위를 함께 갱신한다.

| ID | 구현·검증할 내용 | 선행 작업 | 상태 |
| --- | --- | --- | --- |
| BASE-01 | 모노레포, 독립 앱, IPC 격리, 검사·빌드·포터블 패키징 기반 | — | 완료 |
| BASE-02 | Git·main·기준 커밋과 네 구현 브랜치·worktree 준비 | BASE-01 | 완료 |
| BASE-03 | Windows 실제 실행·패키징·smoke test 확인 | BASE-02 | 준비 |
| BASE-04 | macOS 실제 실행·패키징·smoke test 확인 | BASE-02 | 준비 |
| FMT-01 | 단일 배포 파일 규격·서버 식별자·공유 계약 확정, 테스트 예제 정의 | BASE-02 | 완료 |
| DL-01 | 일반 HTTPS·Drive 공개 링크 공통 처리, gdown Drive 로직 TypeScript 이식·MIT 고지·원본 커밋, Range·버전 교체 검증 | DL-02 | 완료 |
| DL-02 | 일반 HTTPS Range 전송, 206·범위·길이 검사, 취소·재시도·원격 교체 감지 | BASE-02 | 완료 |
| AUTH-01 | Microsoft 로그인·소유권 확인·갱신·로그아웃 코어와 저장·브라우저 계약, 모의 검증 | BASE-02 | 완료 |
| AUTH-02 | 자체 앱 등록·API 접근 확인, 브라우저・OS 안전 저장 어댑터, 실제 로그인·재시작·갱신·로그아웃 검증 | AUTH-01 | 검토 |
| AUTH-03 | 임시 공개 Java Title ID 인증, 암호화 캐시·취소·재시작·실계정 cycle 검증 | AUTH-01, AUTH-02 구현 | 완료 — Windows cycle 성공 보고, smoke 종료 회귀 수정·검증 |
| AUTH-04 | 최종 자체 앱 ID API 승인·제품 연결·실계정 회귀 검증, 임시 기본 경로 교체 | AUTH-03 | 대기 |
| FMT-02 | 인덱스와 독립 압축 데이터를 포함하는 단일 배포 파일 생성 | FMT-01 | 완료 |
| FMT-03 | 인덱스 읽기·입력 검증·파일별 부분 다운로드·해시 검사 | FMT-01, DL-02 | 완료 |
| SYNC-01 | 로컬 관리 목록, 변경 비교·적용·운영자 파일 삭제·실패 복구 | FMT-02, FMT-03, DL-01 | 진행 |
| GAME-01 | Java·Minecraft·라이브러리·자산 설치와 실행 인자 조립 코어, fixture 검증 | BASE-02 | 완료 |
| GAME-04 | 전체 HTTPS 다운로드 연결·실제 Java/게임 설치 검증, 프로세스·로그·실행 잠금 관리 | GAME-01 | 완료 |
| GAME-05 | 중단된 설치 잠금·저널 검증, 크래시 복구 API와 프로세스 강제 종료 검증 | GAME-01 | 준비 |
| GAME-02 | 1.21.1 NeoForge 설치와 지정 서버 직접 접속 | GAME-01, GAME-04, AUTH-03 | 대기 |
| GAME-03 | 1.21.1 Fabric 설치와 지정 서버 직접 접속 | GAME-01, GAME-04, AUTH-03 | 대기 |
| USER-01 | 런처를 통한 추가 모드 등록·삭제·보존, 미등록 파일과 충돌 처리 | SYNC-01 | 대기 |
| USER-02 | 최초 기본값·필수 설정 구분, 혼합 설정 적용, 리소스팩 활성화·순서 | FMT-01, SYNC-01 | 대기 |
| USER-03 | 서버별 경로·용량 표시와 실행 중 삭제 차단, 서버 데이터 삭제 | SYNC-01 | 대기 |
| MOD-01 | NeoForge 연결 해제 시 종료 보조 모드 — 사용자 결정으로 제외 | — | 취소 |
| MOD-02 | Fabric 연결 해제 시 종료 보조 모드 — 사용자 결정으로 제외 | — | 취소 |
| UI-01 | 서버 온라인·응답 실패·접속 인원·지연시간 조회와 표시 | BASE-02 | 준비 |
| UI-02 | 사용자 런처에 인증·동기화·접속·설정·추가 모드·오류·로그 기능 연결 | AUTH-03, SYNC-01, GAME-02, GAME-03, USER-01, USER-02, USER-03, UI-01 | 대기 |
| STUDIO-01 | 서버 프로젝트 저장, 버전·로더·주소·이미지·기본 설정 구성 | FMT-01 | 준비 |
| STUDIO-02 | 배포 파일 선택·생성, 공개 URL 등록·부분 다운로드 검사, 업데이트 흐름 | STUDIO-01, FMT-02, DL-01, DL-02 | 대기 |
| STUDIO-03 | OS별 공통 코어에 설정·이미지를 묶어 전용 포터블 런처 내보내기 | STUDIO-02, UI-02 | 대기 |
| QA-01 | 운영자 구성 → 업로드 → 내보내기 → 신규 설치 → 접속 → 업데이트 전체 검증 | STUDIO-03, GAME-05 | 대기 |
| RELEASE-01 | 지원 OS·CPU·게임 버전 범위와 서명·배포 정책 확정·검증 | BASE-03, BASE-04, QA-01, AUTH-04 | 대기 |
| RELEASE-02 | 공통 런처 코어 자동 업데이트 설계·구현·호환성 검증 | QA-01 | 대기 |

## 담당 배정과 수정 범위

배정 시 아래 표에 행을 추가한다. 담당 미정인 작업을 진행 상태로 바꾸지 않는다.
브랜치 예시는 `feat/dl-01-drive-resolver`, worktree 예시는 저장소 밖의 `../torchlauncher-dl-01`이다.
worktree 생성 위치는 실행 환경의 쓰기 권한 범위 안에서 선택한다.

| 작업 ID | 담당 에이전트 | 브랜치 | Worktree 경로 | 독점 수정 범위 |
| --- | --- | --- | --- | --- |
| FMT-01 | #1 — `launcher develop #1` | `feat/fmt-01-contracts` | `.agents/worktrees/agent-1` | `docs/deployment-format.md`, `packages/core/src/deployment/contracts/`, 해당 인계 문서 |
| DL-02 | #2 — `launcher develop #2` | `feat/dl-02-http-range` | `.agents/worktrees/agent-2` | `packages/core/src/download/http/`, 해당 인계 문서 |
| GAME-01 | #3 — `launcher develop #3` | `feat/game-01-installer` | `.agents/worktrees/agent-3` | `packages/core/src/minecraft/`, 해당 인계 문서 |
| AUTH-01 | #4 — `launcher develop #4` | `feat/auth-01-microsoft` | `.agents/worktrees/agent-4` | `packages/core/src/auth/`, 해당 인계 문서 |
| FMT-02 | #1 — `launcher develop #1` | `feat/fmt-02-writer` | `.agents/worktrees/agent-1` | `packages/core/src/deployment/writer/`, 해당 인계 문서 |
| DL-01 | #2 — `launcher develop #2` | `feat/dl-01-download-sources` | `.agents/worktrees/agent-2` | `packages/core/src/download/google-drive/`, `packages/core/src/download/source/`, `third-party/gdown/`, 해당 인계 문서 |
| GAME-04 | #3 — `launcher develop #3` | `feat/game-04-runtime` | `.agents/worktrees/agent-3` | `packages/core/src/minecraft/`, `packages/core/src/download/full/`, 해당 인계 문서 |
| AUTH-02 | #4 — `launcher develop #4` | `feat/auth-02-host-adapters` | `.agents/worktrees/agent-4` | `apps/launcher/src/main/auth/`, `scripts/auth-smoke.mjs`, `packages/core/package.json`의 auth export만, 해당 인계 문서 |
| DL-01 live | #2 — `launcher develop #2` | `test/dl-01-live-drive` | `.agents/worktrees/agent-2` | 기존 DL-01 소스·테스트·fixture 범위, `docs/handoffs/DL-01-live.md` |
| AUTH-03 | #4 — `launcher develop #4` | `feat/auth-03-public-java` | `.agents/worktrees/agent-4` | auth host·smoke·런처 manifest·lockfile·필요한 main 빌드 설정·공유 결과 설명/export·인계/라이선스 (상세는 배정 문서) |
| FMT-03 | #2 — `launcher develop #2` | `feat/fmt-03-reader` | `.agents/worktrees/agent-2` | `packages/core/src/deployment/reader/**`, `docs/handoffs/FMT-03.md` |
| SYNC-01 | #2 — `launcher develop #2` | `feat/sync-01-engine` | `.agents/worktrees/agent-2` | `packages/core/src/instance/sync/**`, `docs/handoffs/SYNC-01.md` |

### 실행 세션

총괄 #0 ID: `01a15961-1386-7fd0-bd22-a71aaf70fdd4`.
아래 세션을 재사용해 2차 작업을 실행한다. 사용자 승인으로 모델 지정 메시지를 전송했다.
기존 실행 중 턴의 모델이 즉시 바뀌었다는 뜻은 아니며 후속 실행부터 적용될 수 있다.
목표 effort는 구현 네 세션 medium, 총괄 일상 low이다. 세션 메시지 도구에 effort 필드가
없으므로 effort 변경은 미적용·미확인 상태이며 앱/CLI 세션 설정에서 조정해야 한다.

| 세션 | 작업 | 모델 | 세션 ID |
| --- | --- | --- | --- |
| #1 | FMT-02 | `gpt-6-luna` 지정 | `01a15a0a-76e2-7230-a0b2-a7a07cd83ea1` |
| #2 | DL-01 | `gpt-6-luna` | `01a15a0a-7f50-7ee3-891a-0d01524073bd` |
| #3 | GAME-04 | `gpt-6.1-sol` 지정 | `01a15a0a-9146-7ee0-9d88-1edda8809abc` |
| #4 | AUTH-03 | `gpt-6.1-sol` (프로토콜·수명주기 설계/구현) | `01a15a0a-9a6b-7e33-9c57-2541b698de36` |

작업 경계는 다음처럼 나누는 것을 기본으로 한다. 아직 생성하지 않은 경로는 배정 시 확정한다.

| 작업 영역 | 수정 범위 예시 |
| --- | --- |
| Drive 링크 처리 | `packages/core/src/download/google-drive/` |
| HTTPS Range 전송 | `packages/core/src/download/http/` |
| 배포 계약·생성·읽기 | `packages/core/src/deployment/` 아래 계약·writer·reader를 각각 분리 |
| Microsoft 인증 | `packages/core/src/auth/` |
| 게임·로더 설치 | `packages/core/src/minecraft/`, `packages/core/src/loaders/` 아래 로더별 분리 |
| 사용자 환경 | `packages/core/src/instance/` 아래 파일 소유권·설정·삭제를 구분 |
| 사용자 UI / 관리 UI | `apps/launcher/` / `apps/admin/` |

- 단위 테스트와 fixture는 해당 작업의 수정 범위 안에 둔다.
- 같은 앱의 main·preload·renderer나 같은 코어 파일을 여러 작업이 건드리면, 파일 단위로
  소유권을 다시 나누거나 작업 순서를 직렬화한다. 디렉터리 이름만 다르다고 독립 작업으로 가정하지 않는다.
- 루트 설정, `pnpm-lock.yaml`, 패키지 manifest·공개 export, 공용 IPC 계약, CI,
  `AGENTS.md`, 아키텍처 문서는 통합 담당자가 조정한다. 의존성·계약 변경은 요청으로 전달한다.
- 공유 파일의 제품 코드 수정은 #0이 구현 세션 하나에 배정한다. #0이 대신 구현하지 않는다.
- 작업 도중 범위를 넓혀야 하면 먼저 배정표를 갱신하고 다른 작업과의 충돌을 확인한다.

## 인계와 머지 절차

1. 에이전트는 작업 브랜치에 변경을 커밋하고, 선행 작업이 포함된 통합 기준에서 검증한다.
2. PR 본문 또는 작업별 `docs/handoffs/<작업-ID>.md`에 아래 인계 내용을 전달한다.
   에이전트별로 다른 파일을 사용하고 이 진행 문서를 직접 수정하지 않는다.
3. `#0` 총괄은 범위·계약·검증 결과를 확인하고 의존 순서대로 머지하며 통합 충돌을 해결한다.
4. 최신 통합 상태에서 관련 테스트를 다시 실행한다. 공유 코어·의존성·IPC 변경 시
   `pnpm check`와 영향받는 앱의 실행 검증을 포함한다.
5. 통합 검증이 끝난 뒤에만 완료로 바꾸고 머지 커밋과 검증 기록을 남긴다.

인계 양식:

```text
작업 ID / 담당 세션 이름 / 브랜치 / 최종 커밋:
사용한 기준 커밋:
변경 내용과 파일 범위:
공유 계약·의존성 변경 요청:
검증 명령 / 결과 / OS:
미검증 항목·제약·차단 요인:
후속 작업:
```

로컬 테스트 성공만으로 머지 완료로 표시하지 않는다. 미커밋 변경을 복사하거나 다른 에이전트의
worktree를 직접 수정하는 방식으로 통합하지 않는다.

## 검증·통합 기록

| 날짜 | 작업 | 반영 커밋 | 검증 결과·남은 확인 |
| --- | --- | --- | --- |
| 2026-10-21 | BASE-01 | Git 초기화 전 | Linux x64 / WSL2, Node.js 24. frozen-lockfile 설치, `pnpm check`와 단위 테스트 12개 통과. 실제 두 앱의 화면·IPC·Node.js 비노출·격리·샌드박스 확인. 두 Linux 포터블 생성·내용 검사·패키징된 실행 파일 검증 완료. Windows·macOS 미검증. |
| 2026-10-21 | BASE-02 일부 | 아직 없음 | `git init -b main` 완료. `git status --short --branch`로 main과 커밋 없음 상태 확인. 기준 커밋·작업별 worktree는 아직 생성하지 않음. |
| 2026-10-21 | BASE-02 완료 | `4d5b4ab` 기반 | 기반 코드 커밋과 네 독립 구현 브랜치·worktree 생성. 배정 문서를 반영한 최신 main으로 착수 기준을 맞춘다. 세션 실행·구현은 미착수. |
| 2026-10-21 | FMT-01 | `5249b3e` (최종 `a84f3b6`) | v1 규격·검증 계약·NFC Unicode 경로 검토 후 통합. writer·reader와 실제 파일 적용은 후속 범위. |
| 2026-10-21 | AUTH-01 | `218dc1b` (최종 `fe0db5c`) | 인증 계약을 GAME-01과 맞춰 통합. 모의 응답 검증이며 실제 계정·앱 등록·안전 저장·시스템 브라우저는 AUTH-02. |
| 2026-10-21 | DL-02 | `f2cdeeb` (최종 `f8a8090`) | 길이 상한·identity 인코딩·수동 HTTPS 리다이렉트·동시 버전 검사 수정 후 통합. Drive 흐름은 미검증. |
| 2026-10-21 | GAME-01 | `4e468ff` (최종 `51ab101`) | OS별 메타데이터 선택·안전한 설치·실행 인자와 호스트별 테스트 수정 통합. 실제 설치·프로세스·로그는 GAME-04, 크래시 복구는 GAME-05. |
| 2026-10-21 | 1차 통합 검증 | `4e468ff` | Linux x64/WSL, Node 24·pnpm 10.34.7. `pnpm check` 성공: Biome·전체 TypeScript·285개 테스트·두 앱 빌드. `node scripts/smoke.mjs`로 두 앱의 실제 화면·IPC·Node 비노출·격리·샌드박스 확인. 새 코어는 앱 미연결 상태이므로 이 smoke는 실제 로그인·게임 실행 증거가 아니다. Windows/macOS 네이티브 검증은 남아 있다. |
| 2026-10-21 | DL-01 코어 | `f7da09b` (최종 `4551783`) | 일반 HTTPS·공개 Drive 공통 소스, generation reset·인덱스 재조회 계약, gdown MIT·원본 커밋 확인 후 통합. 실제 Drive 파일·버전 교체는 사용자 테스트 파일 준비 후 검증하므로 전체 작업은 검토 상태다. |
| 2026-10-21 | GAME-04 | `eb57f9c` (최종 `cce120c`) | 전체 HTTPS 어댑터·공유 서버 lease·프로세스·제한된 마스킹 로그 통합. worker의 실제 Linux x64 1.21.1 설치: payload 1,024,456,840 bytes/4,087 resources, Java 21.0.7 exit 0. 캐시 재설치: 862,331 bytes/5 resources. 영수증은 fixture로 추적하며 실제 게임 접속·타 OS 실행 증거는 아니다. |
| 2026-10-21 | FMT-02 | `ad4d574` (최종 `003d214`) | 기존 v1 계약을 재사용하는 스트리밍 writer, 임시 파일·최종 rename, 입력 변경·취소 검사 통합. Windows symlink 권한별 테스트 분리 수정 포함. Linux focused 46개 성공, Win/mac 실제 생성은 미검증. |
| 2026-10-21 | AUTH-02 구현 | `d84e35b` (최종 `5729b0e`) | loopback 브라우저·Electron 안전 저장·독립 auth smoke 도구, auth export 통합. Windows 테스트 호환성 수정 포함. Linux 실제 basic backend 거부 확인; Windows 저장과 자체 앱 실계정 cycle은 미검증이므로 전체 작업은 검토 상태다. |
| 2026-10-21 | 2차 통합 검사 | `d84e35b` | Linux x64/WSL의 `pnpm check` 성공: Biome·전체 TypeScript·447개 테스트·두 앱 빌드. `node scripts/smoke.mjs`로 두 앱의 화면·IPC·Node 비노출·격리·샌드박스 확인. opt-in 실설치 테스트 1개는 기본 skip이며 worker의 실제 설치·Java 실행 증거는 GAME-04 영수증으로 별도 보존했다. 이 smoke는 실제 인증·게임 접속 증거가 아니다. |
| 2026-10-21 | DL-01 실환경 완료 | `26ac54c` (최종 `c763a63`) | 실제 공개 Drive 파일의 206·처음/중간/끝·반복 구간 검증. 유지한 v1 소스가 새 버전을 감지했고 reset 후 같은 공유 링크에서 v2 수신 확인. 크기는 78,641,842 → 78,641,731 bytes. 안전한 v1/v2 영수증과 opt-in harness 통합. 통합 후 다운로드 29개 테스트 성공·live 2개 기본 skip, core TypeScript·scoped Biome 성공. 전체 파일 비교와 배포 reader/SYNC 흐름의 검증은 아니다. |
| 2026-10-21 | AUTH-02 진단 보완 | `e2ccc79` (최종 `8020eaf`) | Minecraft 단계 403의 정확한 알려진 앱 등록 거부 메시지만 기존 error code로 구분. 다른 403·유사 문구·다른 단계·HTML·크기 초과 응답은 일반 오류 유지, 본문 미노출. `pnpm check` 성공: 457개 테스트·live 3개 기본 skip·전체 TypeScript·Biome·두 앱 빌드. 실계정 재시도 결과는 아직 대기다. |

사용자의 Drive `usercontent` Range 요청 성공은 사전 수동 확인으로만 기록한다.
저장소에서 구현한 다운로드 기능이나 전체 Drive 업데이트 흐름의 검증 완료로 계산하지 않는다.

## 차단·미결정 사항

- AUTH-03 Windows 사용자 실검증: 첫 대화형 로그인은 웹에서 성공했으나 harness 결과 없이
  Electron이 종료됐다. 재실행은 추가 로그인 없이 `login`·`refresh`의 소유권/프로필 검증,
  `logout`·`assert-empty` 모두 성공하고 최종 `liveAuthentication: verified`를 반환했다.
  #4가 실제 Electron/WSLg에서 마지막 창 종료 후 비동기 작업을 수행하는 비인증 검사로
  동일 오류를 재현했다. smoke 앱의 기본 `window-all-closed` 종료가 결과 출력보다 앞섰다.
  smoke 전용 종료 제어 수정 `852b73c`를 `758909b`로 통합했다. 메인에서도 비인증
  `window-cycle`이 Linux/WSLg에서 `soleWindowClosed: true` 결과 출력·정상 종료까지 성공했다.
  worker의 인증 테스트 165개·launcher TypeScript·Biome도 성공했다. 수정 후 Windows 대화형 재실행은 미실시다.
  자체 앱 ID 403의 원인이나 실제 게임 접속까지 검증한 결과는 아니다.
- FMT-02 인계와 검토 수정 `003d214`를 통합했다. v1 계약·스트리밍·게시 전 실패 보존을 확인했다.
  Windows symlink 권한이 없으면 해당 테스트만 명시적으로 건너뛰며 다른 파일 보호 검증은 유지한다.
  작업 브랜치의 검사 성공은 Windows 실제 검증을 뜻하지 않는다.
- AUTH-02는 WSL의 `basic_text` backend를 안전하게 거부했다. 이후 #4 세션에서 사용자가
  앱 등록과 개인 계정 지원 설정(`api.requestedAccessTokenVersion: 2` 포함)을 진행했다.
  실제 인증은 Microsoft/Xbox 단계를 지나 `stage: minecraft`, HTTP 403으로 중단됐다.
  현재 요청은 `POST https://api.minecraftservices.com/launcher/login`이며 소유권·프로필 검사 전이다.
  앱 API 접근 허용 문제인지 요청 방식 문제인지는 아직 확정하지 않는다. Windows 저장 cycle의
  개별 결과와 재시작 후 갱신·로그아웃 증거는 #4 인계에 보완하며 AUTH-02 전체 완료로 처리하지 않는다.
  검토 수정 `5729b0e`로 기본 테스트의 host platform·Unix 권한 검사·symlink capability를 분리했다.
- AUTH-02 403 원인 조사를 시작했다. 현재 Prism의 Minecraft endpoint/body와 일치함을 확인했다.
  #4에 `fix/auth-02-minecraft-rejection`의 좁은 서버 오류 분류·테스트를 배정했다.
  explicit invalid-app-registration만 기존 code로 구분하고 일반 403을 같은 원인으로 단정하지 않는다.
- 진단 보완 `8020eaf`를 `e2ccc79`로 통합했다. 인증 테스트 148개·core TypeScript·scoped Biome 성공.
  사용자는 테스트 계정의 Minecraft 소유권을 확인했다. 이는 사용자 보고이며 실제 entitlement 조회는 아직 도달하지 못했다.
  기존 실패 응답 원문은 보존하지 않았으므로 이전 403의 세부 원인을 소급 확정하지 않는다.
  다음 증거는 같은 자체 앱·계정으로 기존 Windows smoke를 재실행한 정제된 error code다.
  통합 후 두 Electron 앱의 화면·IPC·격리·샌드박스 smoke도 통과했다. 실제 로그인 재실행을 대신하는 검사는 아니다.
- 사용자가 재시도했으나 `http_failed / minecraft / 403`을 다시 보고했다. 좁은 분류가
  인식하는 명시 응답은 아직 확인되지 않았으며 정확한 원인은 미확정이다.
- 사용자 제공 [Microsoft authentication 문서](https://minecraft.wiki/w/Microsoft_authentication)의
  OAuth 절을 직접 읽었다. 문서는 새 Azure 앱의 별도 Minecraft API 사용 승인과 미승인 시 403을 명시하며,
  [신청 링크](https://aka.ms/mce-reviewappid)를 제공한다. 실제 링크가 Microsoft Forms로 연결됨을 확인했다.
  현재 접수 가능 여부·필수 입력·승인 소요 시간은 확인하지 못했다. 앱 등록과 API 접근 승인을 구분하고,
  승인 여부 확인을 다음 단계로 우선한다. 추가 진단 harness는 제안만 받았으며 구현하지 않았다.

2026-10-21 범위 변경: 연결 해제 시 게임 자동 종료와 보조 모드는 제외했다.
연결 해제 후 게임 기본 화면·종료 동작을 유지하며 MOD-01·MOD-02 완료를 릴리스 조건으로 요구하지 않는다.

현재 등록된 실행 중 차단 작업은 없다. 다음 사항은 해당 작업 착수 시 결정·검증한다.

- FMT-01의 v1 표현·크기·서버 식별 계약은 확정했다. 해시는 손상 검사이며 서명·발행자 신뢰·되돌리기 방지 정책은 RELEASE-01에서 결정한다.
- AUTH-02: 자체 앱을 사용한 Minecraft 단계 HTTP 403 원인 확인과 실계정 cycle 완료가 필요하다. #4는 사용자 테스트 결과·오류 단계가 바뀔 때 #0에도 알린다. 비밀번호·인증 코드·토큰을 대화로 요청하지 않는다.
- FMT-03: 검증된 일반 HTTPS·Drive 소스에 배포 인덱스·파일별 해시 검증을 연결한다. 이번 실제 Drive 파일과 크기가 달라진 새 버전 검증을 모든 확인 페이지·다운로드 제한·만료 조건의 실검증으로 확대하지 않는다. 검증자 없는 동일 길이 교체는 HTTP만으로 감지할 수 없어 파일별 해시 검증이 필요하다.
- GAME-04 / GAME-05: 실제 Java·게임 실행과 로그 관리, 설치 크래시 복구가 남아 있다. 현재 stale lock은 수동 복구만 가능하다. Linux ARM64용 Mojang Java 카탈로그는 지원하지 않아 별도 런타임 정책이 필요하다.
- USER-01 / USER-02: 모드 ID·파일 경로 충돌과 개인·필수 설정이 섞인 파일의 처리.
- RELEASE-01 / RELEASE-02: OS·CPU 지원 범위, 서명, 코어 업데이트와 서버 설정 보존.
