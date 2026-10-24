# TorchLauncher

서버 전용 Minecraft 런처와 운영자용 **TorchLauncher Studio**를 만드는 프로젝트입니다.
Windows x64·Linux x64, Minecraft 1.21.1의 Fabric·NeoForge가 현재 검증 대상입니다.
macOS는 보류했고 Linux ARM64는 지원하지 않습니다.

두 Electron 앱의 UI, Microsoft 인증, 게임·로더 설치와 실행, 모드 동기화,
Studio 프로젝트·게임 설정·브랜딩·서명된 배포 생성·런처 ZIP 내보내기가 구현되어 있습니다.
Windows 실제 게임 접속과 Linux 자동/GUI 검증 기록이 있으며, 최신 기능 전체의 배포 종단 QA는 남아 있습니다.
정확한 완료·미검증 범위는 [진행표](docs/progress.md)를 따릅니다.

개발 중 이전 프로젝트·배포·설정 형식의 하위 호환은 유지하지 않습니다.
배포는 서명된 torchpack1.2만 사용하고, 서버 구성에 `signing` 공개키가 필수입니다.
옛 개발 배포물은 현재 Studio에서 다시 생성·내보내세요. 형식별 기준은 [현재 형식](docs/current-formats.md)을 참고하세요.

## 개발 환경

- Node.js 24
- pnpm 10.34.7 (`package.json`에 고정)
- 데스크톱 실행이 가능한 환경. Linux에는 Electron 실행에 필요한 시스템 라이브러리가 필요합니다.

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
pnpm dev:launcher
```

Studio는 다른 터미널에서 실행합니다. 두 앱의 개발 서버 포트는 각각 5173, 5174입니다(`TORCH_LAUNCHER_DEV_PORT`, `TORCH_STUDIO_DEV_PORT` 환경 변수로 바꿀 수 있습니다. 예: PowerShell `$env:TORCH_STUDIO_DEV_PORT=6100; pnpm dev:studio`, `$env:TORCH_LAUNCHER_DEV_PORT=6101; pnpm dev:launcher`).

Windows 문제 해결: `listen EACCES 127.0.0.1:5173/5174`는 보통 해당 포트가 Windows 제외 포트 범위에 들어 있기 때문입니다(`netsh interface ipv4 show excludedportrange protocol=tcp`). 나열된 범위 밖이면서 Chromium이 막는 포트가 아닌 값(예: 6100/6101)을 고르세요. 6000, 6665-6669 등은 Chromium이 안전하지 않은 포트로 막으므로 개발 서버가 거부합니다.

```sh
pnpm dev:studio
```

WSL에서는 Linux용 Node.js와 pnpm을 사용하세요. Windows 경로의 pnpm 실행기가 선택되지
않는지 확인하세요. 창을 열려면 WSLg 등 GUI 환경도 필요합니다.

## 명령

| 명령 | 설명 |
| --- | --- |
| `pnpm dev:launcher` | 사용자 런처 개발 모드 |
| `pnpm dev:studio` | 관리 앱 개발 모드 |
| `pnpm build` | 두 앱의 main·preload·renderer 빌드 |
| `pnpm typecheck` | 공유 코어와 두 앱의 TypeScript 검사 |
| `pnpm lint` | Biome 린트·포맷 검사 |
| `pnpm format` | Biome 자동 수정·포맷 적용 |
| `pnpm test` | Vitest 단위 테스트 |
| `pnpm test:watch` | 단위 테스트 감시 모드 |
| `pnpm check` | 린트·타입·단위 테스트·빌드 전체 검사 |
| `pnpm smoke` | 빌드 후 실제 두 Electron 창·IPC·격리 설정 검사 |
| `pnpm package:launcher` | 현재 OS용 사용자 런처 포터블 패키지 |
| `pnpm package:studio` | 현재 OS용 Studio 포터블 패키지 |

`pnpm smoke`는 실제 창을 엽니다. 디스플레이 없는 Linux 환경에서는 Xvfb를 준비하고
`xvfb-run --auto-servernum pnpm smoke`로 실행합니다. Playwright는 설치된 Electron을
실행하므로 별도 Playwright 브라우저 다운로드는 필요하지 않습니다.
검증 화면은 `.cache/smoke/`에 저장되며 Git 추적에서 제외됩니다.

## 구조와 의존 관계

```text
apps/admin/       @torchlauncher/studio
apps/launcher/    @torchlauncher/launcher
packages/core/   @torchlauncher/core
mods/            보조 모드 계획 철회 안내
scripts/         Electron 실행 검증
docs/            설계·구현 순서
```

pnpm 워크스페이스 모노레포이며 두 앱은 서로를 import하지 않습니다. 공통 계약과 유틸리티만
`packages/core`에서 공유합니다. 기본 진입점은 Electron 의존성을 갖지 않고, 데스크톱 계약은
`@torchlauncher/core/desktop`으로 분리합니다. 코어는 각 앱에 번들되므로 배포물에 워크스페이스
소스나 pnpm이 필요하지 않습니다.

## 패키징과 CI

electron-builder가 Windows portable EXE와 Linux tar.gz를 생성합니다.
각 앱의 결과는 `apps/<앱>/dist/`에 저장됩니다. 소스 빌드는 `out/`에 저장됩니다.
각 패키지는 공통 앱이며, Studio는 운영자가 고른 런처 바이너리·서버 구성·브랜딩 자산을 ZIP으로 내보냅니다.

OS별 패키지는 해당 OS에서 빌드하는 것을 기본으로 합니다. 서명 자격 증명과 자동 업데이트는
아직 구성하지 않았습니다. 배포 파일을 사용자에게 제공하기 전 OS별 실행과 서명 정책을 확인해야 합니다.

GitHub Actions의 지원 대상과 작업은 `.github/workflows/`를 따릅니다.
워크플로를 수동 실행하면 현재 러너의 아키텍처로 포터블 패키지도 생성하고 아티팩트로 보관합니다.
CI 구성은 실제 원격 실행 결과와 구분합니다.

## 설계 문서

- [개발 진행·작업 배정·머지 현황](docs/progress.md)
- [제품·아키텍처](docs/architecture.md)
- [구현 순서](docs/implementation-plan.md)
- [기여 가이드](AGENTS.md)
