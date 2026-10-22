# UI 연결 Windows 사용자 검증

#0 준비, 2026-10-22. 새로운 UI의 실계정·실제 게임 접속 결과는 아직 없다.
기존 게임 smoke의 접속 성공과 이번 UI 검증을 구분한다. 사용자 서버는 에이전트가 변경하지 않는다.

## 준비와 실행

사용자가 Fabric 또는 NeoForge 서버를 사용할 수 있다고 답했다. 현재 Drive 배포본의 마지막 확인은
Minecraft 1.21.1 / Fabric 0.19.5이므로 **Fabric 서버만 localhost:25565에서 실행**한다.
Drive 파일을 교체하지 않는다. 최신 배포 불일치는 런처가 실행 직전 차단한다.

원래 저장소의 무시된 `.cache/game-smoke-validation/ui-server.json`을 #0이 생성했다.
이 파일은 기존 무시된 `live-url.txt`에서 URL을 읽어 만들었고, URL/인증 정보는 추적 문서에 적지 않는다.
서버 ID는 `44444444-4444-4444-8444-444444444444`. 파일이 없어졌다면 해당 로컬 URL로 재생성한다.
배포용 런처는 미리 제공된 단일 프로파일을 읽으며 서버 선택·추가·주소 입력 기능이 없다.
아래 환경 변수는 개발 검증용이다.

Windows PowerShell, 기존 네이티브 복사본에서:

```powershell
cd D:\TorchLauncherWindowsSmoke
git status --short --branch
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
$env:TORCH_SERVER_CONFIG = 'D:\Projects\mclauncher\.cache\game-smoke-validation\ui-server.json'
pnpm --filter @torchlauncher/launcher start
```

기존 복사본은 확인 시 `verify/windows-reader-cancel` 브랜치였고 변경 파일은 없었다.
로컬 변경이 생겼거나 명령이 실패하면 reset/clean으로 덮어쓰지 말고 오류만 보고한다.
Node 24와 pnpm 10.34.7을 사용한다. 런처는 새 제품용 userData 경로를 사용하므로 이전 smoke의
인증·게임 캐시가 자동 편입되지 않는다. 첫 설치는 약 1 GiB 다운로드가 필요할 수 있다.

## 확인할 결과

1. 지정한 서버 정보가 보이며 서버 선택 UI가 없다. 서버 상태 새로고침에서 온라인/인원/지연을 확인한다.
2. 로그인 버튼으로 Microsoft 로그인한다. 비밀번호·코드·토큰·원본 인증 로그는 대화로 보내지 않는다.
3. 플레이 버튼으로 설치/동기화/설정 적용 후 서버 월드에 자동 접속되는지 확인한다.
4. 게임을 정상 종료하고 런처의 실행 상태/안전 로그가 갱신되는지 확인한다.
5. 런처를 닫았다 다시 실행했을 때 추가 대화형 로그인 없이 계정이 복원되는지 확인한다.

실패 시 작업 단계와 화면의 정제된 오류 코드만 보고한다. 성공한 프로세스 실행만으로 서버 접속 성공을
판정하지 않는다. 삭제 기능은 기존 게임 데이터 대신 별도 테스트 환경에서만 검증한다.

Studio는 같은 복사본에서 `pnpm --filter @torchlauncher/studio start`로 실행한다.
프로젝트 생성/저장/재열기, 임의 파일+정책 선택, torchpack 생성은 자동 파일/GUI 검증을 이미 통과했다.
실제 패키지 내보내기→실행의 네이티브 검증과 이미지 브랜딩·단일 파일 재패키징은 별도로 남아 있다.
