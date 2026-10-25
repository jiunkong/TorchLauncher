# TorchLauncher

**TorchLauncher**는 멀티플레이 서버 운영자가 플레이어에게 **설치·모드 동기화·서버 접속이 한 번에 이루어지는 서버 전용 Minecraft 런처**를 만들어 배포할 수 있게 해주는 오픈소스 도구입니다.

복잡한 모드팩 설치 안내나 수동 파일 배포 없이, 운영자는 **TorchLauncher Studio**에서 서버 환경을 구성해 배포하고 플레이어는 전달받은 **TorchLauncher**에서 로그인 후 접속 버튼만 누르면 됩니다.

---

## 구성 앱

| 앱 | 대상 | 설명 |
| --- | --- | --- |
| **TorchLauncher** | 플레이어 | Microsoft 정품 계정 로그인, Java·Minecraft·모드 로더 자동 설치, 서버 배포 파일 동기화, 개인 추가 모드·리소스팩 관리, 원클릭 서버 접속을 제공하는 전용 런처 |
| **TorchLauncher Studio** | 서버 운영자 | 서버 접속 정보·브랜딩 이미지·모드·리소스팩·셰이더·게임 설정 및 동기화 정책을 구성하고, 서명된 단일 배포 파일(`torchpack`)과 플레이어용 포터블 런처 ZIP을 내보내는 관리 도구 |

---

## 주요 특징

- **원클릭 설치 및 접속**: 플레이어가 서버 주소나 모드 설치 방법을 몰라도 호환 Java, Minecraft, 모드 로더(Fabric / NeoForge) 설치부터 서버 접속까지 자동으로 처리합니다.
- **부분 다운로드 기반 빠른 동기화 (`torchpack`)**: 단일 배포 파일의 앞부분 인덱스를 먼저 읽어 로컬 파일 해시와 비교하고, 변경되거나 추가된 구간만 HTTP Range 요청으로 내려받습니다.
- **Ed25519 서명 및 롤백 방지**: 운영자의 키로 서명된 배포물만 신뢰하며, 배포 시퀀스 검증을 통해 구버전 파일로 되돌리는 롤백 공격이나 변조를 차단합니다.
- **세밀한 설정·파일 정책과 개인 모드 보존**:
  - **항상 동기화 (`always`)**: 필수 모드나 서버 강제 설정을 운영자 배포본과 항상 일치시킵니다.
  - **최초 1회 적용 (`initial-only`)**: 단축키, 음량, 그래픽 옵션, 선택형 리소스팩·셰이더 등 초기 기본값만 제공하고 이후 플레이어의 변경 사항을 보존합니다.
  - **개인 추가 모드 분리 관리**: 플레이어가 런처에서 직접 추가한 클라이언트 모드는 운영자 배포 목록과 분리되어 서버 업데이트 후에도 유지됩니다.
- **독립된 서버별 데이터 격리**: 기존 `.minecraft` 폴더를 건드리지 않고 OS 사용자 데이터 경로 아래에 서버별 독립 환경을 구성합니다.
- **별도 빌드 서버가 필요 없는 포터블 배포**: 운영자가 개발 도구를 설치하거나 소스를 직접 빌드할 필요 없이, Studio에서 서버 설정과 브랜딩(배경·로고)이 묶인 OS별 포터블 런처 패키지를 바로 내보낼 수 있습니다.

---

## 작동 흐름

1. **프로젝트 구성 (Studio)**: 운영자가 Minecraft 버전, 로더(Fabric / NeoForge), 모드, 리소스팩, 셰이더, 기본 게임 설정과 서버 브랜딩을 구성합니다.
2. **배포 파일 생성 및 업로드**: Studio에서 서명된 단일 배포 파일(`.torchpack`)을 생성해 직접 관리하는 웹 호스팅이나 공유 스토리지(Google Drive 공개 링크 등)에 업로드합니다.
3. **전용 런처 내보내기**: 업로드한 배포 URL을 등록·검증한 뒤 플레이어에게 전달할 OS별 런처 ZIP을 내보냅니다.
4. **플레이어 접속 (Launcher)**: 플레이어는 압축을 풀고 런처를 실행해 Microsoft 로그인 후 **플레이** 버튼을 누릅니다. 이후 서버 환경이 업데이트되면 같은 원격 배포 파일만 교체하면 됩니다.

---

## 지원 환경

| 구분 | 지원 범위 |
| --- | --- |
| **운영체제** | Windows x64 (Portable `.exe`), Linux x64 (`.AppImage` / `.tar.gz`)<br>*(macOS 지원은 현재 보류 중이며, Linux ARM64는 지원하지 않습니다)* |
| **모드 로더** | Fabric, NeoForge (주요 검증 기준: Minecraft 1.21.1) |
| **계정 인증** | Microsoft 정품 Minecraft 계정 |
| **인터페이스 언어** | 한국어, 영어 (자동 감지 및 수동 전환 지원) |

---

## 다운로드 및 빌드

- **실행 파일 다운로드**: 공식 배포판은 저장소의 [GitHub Releases](https://github.com/jiunkong/TorchLauncher/releases)에서 Windows x64 포터블 실행 파일과 Linux x64 AppImage로 제공될 예정입니다(첫 릴리스 게시 전).
- **소스 코드에서 실행**:

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile

# 플레이어용 런처 개발 실행
pnpm dev:launcher

# 운영자용 Studio 개발 실행
pnpm dev:studio
```

전체 스크립트(`pnpm check`, `pnpm smoke`, `pnpm package:*`), 디렉터리 구조, 테스트 및 기여 규칙은 [AGENTS.md](AGENTS.md)에 정리되어 있습니다.

---

## 문서

- [아키텍처 및 제품 설계](docs/architecture.md)
- [배포 파일 규격 (`torchpack`)](docs/deployment-format.md) 및 [배포 서명](docs/deployment-signing.md)
- [설정 동기화 정책](docs/settings-policy.md) 및 [파일 동기화](docs/synchronization.md)
- [Studio 프로젝트 형식](docs/studio-project-format.md) 및 [현재 지원 형식 기준](docs/current-formats.md)
- [GitHub 자동 릴리스](docs/github-releases.md)
- [개발 진행 현황](docs/progress.md) 및 [개발·기여 가이드](AGENTS.md)

---

## 라이선스 및 고지

- 이 저장소의 소스 코드는 [GNU General Public License v3.0 only](LICENSE) (`GPL-3.0-only`)로 배포됩니다. 수정본이나 파생물을 배포하려면 동일한 라이선스로 소스를 공개해야 합니다.
- 서버 운영자가 수정하지 않은 런처에 자신의 서버 설정과 브랜딩 이미지를 넣어 플레이어에게 전달하는 것은 이 조건에 영향을 주지 않습니다.
- "TorchLauncher"와 "TorchLauncher Studio"라는 이름, 로고 및 아이콘은 코드 라이선스에 포함되지 않습니다.
- Minecraft는 Mojang Studios의 상표이며, 이 프로젝트는 Mojang Studios 또는 Microsoft와 관련이 없습니다.
- 포함된 서드파티 코드와 글꼴의 라이선스 고지는 [`third-party/`](third-party/) 디렉터리에서 확인할 수 있습니다 (`gdown` MIT, `prismarine-auth` MIT, `Pretendard` OFL-1.1, `Pixelify Sans` OFL-1.1).
