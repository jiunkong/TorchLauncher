import type { ApplicationInfo } from '@torchlauncher/core/desktop';
import { useEffect, useState } from 'react';

const features = [
  {
    title: '자동 환경 구성',
    description: '서버에 맞는 게임 버전과 모드 환경을 준비합니다.',
  },
  {
    title: '필요한 만큼 업데이트',
    description: '변경된 파일만 확인하고 내려받습니다.',
  },
  {
    title: '바로 서버 접속',
    description: '환경 준비부터 서버 접속까지 한 번에 연결합니다.',
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
          TorchLauncher
        </div>
        <span className="badge">개발 프리뷰</span>
      </header>
      <section className="hero">
        <span className="eyebrow">YOUR SERVER, ONE CLICK AWAY</span>
        <h1>서버로 향하는 가장 짧은 길.</h1>
        <p className="description">
          모드부터 리소스팩까지, 서버에 필요한 환경을 한곳에서 준비합니다.
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
        지금은 초기 프리뷰입니다. 로그인, 게임 설치와 서버 접속 기능은 아직 제공되지 않습니다.
      </p>
      <footer className="footer">
        <span>TorchLauncher</span>
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
