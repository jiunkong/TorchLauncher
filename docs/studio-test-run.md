# Studio 테스트 실행: 모드 호환성 확인과 설정 추출

2026-10-23 사용자 계획. 지금은 운영자가 Studio 밖에서 게임을 실행해 `options.txt`를 만들고 외부 폴더에서 불러온다. 이를 **Studio 안에서 게임을 실행**하도록 바꾼다. 운영자는 같은 실행에서 (1) 모드 호환성을 확인하고 (2) 게임이 쓴 `options.txt`와 모드/셰이더 설정을 곧바로 가져온다. 개발 중이므로 하위 호환은 고려하지 않는다([AGENTS.md](../AGENTS.md)).

구현 작업서(GPT/Codex 작업자용): [studio-test-run-task.md](studio-test-run-task.md).

## 사용자 결정 (2026-10-23)

1. **계정**: Studio에 Microsoft 로그인을 추가한다. 런처와 세션/토큰 저장소는 **공유하지 않는다**(앱 경계 유지, 각 앱의 userData). 오프라인 임시 계정은 만들지 않는다.
2. **호환성 판정**: 로그 분석 + 운영자가 직접 플레이. 자동 "메인 메뉴 도달" 판정과 자동 종료는 이번 범위가 아니다.
3. **기존 외부 불러오기**: 테스트 실행 결과가 기본 경로이고, 폴더/`options.txt` 직접 불러오기는 보조(고급)로 유지한다.

## 흐름

1. 프로젝트의 소스 폴더(배포할 파일 묶음)와 서버 정보(게임 버전, 로더 종류·버전)가 설정되어 있다.
2. 게임 설정 또는 파일 섹션의 **테스트 실행**: Microsoft 로그인(처음 한 번) → 테스트 인스턴스 준비 → 게임 실행.
3. 테스트 인스턴스는 프로젝트 전용 앱 데이터 폴더(`userData/test-instances/<serverId>/`)에 만든다. 운영자의 `.minecraft`와 소스 폴더를 건드리지 않는다. 배포 정책(항상/최초/제외)을 적용한 **현재 배포 후보 파일**을 인스턴스에 복사한다(설정 정책이 관리하는 `options.txt`·팩 제외 규칙 포함, 소스 폴더 파일은 읽기만).
4. 게임 설치(Java, 기본 게임, 로더)는 코어의 기존 설치 코드를 쓴다(`packages/core/src/minecraft`, `loaders`).
5. 실행 중 Studio는 로그를 실시간으로 보여 주고 분석한다. 운영자가 게임을 종료하면 **호환성 결과**를 낸다.
6. 종료 후 인스턴스의 `options.txt`, `config/**`, `shaderpacks/*.txt`, `config/iris.properties` 등을 기존 `settingsImport`와 같은 경로로 읽어 게임 설정 섹션에 채운다(기존 선택한 정책은 유지, 키 목록 갱신).
7. 같은 인스턴스를 재사용해 다시 실행할 수 있다. 인스턴스 초기화(삭제)는 앱 안 확인 모달 후에만, 해당 폴더 범위에서만 한다. 네이티브 확인창 금지.

## 호환성 결과 (로그 분석)

로더별로 알려진 실패 패턴을 분류해 구조화된 결과를 만든다(원문 로그는 줄 수·크기 제한을 둔 채 보관/표시).

- 종료 코드와 비정상 종료(크래시 리포트 `crash-reports/` 경로 포함, 읽기 크기 제한).
- 로더 해석 실패: 누락 의존성, 버전 불일치, 중복 모드, 환경 불일치(클라이언트 전용/서버 전용), 로더/게임 버전 불일치. Fabric(`Mod resolution failed`, `Incompatible mod set`)과 NeoForge(`Missing or unsupported mandatory dependencies`, `Failed to load mods`)를 각각 다룬다.
- Mixin 적용 실패, 클래스 로딩 오류, OutOfMemory, Java 버전 오류.
- 결과 항목: 심각도(오류/경고/정보), 분류, 관련 모드 ID/파일, 요약 문장, 근거 로그 줄 번호. 알 수 없는 오류는 "분류되지 않음"으로 원문 일부와 함께 표시한다. 정상 종료 + 오류 없음은 "문제를 찾지 못했습니다"로만 표현하고 호환을 보증하지 않는다.
- 모드 목록(파일명, 모드 ID, 버전, 로더)은 jar의 메타데이터(`fabric.mod.json`, `META-INF/neoforge.mods.toml`)에서 읽을 수 있으면 보여 준다(크기 제한·ZIP 항목 이름 검증).

## 작업 분해

