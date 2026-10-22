import { EmptyState, Panel } from '../components/EmptyState';

export type PageId = 'overview' | 'server' | 'deployment' | 'branding';

export function PageContent({ page }: { page: PageId }) {
  if (page === 'overview') {
    return (
      <>
        <div className="welcome-card">
          <div>
            <span className="eyebrow">STUDIO WORKSPACE</span>
            <h2>서버 경험을 차근차근 만들어 보세요.</h2>
            <p>프로젝트 편집, 배포 생성, 런처 내보내기를 한곳에서 준비합니다.</p>
          </div>
          <div className="welcome-mark" aria-hidden="true">
            T
          </div>
        </div>
        <div className="section-heading">
          <div>
            <span className="eyebrow">WORKFLOW</span>
            <h2>작업 공간</h2>
          </div>
          <span className="muted">기능 준비 중</span>
        </div>
        <div className="workflow-grid">
          {[
            ['01', '서버 구성', '게임 버전과 서버 환경을 정합니다.'],
            ['02', '배포 준비', '서버 파일을 검토하고 업데이트를 만듭니다.'],
            ['03', '런처 전달', '브랜드를 적용한 런처를 내보냅니다.'],
          ].map(([number, title, text]) => (
            <article className="workflow-card" key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="status-pill">준비 중</span>
            </article>
          ))}
        </div>
        <div className="notice">
          <span aria-hidden="true">ⓘ</span>
          <p>
            Studio의 편집 및 생성 기능은 아직 연결되지 않았습니다. 이 화면은 작업 구조를 미리
            살펴보는 프리뷰입니다.
          </p>
        </div>
      </>
    );
  }
  const content: Record<
    Exclude<PageId, 'overview'>,
    { title: string; description: string; action: string }
  > = {
    server: {
      title: '서버 프로젝트 기능이 아직 연결되지 않았습니다',
      description:
        '프로젝트 편집이 준비되면 버전, 로더, 접속 정보와 기본 설정을 이곳에서 구성할 수 있습니다.',
      action: '새 프로젝트 만들기',
    },
    deployment: {
      title: '배포 목록을 불러올 수 없습니다',
      description: '배포 기능이 연결되면 배포할 파일을 선택하고 결과를 확인할 수 있습니다.',
      action: '배포 파일 만들기',
    },
    branding: {
      title: '런처 내보내기가 아직 연결되지 않았습니다',
      description: '서버 프로젝트와 브랜딩 설정 기능이 준비되면 전용 런처를 내보낼 수 있습니다.',
      action: '런처 내보내기',
    },
  };
  const item = content[page];
  return (
    <Panel>
      <EmptyState title={item.title} description={item.description} action={item.action} />
    </Panel>
  );
}
