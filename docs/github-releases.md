# GitHub 자동 릴리스

공식 저장소는 [jiunkong/TorchLauncher](https://github.com/jiunkong/TorchLauncher)다.
`.github/workflows/release.yml`은 **release 브랜치 push** 또는 그 브랜치의 수동 실행으로
런처와 Studio의 Windows x64 portable EXE·Linux x64 AppImage를 생성하고 GitHub Releases에 게시한다.
다른 브랜치·다른 저장소에서는 게시 작업이 실행되지 않는다.
수동 실행 메뉴를 쓰려면 워크플로 파일이 GitHub 기본 브랜치에도 있어야 하며, 실행 대상으로 release를 선택한다. macOS·ARM64 배포는 포함하지 않는다.

## 릴리스 준비

루트 `package.json`, `apps/launcher/package.json`, `apps/admin/package.json`의 버전을
같은 안정 버전(`0.1.0`처럼 `x.y.z`)으로 맞춘다. prerelease 문자열은 거부한다.
버전 `0.1.0`은 `v0.1.0` 태그가 된다. 이미 있는 태그나 릴리스는 덮어쓰지 않는다.
새 버전을 배포하려면 세 파일의 버전을 함께 올린다.

배포할 소스를 release 브랜치에 통합한 뒤 해당 브랜치를 push하면 자동화가 시작된다.
워크플로를 로컬에서 작성하거나 커밋하는 것만으로는 GitHub Actions가 실행되지 않는다.
이 문서와 구성을 준비하는 과정에서는 원격 push·태그 생성·릴리스 게시를 실행하지 않았다.

## 실행 순서

1. 버전 일치와 기존 태그·릴리스 유무를 검사한다. API 오류를 '릴리스 없음'으로 처리하지 않는다.
2. Windows와 Linux 러너에서 Node 24·pnpm 10.34.7·고정 lockfile로 설치하고 `pnpm build`를 실행한다.
   릴리스 워크플로에서는 테스트·lint·타입 검사·Electron smoke를 반복하지 않는다.
   release 브랜치에 넣을 소스의 사전 검증은 기존 CI와 통합 담당자가 맡는다.
3. 해당 OS에서 두 앱을 x64로 패키징한다. electron-builder에는 `--publish never`를 전달한다.
   Windows는 portable, Linux는 AppImage를 명시한다. 로컬 기본 Linux tar.gz 설정은 그대로다.
4. 예상한 실행 파일 네 개만 수집해 헤더·크기·SHA-256을 검사하고
   `SHA256SUMS`, `release-metadata.json`을 생성한다.
5. 정확한 워크플로 커밋 SHA로 새 태그를 생성하고 해당 태그의 draft를 만들어 파일을 올린다.
   태그 생성은 기존 태그가 있으면 실패하며 강제로 이동하지 않는다.
   GitHub asset의 길이·digest가 로컬 파일과 전부 일치한 뒤 안정 릴리스로 공개한다.

실패한 업로드/검증은 공개 단계로 진행되지 않으며 draft가 남을 수 있다.
재시도 전 실패한 draft와 같은 버전 태그 상태를 확인해 운영자가 정리해야 한다.
자동 재시도로 이미 게시한 자산을 교체하거나 태그를 이동하지 않는다.

## 파일 이름과 권한

버전이 `0.1.0`일 때 게시하는 파일은 다음과 같다.

- `TorchLauncher-0.1.0-win-x64.exe`
- `TorchLauncher-0.1.0-linux-x64.AppImage`
- `TorchLauncher Studio-0.1.0-win-x64.exe`
- `TorchLauncher Studio-0.1.0-linux-x64.AppImage`
- `SHA256SUMS`
- `release-metadata.json`

`dist/`, `out/`, `.cache/`는 Git에서 제외한다. 산출물은 Actions의 임시 artifact를 거쳐
GitHub Releases에 올라가며 Git 소스 커밋에는 포함되지 않는다.
`release-metadata.json`에는 저장소·버전·태그·커밋과 실행 파일별 길이·SHA-256이 들어간다.

소스 검증·빌드 job은 `contents: read`, 게시 job만 `contents: write`를 사용한다.
저장소 기본 `GITHUB_TOKEN`을 사용하므로 별도 PAT나 코드 서명 인증서는 요구하지 않는다.
저장소/조직 정책에서 Actions의 해당 권한 사용을 허용해야 한다.

Studio의 릴리스 다운로드는 같은 저장소의 안정 릴리스와 위 런처 이름을 사용한다.
Studio의 GitHub 계정 연동은 없으므로 배포 시 해당 저장소/릴리스가 인증 없이 접근 가능해야 한다.
GitHub가 제공하는 asset `digest`를 무결성 검사에 사용한다.

## 검증 범위

로컬에서 `node --test scripts/release.test.mjs`, `node scripts/release.mjs version`,
`actionlint .github/workflows/release.yml`로 스크립트와 워크플로 구성을 확인할 수 있다.
단위 테스트의 GitHub API는 모의 응답이다. 실제 hosted runner 빌드·패키지 실행·릴리스 업로드는
워크플로 파일의 존재나 로컬 검사만으로 검증된 것으로 간주하지 않는다.

이 구성은 릴리스 빌드·업로드 자동화다. 런처 자체 자동 업데이트와 서명된 업데이트 매니페스트는
[RELEASE-02 정책](release-policy.md) 범위다. 현재 `release-metadata.json`은 서명된 매니페스트가 아니다.

공식 참고: [워크플로 브랜치 필터](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore),
[gh release create](https://cli.github.com/manual/gh_release_create),
[gh release edit](https://cli.github.com/manual/gh_release_edit),
[GitHub asset digest](https://docs.github.com/en/rest/releases/assets).
