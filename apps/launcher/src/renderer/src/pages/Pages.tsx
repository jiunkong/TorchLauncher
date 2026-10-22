import { EmptyState, Panel } from '../components/EmptyState';

export type PageId = 'home' | 'mods' | 'settings' | 'logs';

export function PageContent({ page }: { page: PageId }) {
  if (page === 'home')
    return (
      <>
        <section className="server-card">
          <div className="server-art" aria-hidden="true">
            <div className="pixel-sun" />
            <div className="pixel-hill hill-back" />
            <div className="pixel-hill hill-front" />
            <span className="server-monogram">T</span>
          </div>
          <div className="server-details">
            <span className="eyebrow">SERVER SPACE</span>
            <h2>서버 정보 연결 전</h2>
            <p>Studio에서 전달한 서버 구성이 연결되면 여기에서 확인할 수 있습니다.</p>
            <div className="server-meta">
              <span>
                <i className="meta-dot" />
                접속 주소 확인 불가
              </span>
              <span>게임 버전 미확인</span>
            </div>
          </div>
          <div className="play-area">
            <span className="connection-state">
              <i className="state-dot" />
              상태 확인 불가
            </span>
            <button
              className="button play-button"
              type="button"
              data-testid="launch-button"
              disabled
            >
              <span aria-hidden="true">▶</span> 플레이
            </button>
            <span className="play-hint">서버 설정 기능 연결 전</span>
          </div>
        </section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR GAME</span>
            <h2>플레이 준비</h2>
          </div>
          <span className="muted">연결 전</span>
        </div>
        <div className="readiness-grid">
          <article className="readiness-card">
            <span className="readiness-icon">◎</span>
            <div>
              <h3>계정</h3>
              <p>계정 상태를 확인할 수 없습니다.</p>
            </div>
            <span className="readiness-tag">확인 불가</span>
          </article>
          <article className="readiness-card">
            <span className="readiness-icon">▣</span>
            <div>
              <h3>게임 환경</h3>
              <p>설치 상태를 확인할 수 없습니다.</p>
            </div>
            <span className="readiness-tag">미확인</span>
          </article>
        </div>
        <div className="notice">
          <span aria-hidden="true">ⓘ</span>
          <p>
            현재 프리뷰에서는 로그인, 동기화, 설치와 실행 기능을 제공하지 않습니다. 준비 상태를
            실제로 확인하기 전까지 플레이는 비활성화됩니다.
          </p>
        </div>
      </>
    );
  const content: Record<
    Exclude<PageId, 'home'>,
    { title: string; description: string; action: string }
  > = {
    mods: {
      title: '모드 목록을 불러올 수 없습니다',
      description: '모드 기능이 연결되면 직접 추가한 항목을 확인하고 관리할 수 있습니다.',
      action: '모드 추가',
    },
    settings: {
      title: '설정 기능이 아직 연결되지 않았습니다',
      description: '개인 설정을 확인하고 저장하는 기능이 준비되면 이곳에서 관리할 수 있습니다.',
      action: '설정 저장',
    },
    logs: {
      title: '실행 기록을 불러올 수 없습니다',
      description: '실행과 업데이트 기능이 연결되면 결과와 로그를 이곳에서 확인할 수 있습니다.',
      action: '로그 새로고침',
    },
  };
  const item = content[page];
  return (
    <Panel>
      <EmptyState
        title={item.title}
        description={item.description}
        action={item.action}
        testId={page === 'settings' ? 'save-button' : undefined}
      />
    </Panel>
  );
}
