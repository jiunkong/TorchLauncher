import { useEffect, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';
import { Panel } from '../components/EmptyState';

export type PageId = 'home' | 'mods' | 'settings' | 'logs';
type Props = { page: PageId; state: ProductState; command(request: ProductCommand): Promise<void> };
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
export function PageContent({ page, state, command }: Props) {
  const busy = state.operation !== null;
  const ready = state.configuration === 'ready' && !busy;
  const [packText, setPackText] = useState('');
  const currentPacks = state.packs.map((pack) => pack.id).join('\n');
  useEffect(() => setPackText(currentPacks), [currentPacks]);
  const run = (request: ProductCommand) => {
    void command(request);
  };
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
            <h2>{state.server?.name ?? '서버 구성 없음'}</h2>
            <p>{state.server?.address ?? 'Studio에서 내보낸 서버 구성 파일을 런처 옆에 두세요.'}</p>
            <div className="server-meta">
              <span>Minecraft 1.21.1 · Fabric / NeoForge</span>
              <span>Windows / Linux x64</span>
            </div>
          </div>
          <div className="play-area">
            <span className="connection-state">
              {state.status.state === 'online'
                ? `온라인 · ${state.status.online}/${state.status.maximum}명 · ${state.status.latencyMs}ms`
                : state.status.state === 'unavailable'
                  ? '서버 상태 확인 실패'
                  : '서버 상태 미확인'}
            </span>
            <button
              className="button play-button"
              type="button"
              data-testid="launch-button"
              disabled={!ready || !state.supported || !state.account}
              onClick={() => run({ type: 'launch' })}
            >
              ▶ 플레이
            </button>
            <button
              className="button"
              disabled={!ready}
              onClick={() => run({ type: 'status' })}
              type="button"
            >
              서버 상태 새로고침
            </button>
          </div>
        </section>
        <Panel>
          <h2>Microsoft 계정</h2>
          <p>
            {state.account
              ? `${state.account.name} · 세션 만료 ${new Date(state.account.expiresAt).toLocaleString()}`
              : '로그인하거나 저장된 세션을 갱신하세요.'}
          </p>
          <div className="action-row">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => run({ type: 'login' })}
            >
              로그인
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => run({ type: 'refresh' })}
            >
              저장된 세션 갱신
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => run({ type: 'logout' })}
            >
              로그아웃 · 저장된 인증 삭제
            </button>
          </div>
          <p className="muted">
            브라우저의 Microsoft 로그인 화면과 별도 코드 창을 사용합니다. 실행할 때 세션과 최신
            배포를 다시 확인합니다.
          </p>
        </Panel>
        <Panel>
          <h2>중단된 작업 복구</h2>
          <p>
            {state.recovery
              ? `잠금: ${state.recovery.lock} · ${state.recovery.needed ? '복구 필요' : '복구할 작업 없음'}`
              : '복구 상태를 확인하세요.'}
          </p>
          {state.recovery?.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          <div className="action-row">
            <button
              className="button"
              type="button"
              disabled={!ready}
              onClick={() => run({ type: 'inspect' })}
            >
              복구 상태 확인
            </button>
            <button
              className="button"
              type="button"
              disabled={!ready || !state.recovery?.needed}
              onClick={() => run({ type: 'recover', acceptUncertain: false })}
            >
              안전한 복구
            </button>
            {state.recovery?.confirmable && (
              <button
                className="button"
                type="button"
                disabled={!ready}
                onClick={() => run({ type: 'recover', acceptUncertain: true })}
              >
                다른 게임 종료 확인 후 잠금 복구
              </button>
            )}
          </div>
        </Panel>
        <div className="notice">
          <p>
            플레이는 Java 프로세스를 실행합니다. 실제 서버 접속 완료는 게임에서 확인하세요.{' '}
            {!state.supported && '현재 운영 체제 또는 CPU는 지원하지 않습니다.'}
          </p>
        </div>
      </>
    );
  if (page === 'mods')
    return (
      <Panel>
        <div className="action-row">
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => run({ type: 'mods' })}
          >
            모드 새로고침
          </button>
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => run({ type: 'add-mod' })}
          >
            모드 추가…
          </button>
        </div>
        <p>
          운영자 모드는 수정할 수 없습니다. 개인 모드는 복사해서 등록하며 변경된 파일은 강제로
          삭제하지 않습니다.
        </p>
        {state.modsRecovery && <p role="alert">중단된 모드 작업이 있습니다. 홈에서 복구하세요.</p>}
        {state.mods.length === 0 ? (
          <p className="muted">목록을 새로고침해 모드를 확인하세요.</p>
        ) : (
          <ul className="data-list">
            {state.mods.map((mod) => (
              <li key={mod.path}>
                <div>
                  <strong>{mod.path}</strong>
                  <p>
                    {mod.source === 'operator'
                      ? '운영자'
                      : mod.source === 'user'
                        ? '개인'
                        : '미등록'}{' '}
                    · {mod.state} · 충돌 {mod.conflicts}개 {mod.modIds.join(', ')}
                  </p>
                </div>
                {mod.source === 'user' && (
                  <button
                    className="button"
                    type="button"
                    disabled={!ready}
                    onClick={() => run({ type: 'remove-mod', path: mod.path })}
                  >
                    개인 모드 삭제
                  </button>
                )}
                {mod.source === 'unregistered' && mod.state === 'ok' && (
                  <button
                    className="button"
                    type="button"
                    disabled={!ready}
                    onClick={() => run({ type: 'adopt-mod', path: mod.path })}
                  >
                    개인 모드로 편입
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  if (page === 'settings')
    return (
      <>
        <Panel>
          <h2>활성 리소스팩 순서</h2>
          <p>
            한 줄에 하나의 팩 ID를 입력하세요 (예: vanilla, file/my-pack.zip). 필수 팩을 제거하거나
            필수 팩끼리 순서를 바꿀 수 없습니다.
          </p>
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => run({ type: 'packs' })}
          >
            현재 설정 불러오기
          </button>
          <label className="pack-label" htmlFor="resource-packs">
            활성 팩 ID (위에서 아래 순서)
          </label>
          <textarea
            id="resource-packs"
            value={packText}
            onChange={(event) => setPackText(event.target.value)}
            disabled={busy}
            rows={6}
            maxLength={65792}
          />
          <p>
            필수:{' '}
            {state.packs
              .filter((pack) => pack.required)
              .map((pack) => pack.id)
              .join(', ') || '없음 / 미확인'}
          </p>
          {state.missingPacks.length > 0 && (
            <p>다음 실행 시 복구할 필수 팩: {state.missingPacks.join(', ')}</p>
          )}
          <button
            className="button"
            data-testid="save-button"
            type="button"
            disabled={!ready}
            onClick={() =>
              run({
                type: 'set-packs',
                packs: packText
                  .split('\n')
                  .map((id) => id.trim())
                  .filter(Boolean),
              })
            }
          >
            리소스팩 설정 저장
          </button>
        </Panel>
        <Panel>
          <h2>서버 데이터</h2>
          <p>
            이 서버의 게임, 모드, 저장 데이터와 개인 설정을 관리합니다. 인증 정보는 별도 위치에
            보관됩니다.
          </p>
          <div className="action-row">
            <button
              className="button"
              type="button"
              disabled={!ready}
              onClick={() => run({ type: 'usage' })}
            >
              사용 용량 확인
            </button>
            <button
              className="button"
              type="button"
              disabled={!ready}
              onClick={() => run({ type: 'preview-delete' })}
            >
              삭제 미리보기
            </button>
          </div>
          {state.usage && (
            <p>
              {bytes(state.usage.bytes)} · 파일 {state.usage.files}개 · 폴더{' '}
              {state.usage.directories}개
            </p>
          )}
          {state.deletion && (
            <div className="deletion-preview">
              <p>
                삭제할 위치: <code>{state.deletion.root}</code>
              </p>
              <p>
                {state.deletion.bytes === null ? '용량 확인 불가' : bytes(state.deletion.bytes)}{' '}
                {state.deletion.incomplete && '· 중단된 삭제 이어하기'}
              </p>
              {state.deletion.blockers.length > 0 && (
                <p>삭제 차단: {state.deletion.blockers.join(', ')}</p>
              )}
              <button
                className="button danger"
                type="button"
                disabled={!ready || !state.deletion.deletable || !state.deletion.confirmation}
                onClick={() => {
                  const confirmation = state.deletion?.confirmation;
                  if (confirmation) run({ type: 'delete', confirmation });
                }}
              >
                영구 삭제 확인…
              </button>
            </div>
          )}
        </Panel>
      </>
    );
  return (
    <Panel>
      <h2>최근 게임 로그</h2>
      <p>인증 정보와 URL을 가린 제한된 로그입니다. 게임 종료 결과: {state.outcome ?? '없음'}</p>
      <pre className="game-log" aria-live="off">
        {state.logs.join('\n') || '실행 로그가 없습니다.'}
      </pre>
    </Panel>
  );
}
