import { useState } from 'react';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useStudio } from './hooks/useStudio';
import { PageContent, type PageId } from './pages/Pages';

const pages: { id: PageId; label: string; icon: string; title: string; summary: string }[] = [
  {
    id: 'overview',
    label: '개요',
    icon: '⌂',
    title: '서버 프로젝트를 시작하세요',
    summary: '서버 환경을 구성하고 플레이어에게 전달할 런처를 준비합니다.',
  },
  {
    id: 'server',
    label: '서버 구성',
    icon: '◈',
    title: '서버 구성',
    summary: 'Minecraft 버전, 로더, 접속 주소와 기본 환경을 관리합니다.',
  },
  {
    id: 'deployment',
    label: '배포',
    icon: '▤',
    title: '배포 파일',
    summary: '모드와 리소스팩을 배포 파일로 묶고 업데이트를 준비합니다.',
  },
  {
    id: 'branding',
    label: '브랜딩 · 내보내기',
    icon: '↗',
    title: '브랜딩과 런처 내보내기',
    summary: '서버 이미지와 이름을 적용한 전용 런처를 전달합니다.',
  },
];

export function App() {
  const studio = useStudio();
  const { info, error } = useApplicationInfo();
  const [currentPage, setCurrentPage] = useState<PageId>('overview');
  const page = pages.find((item) => item.id === currentPage);
  if (!page) throw new Error(`Unknown ${currentPage} page`);

  return (
    <main className="app-shell" data-testid="app-shell">
      <aside className="sidebar" aria-label="주 메뉴">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          <span className="brand-copy">
            <strong>TorchLauncher</strong>
            <small>STUDIO</small>
          </span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Studio 페이지">
          {pages.map((item) => (
            <button
              key={item.id}
              className={`nav-item${currentPage === item.id ? ' active' : ''}`}
              type="button"
              aria-current={currentPage === item.id ? 'page' : undefined}
              onClick={() => setCurrentPage(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          서버 프로젝트 편집
        </div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Studio</span>
            <span className="crumb-divider">/</span>
            <strong>{page.label}</strong>
          </div>
          <span className="preview-badge">
            <span className="status-dot" />
            {studio.state?.dirty ? '저장하지 않은 변경' : 'Studio'}
          </span>
        </header>
        <div className="page-content">
          <header className="page-heading">
            <div>
              <span className="eyebrow">TORCHLAUNCHER STUDIO</span>
              <h1>{page.title}</h1>
              <p>{page.summary}</p>
            </div>
          </header>
          <div className="project-toolbar actions">
            <button
              className="button"
              type="button"
              disabled={studio.busy}
              onClick={() => void studio.run('new')}
            >
              새 프로젝트
            </button>
            <button
              className="button"
              type="button"
              disabled={studio.busy}
              onClick={() => void studio.run('open')}
            >
              열기
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={studio.busy || !studio.draft}
              onClick={() => void studio.run('save')}
            >
              저장
            </button>
            <button
              className="button"
              type="button"
              disabled={studio.busy || !studio.draft}
              onClick={() => void studio.run('saveAs')}
            >
              다른 이름으로 저장
            </button>
          </div>
          {studio.message && (
            <p className="notice" role="status">
              {studio.message}
            </p>
          )}
          {studio.busy && (
            <div className="notice" role="status">
              <span>
                작업 중… {Math.round((studio.state?.progress ?? 0) / 1024).toLocaleString()} KiB
              </span>
              <button type="button" onClick={() => void studio.run('cancel')}>
                취소
              </button>
            </div>
          )}
          <PageContent page={currentPage} studio={studio} />
        </div>
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
      </section>
    </main>
  );
}
