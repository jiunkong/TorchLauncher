import { parseServerConfig } from '../../../../../../packages/core/src/server-config/index.js';
import type { StudioProject } from '../../../shared/studio.js';
import type { StudioController } from '../hooks/useStudio';
export type PageId = 'overview' | 'server' | 'deployment' | 'branding';

const baselineConfig = {
  format: 'torchlauncher-server',
  version: 1,
  serverId: '44444444-4444-4444-8444-444444444444',
  name: 'Server',
  address: 'localhost:25565',
  sourceUrl: 'https://example.org/unconfigured',
} as const;

export function validateServer(project: StudioProject) {
  const errors: Record<string, string> = {};
  try {
    parseServerConfig({ ...baselineConfig, name: project.name });
  } catch {
    errors.name = '1–100자 이름을 입력하세요. 앞뒤 공백과 제어 문자는 허용되지 않습니다.';
  }
  try {
    parseServerConfig({ ...baselineConfig, address: project.address });
  } catch {
    errors.address =
      '호스트 이름 또는 IP 주소와 1–65535 사이 포트를 입력하세요 (예: play.example.org:25565).';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(project.game.minecraftVersion))
    errors.minecraftVersion = '1–64자의 영문자, 숫자, 점, 밑줄, 더하기 또는 빼기를 입력하세요.';
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(project.game.loader.version))
    errors.loaderVersion = '1–64자의 영문자, 숫자, 점, 밑줄, 더하기 또는 빼기를 입력하세요.';
  return errors;
}
export function validHttps(value: string) {
  try {
    parseServerConfig({ ...baselineConfig, sourceUrl: value });
    return true;
  } catch {
    return false;
  }
}
export function PageContent({
  page,
  studio,
  onNavigate,
}: {
  page: PageId;
  studio: StudioController;
  onNavigate: (page: PageId) => void;
}) {
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

  const serverErrors = validateServer(draft);
  const serverReady = Object.keys(serverErrors).length === 0;
  const sourceReady = !!state?.sourceName;
  const urlReady = validHttps(draft.sourceUrl);
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    key?: string,
    type = 'text',
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        disabled={busy}
        aria-invalid={key ? !!serverErrors[key] : undefined}
        onChange={(e) => change(e.target.value)}
      />
      {key && serverErrors[key] && <small className="field-error">{serverErrors[key]}</small>}
    </label>
  );
  const patch = (values: Partial<StudioProject>) => edit({ ...draft, ...values });
  const stages = [
    {
      id: 'server' as const,
      title: '1. 서버와 게임 환경',
      status: serverReady ? '필수 정보 입력됨' : `${Object.keys(serverErrors).length}개 입력 필요`,
      done: serverReady,
    },
    {
      id: 'deployment' as const,
      title: '2. 소스와 배포 파일',
      status: sourceReady ? `소스 선택됨 · ${draft.files.length}개 파일` : '소스 폴더 선택 필요',
      done: sourceReady,
    },
    {
      id: 'branding' as const,
      title: '3. 업로드와 내보내기',
      status: urlReady ? 'HTTPS 주소 입력됨' : '팩 생성 후 공개 HTTPS 주소 입력',
      done: urlReady,
    },
  ];
  if (page === 'overview')
    return (
      <>
        <section className="welcome-card">
          <div>
            <span className="eyebrow">SERVER PROJECT</span>
            <h2>{draft.name || '이름이 필요한 프로젝트'}</h2>
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
        <section className="studio-panel studio-workflow" aria-label="프로젝트 작업 단계">
          <h2>다음 작업</h2>
          <div className="workflow-list">
            {stages.map((stage) => (
              <article className="workflow-row" key={stage.id}>
                <div>
                  <h3>{stage.title}</h3>
                  <p>{stage.status}</p>
                </div>
                <button className="button" type="button" onClick={() => onNavigate(stage.id)}>
                  {stage.done ? '확인 · 수정' : '이 단계 열기'}
                </button>
              </article>
            ))}
          </div>
          <p className="help">
            URL 검사는 배포 파일을 만든 뒤 공개 호스팅에 직접 업로드하고 진행하세요.
          </p>
        </section>
        <p className="help">
          서버 ID: <code>{draft.serverId}</code>
        </p>
      </>
    );

  if (page === 'server')
    return (
      <section className="studio-panel">
        <h2>서버와 게임 환경</h2>
        <div className="form-grid">
          {field('서버 이름', draft.name, (name) => patch({ name }), 'name')}
          {field(
            '서버 접속 주소 (host:port)',
            draft.address,
            (address) => patch({ address }),
            'address',
          )}
          {field(
            'Minecraft 버전',
            draft.game.minecraftVersion,
            (minecraftVersion) => patch({ game: { ...draft.game, minecraftVersion } }),
            'minecraftVersion',
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
          {field(
            '로더 버전',
            draft.game.loader.version,
            (version) =>
              patch({ game: { ...draft.game, loader: { ...draft.game.loader, version } } }),
            'loaderVersion',
          )}
        </div>
        <p className="help">
          설정한 게임·로더 버전과 서버 배포 파일이 일치하는지 내보내기 단계에서 확인합니다. 현재
          설치 검증 대상: Minecraft 1.21.1 · Windows/Linux x64.
        </p>
        <p className="help">
          서버 ID: <code>{draft.serverId}</code> (프로젝트 고유 식별자)
        </p>
        <div className="actions">
          <button className="button" type="button" onClick={() => onNavigate('deployment')}>
            다음: 소스와 파일 선택
          </button>
        </div>
      </section>
    );

  if (page === 'deployment')
    return (
      <section className="studio-panel">
        <h2>소스 파일과 적용 정책</h2>
        <p className="help">
          선택한 소스 폴더 안의 일반 파일만 포함합니다. 파일의 상대 경로를 유지합니다. 공개 URL은 팩
          생성과 업로드가 끝난 뒤 입력합니다.
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
            disabled={busy || !sourceReady}
            onClick={() => void run('files')}
          >
            파일 추가
          </button>
        </div>
        {!sourceReady && (
          <p className="field-error" role="status">
            팩을 만들려면 먼저 소스 폴더를 선택하세요. 선택된 폴더가 없어도 프로젝트 저장과 서버
            설정은 계속할 수 있습니다.
          </p>
        )}
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
            <p className="help">
              아직 추가한 파일이 없습니다. 파일이 없는 배포도 만들 수 있습니다.
            </p>
          )}
        </div>
        <p className="help">
          항상 적용: 업데이트마다 배포 파일과 일치시킵니다. 최초 설치만: 기존 사용자 파일을
          유지합니다. 링크·보호 경로는 허용하지 않습니다.
        </p>
        {!serverReady && (
          <p className="field-error" role="status">
            서버 구성에서 표시된 필수 입력을 먼저 수정하세요.
          </p>
        )}
        <div className="actions">
          <button
            className="button button-primary"
            type="button"
            disabled={busy || !sourceReady || !serverReady}
            onClick={() => void run('build')}
          >
            torchpack 생성
          </button>
          <button className="button" type="button" onClick={() => onNavigate('branding')}>
            다음: 업로드와 내보내기
          </button>
        </div>
      </section>
    );

  return (
    <section className="studio-panel">
      <h2>업로드한 배포 파일 확인과 런처 내보내기</h2>
      <p className="help">
        배포 단계에서 torchpack을 만든 다음 공개 호스팅에 직접 업로드하세요. 여기서 받은 공개 HTTPS
        URL을 검사합니다.
      </p>
      {field(
        '공개 torchpack HTTPS URL',
        draft.sourceUrl,
        (sourceUrl) => patch({ sourceUrl }),
        undefined,
        'url',
      )}
      {draft.sourceUrl && !urlReady && (
        <p className="field-error" role="status">
          유효한 공개 HTTPS 주소를 입력하세요. Google Drive 공개 링크도 지원하며 계정 연결은
          필요하지 않습니다.
        </p>
      )}
      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={busy || !urlReady || !serverReady}
          onClick={() => void run('check')}
        >
          배포 URL 검사
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !urlReady || !serverReady}
          onClick={() => void run('export')}
        >
          공통 런처 선택 · 폴더 내보내기
        </button>
      </div>
      {!serverReady && (
        <p className="field-error">내보내기 전에 서버 구성의 필수 입력을 수정하세요.</p>
      )}
      <p className="help">
        내보낼 기존 공통 Windows portable .exe 또는 Linux .AppImage와 비어 있는 출력 폴더를
        선택합니다. 실행 파일과 torchlauncher-server.json을 함께 전달하세요. Linux AppImage는 실행
        권한이 있어야 합니다.
      </p>
      <p className="help">브랜딩 이미지와 단일 파일 재패키징·서명은 아직 지원하지 않습니다.</p>
    </section>
  );
}
