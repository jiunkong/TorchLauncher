import type { StudioProject } from '../../../shared/studio.js';
import type { StudioController } from '../hooks/useStudio';
export type PageId = 'overview' | 'server' | 'deployment' | 'branding';
export function PageContent({ page, studio }: { page: PageId; studio: StudioController }) {
  const { state, draft, edit, run, busy } = studio;
  if (!draft)
    return (
      <section className="page-panel">
        <div className="empty-state">
          <div className="empty-icon">T</div>
          <h3>서버 프로젝트</h3>
          <p>새 프로젝트를 만들거나 저장된 프로젝트를 여세요.</p>
          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => void run('new')}
            >
              새 프로젝트
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void run('open')}
            >
              프로젝트 열기
            </button>
          </div>
        </div>
      </section>
    );
  const field = (label: string, value: string, change: (value: string) => void, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} disabled={busy} onChange={(e) => change(e.target.value)} />
    </label>
  );
  const patch = (values: Partial<StudioProject>) => edit({ ...draft, ...values });
  if (page === 'overview')
    return (
      <>
        <section className="welcome-card">
          <div>
            <span className="eyebrow">SERVER PROJECT</span>
            <h2>{draft.name}</h2>
            <p>
              {state?.projectName ?? '새 프로젝트'} ·{' '}
              {state?.dirty ? '저장하지 않은 변경 있음' : '저장됨'}
            </p>
            <p>프로젝트를 다시 열면 소스 폴더를 다시 선택해야 합니다.</p>
          </div>
          <div className="welcome-mark" aria-hidden="true">
            T
          </div>
        </section>
        <div className="workflow-grid studio-workflow">
          {[
            ['1', '서버 구성', '이름, 접속 주소, Minecraft와 로더 버전을 입력합니다.'],
            ['2', '배포', '소스 폴더와 파일을 선택해 torchpack을 생성합니다.'],
            ['3', '내보내기', '공개 배포 URL을 검사한 뒤 공통 런처와 함께 내보냅니다.'],
          ].map(([step, title, text]) => (
            <article className="workflow-card" key={step}>
              <span className="step-number">{step}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <p className="help">
          서버 ID: <code>{draft.serverId}</code>
        </p>
      </>
    );
  if (page === 'server')
    return (
      <section className="studio-panel">
        <div className="form-grid">
          {field('서버 이름', draft.name, (name) => patch({ name }))}
          {field('서버 접속 주소 (host:port)', draft.address, (address) => patch({ address }))}
          {field('Minecraft 버전', draft.game.minecraftVersion, (minecraftVersion) =>
            patch({ game: { ...draft.game, minecraftVersion } }),
          )}
          <label className="field">
            <span>로더</span>
            <select
              value={draft.game.loader.kind}
              disabled={busy}
              onChange={(e) =>
                patch({
                  game: {
                    ...draft.game,
                    loader: { ...draft.game.loader, kind: e.target.value as 'fabric' | 'neoforge' },
                  },
                })
              }
            >
              <option value="fabric">Fabric</option>
              <option value="neoforge">NeoForge</option>
            </select>
          </label>
          {field('로더 버전', draft.game.loader.version, (version) =>
            patch({ game: { ...draft.game, loader: { ...draft.game.loader, version } } }),
          )}
          {field(
            '공개 torchpack HTTPS URL',
            draft.sourceUrl,
            (sourceUrl) => patch({ sourceUrl }),
            'url',
          )}
        </div>
        <p className="help">
          Google Drive 공개 링크도 지원합니다. Google 계정 연결은 필요하지 않습니다. 현재 설치 검증
          대상: Minecraft 1.21.1 · Windows/Linux x64.
        </p>
        <p className="help">
          서버 ID: <code>{draft.serverId}</code> (프로젝트 고유 식별자)
        </p>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !draft.sourceUrl}
          onClick={() => void run('check')}
        >
          배포 URL 검사
        </button>
      </section>
    );
  if (page === 'deployment')
    return (
      <section className="studio-panel">
        <h2>배포 소스</h2>
        <p className="help">
          선택한 소스 폴더 안의 일반 파일만 포함합니다. 각 파일의 상대 경로를 그대로 유지합니다.
        </p>
        <p>
          소스 폴더: <strong>{state?.sourceName ?? '선택되지 않음'}</strong>
        </p>
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => void run('source')}
          >
            소스 폴더 선택
          </button>
          <button
            className="button"
            type="button"
            disabled={busy || !state?.sourceName}
            onClick={() => void run('files')}
          >
            파일 추가
          </button>
        </div>
        <div className="file-list">
          <table>
            <thead>
              <tr>
                <th>상대 경로</th>
                <th>적용 정책</th>
                <th>선택</th>
              </tr>
            </thead>
            <tbody>
              {draft.files.map((file, index) => (
                <tr key={file.path}>
                  <td>
                    <code>{file.path}</code>
                  </td>
                  <td>
                    <select
                      aria-label={`${file.path} 적용 정책`}
                      disabled={busy}
                      value={file.policy}
                      onChange={(e) =>
                        patch({
                          files: draft.files.map((item, i) =>
                            i === index
                              ? { ...item, policy: e.target.value as 'always' | 'initial-only' }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="always">항상 적용</option>
                      <option value="initial-only">최초 설치만</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${file.path} 제외`}
                      onClick={() => patch({ files: draft.files.filter((_, i) => i !== index) })}
                    >
                      제외
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!draft.files.length && (
            <p className="help">포함할 파일을 추가하세요. 파일이 없는 배포도 생성할 수 있습니다.</p>
          )}
        </div>
        <p className="help">
          항상 적용: 업데이트마다 배포 파일과 일치시킵니다. 최초 설치만: 기존 사용자 파일을
          유지합니다. 링크·보호 경로는 허용하지 않습니다.
        </p>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !state?.sourceName}
          onClick={() => void run('build')}
        >
          torchpack 생성
        </button>
      </section>
    );
  return (
    <section className="studio-panel">
      <h2>런처 폴더 내보내기</h2>
      <p className="help">
        먼저 torchpack을 공개 HTTPS 주소에 업로드하고 서버 구성에 URL을 입력하세요. 내보낼 때 서버
        ID와 게임·로더를 다시 검사합니다.
      </p>
      <p className="help">
        배포할 기존 공통 Windows portable .exe 또는 Linux .AppImage와 비어 있는 출력 폴더를
        선택합니다. 실행 파일과 torchlauncher-server.json을 함께 전달하세요. Linux AppImage는 실행
        권한이 있어야 합니다.
      </p>
      <p className="help">브랜딩 이미지와 단일 파일 재패키징·서명은 아직 지원하지 않습니다.</p>
      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={busy || !draft.sourceUrl}
          onClick={() => void run('check')}
        >
          배포 URL 검사
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !draft.sourceUrl}
          onClick={() => void run('export')}
        >
          공통 런처 선택 · 폴더 내보내기
        </button>
      </div>
    </section>
  );
}
