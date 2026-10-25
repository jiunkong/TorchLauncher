# 런처 UI 시안 소스

2026-10-22 사용자와 확정한 런처 시안이다. 구현 기준과 결정은 [런처 UI 명세](../../launcher-ui.md)를 따른다.

- `*.dc.html`은 시안 도구용 파일이다. 브라우저에서 단독으로 열 수 없다(`support.js`가 없음). **마크업, 문구, 클래스, CSS를 읽는 참고 자료**로만 쓴다.
- `launcher.css`, `home.css`, `states.css`가 공용 스타일(색 토큰, 레이아웃, 컴포넌트)이다. 구현에서는 앱의 CSS로 옮기되 토큰 이름과 값을 유지한다.
- 시안의 `src="/_blob/..."` 이미지는 모두 `assets/branding/icon.png`(레드스톤 토치)다.
- 서버 이름, 접속 인원, 모드 파일 이름, 경로, 시각은 **샘플 데이터**다. 실제 값은 서버 프로파일과 제품 상태에서 가져온다.
- 홈의 배경 풍경(별, 해, 산)은 CSS로 그린 샘플이다. 실제로는 운영자가 지정한 이미지이고, 없으면 `home.css`의 `.scene.fallback` 모습(어두운 바탕과 토치 빛)을 쓴다.
- 창 제목 표시줄은 구현에서도 직접 그린다: 높이 36px, 배경 `--bg-deep`, 왼쪽에 아이콘·창 제목. 최소화·최대화·닫기는 OS 네이티브 컨트롤 오버레이를 그대로 쓰며, 표시줄 영역은 창을 끄는 드래그 영역이다.
- 글꼴: 시안은 Google Fonts를 불러오지만 **앱은 외부 네트워크로 글꼴을 받지 않는다.** 본문은 시스템 글꼴 스택, 워드마크만 번들 글꼴(Pixelify Sans, OFL)을 쓴다. 자세한 내용은 명세를 따른다.

| 파일 | 화면 |
| --- | --- |
| Splash, SplashSlow | 시작 애니메이션(기본 흐름 / 로딩이 길어질 때) |
| Main, HomeOpen, HomeNoBg | 홈(메뉴 닫힘 기본 / 열림 / 운영자 배경 없음) |
| HomeLogin, HomeInstalling, HomeRunning, HomeError | 홈의 상태별 표현 |
| Mods, Settings, Troubleshooting | 내 모드, 설정, 로그 (Troubleshooting 파일이 "로그" 페이지) |
| DialogDelete, DialogRecovery, DialogStop | 서버 데이터 삭제 / 이전 실행 확인 / 게임 종료 확인 |