| ID | 내용 | 독점 범위 | 의존 |
| --- | --- | --- | --- |
| AUTH-SHARE-01 | 런처 앱에만 있는 Microsoft 인증(`apps/launcher/src/main/auth/**`, prismarine-auth worker, 암호화 저장소 포함)을 앱이 공유하는 워크스페이스 패키지로 추출한다. 런처는 동작 변경 없이 새 패키지를 쓴다. 앱끼리 import 금지 유지, 저장소 위치는 앱별 주입. 새 패키지/의존성/lockfile 변경은 먼저 #0과 조정한다. | `apps/launcher/src/main/auth/**`(이동), 새 `packages/*`, 두 앱의 빌드 설정에서 worker 번들 부분, `docs/handoffs/AUTH-SHARE-01.md` | 없음 |
| TESTRUN-CORE-01 | 코어: 로그 분석기(`packages/core/src/diagnostics/`: Fabric/NeoForge/크래시/mixin/OOM/Java 패턴, 입력 크기 제한, 구조화 결과), jar 모드 메타데이터 읽기, 테스트 인스턴스 준비 계획(배포 후보 파일 목록 -> 인스턴스 복사 목록, 경로 검증). 실제 로그 샘플 fixture와 테스트. | `packages/core/src/diagnostics/**`(신규), 필요한 `packages/core/src/instance/**` 신규 파일, 관련 문서 `docs/studio-test-run.md` 갱신, `docs/handoffs/TESTRUN-CORE-01.md` | 없음 |
| TESTRUN-MAIN-01 | Studio 메인: 로그인 상태/로그인·로그아웃 IPC, 테스트 인스턴스 준비(코어 설치 코드 사용, 진행률·취소), 게임 실행/중지, 로그 스트리밍과 분석 결과 상태, 종료 후 설정 추출을 `settingsImport` 경로에 연결, 인스턴스 초기화. 좁고 검증된 IPC, 소스 폴더 읽기 전용. | `apps/admin/src/main/**`, `apps/admin/src/shared/**`, `apps/admin/src/preload/**`, 루트 `scripts/smoke.mjs`의 Studio 브리지 목록 한 줄, `docs/handoffs/TESTRUN-MAIN-01.md` | AUTH-SHARE-01, TESTRUN-CORE-01 |
| TESTRUN-UI-01 | Studio 화면: 테스트 실행 진입점과 로그인 상태, 준비·실행 진행 패널, 실시간 로그, 호환성 결과 목록(심각도/모드/근거 줄), 게임 설정의 빈 상태를 "테스트 실행" 중심으로 개편(외부 불러오기는 보조 링크), 인스턴스 초기화 확인 모달. 시안 필요(아래). | `apps/admin/src/renderer/**`, `apps/admin/scripts/*smoke*`, `docs/handoffs/TESTRUN-UI-01.md` | TESTRUN-MAIN-01 API 확정 |

병렬: AUTH-SHARE-01과 TESTRUN-CORE-01은 범위가 겹치지 않아 동시에 진행한다. TESTRUN-MAIN-01은 둘의 통합 후, TESTRUN-UI-01은 MAIN API가 정해진 뒤 시작한다(필요하면 API 계약만 먼저 확정해 화면 작업을 앞당긴다).

## 시안

기존 Studio 시안(`docs/design/studio/`)에는 테스트 실행 화면이 없다. 새 시안(테스트 실행 패널, 호환성 결과, 로그인 상태, 게임 설정 빈 상태 변경)이 필요하다. 시안 도구에서 같은 토큰(`studio.css`)으로 추가한 뒤 `docs/design/studio/`에 복사하고, TESTRUN-UI-01 시작 전에 README 표를 갱신한다. 시안 전에는 UI 작업을 시작하지 않는다.

## 보안·안전 제약

- 로그와 크래시 리포트는 신뢰할 수 없는 입력이다. 분석기는 크기·줄 수 제한, 정규식 폭주 방지, 표시 전 제어 문자 제거를 한다. 로그에서 계정 토큰/사용자 이름이 보이지 않도록 기존 로그 정화 규칙(`minecraft/logs`)을 재사용한다.
- 인스턴스 복사/삭제는 해당 인스턴스 루트 안으로 경로를 검증하고 링크를 따라가지 않는다.
- Studio의 로그인 토큰은 OS 암호화 저장소에만 저장한다. 없는 환경(키링 없음)에서는 로그인 저장 없이 세션만 쓰거나 로그인 불가 안내를 한다(결정은 AUTH-SHARE-01 인계에 기록).
- 게임 프로세스는 코어의 기존 관리 프로세스(수명, 종료, 정리)를 사용한다. Studio 종료 시 자식 정리.
- 테스트 실행은 서명·배포 파일을 만들지 않는다. 실서버 접속은 이번 범위가 아니다(자동 접속 인자 없음).

## 미결정 / 후속

- 테스트 인스턴스 위치 외에 Java 런타임·기본 게임 파일 캐시를 런처와 공유하지 않는다(각 앱 userData). 용량이 문제가 되면 후속에서 공유 캐시를 검토한다.
- 서버 접속 테스트(자동 접속), 메인 메뉴 자동 판정은 후속.
- Windows/Linux 실제 모드 팩으로 분석 패턴을 검증해야 한다. 초기 패턴은 문서·샘플 로그 기반이다.
