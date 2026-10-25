# 현재 형식과 개발 중 호환 정책

2026-10-24 사용자 지시: 과거 개발 형식 호환 경로를 제거한다. 첫 공개 릴리스 전에는 현재 형식만
생성·판독하며, 구형 reader·자동 마이그레이션·버전 협상·무서명 다운그레이드를 두지 않는다.
버전 숫자 `1` 자체가 구형을 뜻하지 않는다. 아래 각 형식의 현재 버전과 필드를 기준으로 판단한다.

| 대상 | 현재 계약 | 구형 입력 처리 |
| --- | --- | --- |
| `.torchpack` | 1.2, 64B 헤더 + 64B Ed25519 서명 + 인덱스 + 페이로드. sequence/branding 필수 | 1.0/1.1 및 다른 버전은 헤더 검사에서 거부. 무서명 생성 없음 |
| `torchlauncher-server.json` | `version:1`, `signing:{algorithm:'ed25519',publicKey}` 필수 | signing 없는 구성 거부 |
| `.torchproj` (프로젝트 폴더) | 프로젝트 폴더(`<dir>/project.torchproj` + `<dir>/files/` + 선택 `<dir>/branding/`), 바이너리 컨테이너 schema1 | 단일 파일 직접 열기 및 예전 JSON 프로젝트·다른 schema 거부, 변환 reader 없음 |
| 프로젝트 파일 항목 | `files[]`는 `{path, targetPath, policy}`(`policy`는 `always`/`initial-only`), `lastBuild.files[]`는 `{sourcePath, path, sha256, length, policy}`. 관리 경로는 원본·대상 모두 금지 | `targetPath` 없음·`excluded` 정책·`sourcePath` 없는 lastBuild는 `INVALID`로 거부, 변환 reader 없음 |
| `.torchkey` | 현재 암호화 백업 version1, scrypt + AES-256-GCM | 옛 확장자 필터/마이그레이션 없음. 내용은 현재 단일 schema로 검사 |
| settings-policy | 현재 version1의 선택 `configFiles`와 혼합 정책 | 이전 version2·옛 상태 구조는 거부 |
| 잠금 `owner.json` | version2, owner·process identity·host·child 포함 | version1은 구조 해석하지 않음. invalid/불확실 잠금으로 보호하며 자동 삭제·자동 회수하지 않음 |
| 그 밖의 원장·캐시·설정 | 각 parser가 정의한 현재 단일 구조 | 다른 버전/구조를 변환하지 않음 |

## 서명과 소비자

- writer에는 `sequence`와 `sign`이 필수다. 이미지가 없어도 1.2이며 `branding:{}`를 기록한다.
- 런처는 구성의 공개키로 검증된 배포만 동기화·브랜딩 확인에 사용한다. 롤백 차단 상태는 성공한 동기화 뒤에만 갱신한다.
- Studio도 항상 키 저장소를 사용해 서명한다. 안전한 키 저장소를 사용할 수 없으면 명시 오류이며 무서명 fallback은 없다.
- 코어 reader의 키 없는 `unverified` 모드는 현재 1.2의 구조 검사 도구용이다. 런처에서 사용을 허가하는 호환 모드가 아니다.
- `scripts/game-smoke.mjs launch`는 `--signing-public-key`가 필수다. 현재 Studio가 내보낸 구성의 공개키와 일치해야 한다. install 전용 모드는 배포 키가 필요하지 않다.
- 선택적 이미지 역할, 아직 빌드하지 않은 새 프로젝트의 sequence 부재, 메모리 값 미지정,
  프로파일의 게임 표시 hint 생략은 현재 계약의 기능이다. 과거 호환으로 오인해 제거하지 않는다.
- Minecraft options.txt 버전 프로파일, 모드 metadata, 64×32 스킨 등 외부 데이터 지원은
  TorchLauncher의 과거 프로젝트·배포 형식 호환과 별개다.

## 개발 데이터와 문서

구형 배포·서버 구성은 현재 Studio로 다시 생성·내보낸다. 에이전트가 사용자 데이터·개인 키·잠금 파일을
일괄 삭제하거나 기존 ignored 실서버 파일을 자동 수정하지 않는다. 구형/손상 잠금은 안전한 불확실 상태로 취급한다.

현행 기준은 이 문서와 [배포 규격](deployment-format.md), [서명](deployment-signing.md),
[프로젝트 형식](studio-project-format.md), [설정 정책](settings-policy.md)이다.
`docs/handoffs/`와 진행 문서의 날짜별 기록은 당시 구현/검증 이력이다. 거기에 남은 구형 지원 설명은
현재 지원 계약이 아니며 현재 규격을 우선한다. 이미 수행한 검증의 역사적 기록은 새 결과로 덮어쓰지 않는다.
