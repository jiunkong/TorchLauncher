import { useState } from 'react';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useProduct } from './hooks/useProduct';
import { PageContent, type PageId } from './pages/Pages';

const pages: { id: PageId; label: string; icon: string; title: string; summary: string }[] = [
  {
    id: 'home',
    label: '홈 · 플레이',
    icon: '▶',
    title: '서버에 접속할 준비를 합니다',
    summary: '계정과 게임 환경을 확인한 뒤 서버에 접속할 수 있습니다.',
  },
  {
    id: 'mods',
    label: '내 모드',
    icon: '◈',
    title: '내 모드',
    summary: '직접 추가한 모드를 확인하고 관리합니다.',
  },
  {
    id: 'settings',
    label: '설정',
    icon: '⚙',
    title: '설정',
    summary: '게임과 런처의 개인 설정을 관리합니다.',
  },
  {
    id: 'logs',
    label: '로그',
    icon: '≡',
    title: '로그',
    summary: '최근 실행과 업데이트 기록을 확인합니다.',
  },
];

function failureMessage(code: string): string {
  const messages: Record<string, string> = {
    secure_storage_unavailable:
      '안전한 계정 저장소를 사용할 수 없습니다. Linux에서는 시스템 키체인 서비스를 확인하세요.',
    no_session: '저장된 계정이 없습니다. Microsoft 로그인을 진행하세요.',
    reauthentication_required: '계정 세션이 만료되었습니다. 다시 로그인하세요.',
    cancelled: '작업을 취소했습니다.',
    busy: '현재 작업이 끝난 뒤 다시 시도하세요.',
    'recovery-required': '중단된 작업이 있습니다. 홈에서 복구 상태를 확인하세요.',
    'deletion-incomplete':
      '중단된 삭제가 있습니다. 설정에서 삭제 미리보기를 다시 열고 이어서 삭제하세요.',
    'required-pack-removed': '운영자 필수 리소스팩을 포함해서 저장하세요.',
    'required-pack-reordered': '운영자 필수 리소스팩의 순서를 유지하세요.',
    'options-owned-by-sync':
      '운영자가 options.txt 전체를 관리하고 있습니다. 운영자에게 설정 정책 구성을 요청하세요.',
    'sync-not-initialized': '게임 동기화가 완료된 뒤 설정을 변경하세요.',
    'configuration-unavailable':
      '서버 구성을 읽지 못했습니다. 운영자에게 이 서버용 런처를 다시 받으세요.',
  };
  return messages[code] ?? code;
}

export function App() {
  const { info, error } = useApplicationInfo();
  const { state, error: productError, command } = useProduct();
  const [currentPage, setCurrentPage] = useState<PageId>('home');
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
            <small>SERVER CLIENT</small>
          </span>
        </div>
        <div className="server-identity">
          <span className="server-identity-icon" aria-hidden="true">
            T
          </span>
          <span>
            <strong>{state?.server?.name ?? '서버 환경'}</strong>
            <small>{state?.server?.address ?? '서버 구성 없음'}</small>
          </span>
        </div>
        <div className="workspace-label">LIBRARY</div>
        <nav className="navigation" aria-label="런처 페이지">
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
          <div className="profile-avatar" aria-hidden="true">
            ◎
          </div>
          <div className="profile-copy">
            <strong>계정</strong>
            <small>{state?.account?.name ?? '로그인 필요'}</small>
          </div>
        </div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>TorchLauncher</span>
            <span className="crumb-divider">/</span>
            <strong>{page.label}</strong>
          </div>
          <span className="preview-badge">
            <span className="status-dot" />
            개발 프리뷰
          </span>
        </header>
        <div className="page-content">
          <header className="page-heading">
            <div>
              <span className="eyebrow">TORCHLAUNCHER</span>
              <h1>{page.title}</h1>
              <p>{page.summary}</p>
            </div>
          </header>
          {state?.operation && (
            <div className="operation-status" role="status">
              <strong>
                {state.phase === 'game-running'
                  ? '게임 실행 중 · 서버 접속은 게임에서 확인'
                  : `진행 중: ${state.phase}`}
              </strong>
              {state.progress && (
                <progress value={state.progress.completed} max={state.progress.total} />
              )}
              <button
                className="button"
                type="button"
                onClick={() => {
                  void command({ type: state.running ? 'stop' : 'cancel' });
                }}
              >
                {state.running ? '게임 종료' : '작업 취소'}
              </button>
            </div>
          )}
          {(productError || state?.error) && (
            <p className="error" role="alert">
              작업 결과: {failureMessage(productError ?? state?.error ?? 'operation-failed')}
            </p>
          )}
          {state?.outcome && <p role="status">최근 결과: {state.outcome}</p>}
          {state ? (
            <PageContent page={currentPage} state={state} command={command} />
          ) : (
            <p role="status">런처 서비스 연결 중…</p>
          )}
        </div>
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
      </section>
    </main>
  );
}
