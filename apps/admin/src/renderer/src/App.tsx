import type { ApplicationInfo } from '@torchlauncher/core/desktop';
import { useEffect, useState } from 'react';

const features = [
  {
    title: '서버 환경 구성',
    description: 'Minecraft 버전, 로더와 최초 설정을 구성합니다.',
  },
  {
    title: '배포 파일 만들기',
    description: '모드와 리소스팩을 하나의 배포 파일로 준비합니다.',
  },
  {
    title: '전용 런처 내보내기',
    description: '서버 설정과 이미지가 담긴 런처를 전달합니다.',
  },
];

export function App() {
  const [info, setInfo] = useState<ApplicationInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    window.torchlauncher.getApplicationInfo().then(
      (result) => {
        if (active) setInfo(result);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell" data-testid="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          TorchLauncher Studio
        </div>
        <span className="badge">개발 프리뷰</span>
      </header>
      <section className="hero">
        <span className="eyebrow">BUILD YOUR SERVER EXPERIENCE</span>
        <h1>우리 서버의 시작을 설계하세요.</h1>
        <p className="description">
          게임 환경과 서버 이미지를 구성하고, 사용자에게 전달할 전용 런처를 만듭니다.
        </p>
      </section>
      <section className="cards" aria-label="예정된 기능">
        {features.map((feature, index) => (
          <article className="card" key={feature.title}>
            <span className="card-number">0{index + 1}</span>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>
      <p className="notice">
        지금은 초기 프리뷰입니다. 서버 프로젝트 편집, 배포 파일 생성과 런처 내보내기는 아직 제공되지
        않습니다.
      </p>
      <footer className="footer">
        <span>TorchLauncher Studio</span>
        {error ? (
          <span className="error" role="alert">
            앱 정보를 불러오지 못했습니다. 앱을 다시 실행해 주세요.
          </span>
        ) : (
          <span data-testid="application-info">
            {info ? `v${info.version} · ${info.platform}` : '앱 정보 확인 중…'}
          </span>
        )}
      </footer>
    </main>
  );
}
