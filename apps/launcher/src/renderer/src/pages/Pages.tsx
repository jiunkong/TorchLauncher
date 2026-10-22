import { useEffect, useState } from 'react';
import type { ProductCommand, ProductState } from '../../../shared/product';
import { Panel } from '../components/EmptyState';
import type { PageId } from '../components/Menu';

type Props = {
  page: Exclude<PageId, 'home'>;
  state: ProductState;
  pending: boolean;
  command(request: ProductCommand): Promise<boolean>;
};
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function PageContent({ page, state, pending, command }: Props) {
  const busy = state.operation !== null || pending;
  const ready = state.configuration === 'ready' && !busy;
  const [packText, setPackText] = useState(() => state.packs.map((pack) => pack.id).join('\n'));
  const [packDirty, setPackDirty] = useState(false);
  const [modsLoad, setModsLoad] = useState<'unqueried' | 'loading' | 'loaded' | 'failed'>(
    'unqueried',
  );
  const [packsLoad, setPacksLoad] = useState<'unqueried' | 'loading' | 'loaded' | 'failed'>(
    'unqueried',
  );
  const run = (request: ProductCommand) => {
    void command(request);
  };

  useEffect(() => {
    if (!ready) return;
    if (page === 'mods' && modsLoad === 'unqueried') {
      setModsLoad('loading');
      void command({ type: 'mods' }).then((ok) => setModsLoad(ok ? 'loaded' : 'failed'));
    }
    if (page === 'settings' && packsLoad === 'unqueried') {
      setPacksLoad('loading');
      void command({ type: 'packs' }).then((ok) => setPacksLoad(ok ? 'loaded' : 'failed'));
    }
  }, [page, ready, modsLoad, packsLoad, command]);

  useEffect(() => {
    if (page === 'settings' && !packDirty && packsLoad === 'loaded')
      setPackText(state.packs.map((pack) => pack.id).join('\n'));
  }, [page, packDirty, packsLoad, state.packs]);

  if (page === 'mods')
    return (
      <Panel>
        <div className="action-row">
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => {
              setModsLoad('loading');
              void command({ type: 'mods' }).then((ok) => setModsLoad(ok ? 'loaded' : 'failed'));
            }}
          >
            모드 새로고침
          </button>
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => run({ type: 'add-mod' })}
          >
            개인 모드 추가…
          </button>
        </div>
        <p>운영자 모드는 수정할 수 없습니다. 개인 모드 삭제 전 파일 상태를 확인하세요.</p>
        {state.modsRecovery && (
          <p role="alert">중단된 모드 작업이 있습니다. 문제 해결에서 상태를 확인하세요.</p>
        )}
        {modsLoad === 'loading' && <p role="status">모드 목록을 불러오는 중…</p>}
        {modsLoad === 'failed' && (
          <p className="error" role="alert">
            모드 목록을 불러오지 못했습니다. 새로고침을 시도하세요.
          </p>
        )}
        {modsLoad === 'loaded' && state.mods.length === 0 && (
          <p className="muted">설치된 모드가 없습니다.</p>
        )}
        {modsLoad === 'loaded' && state.mods.length > 0 && (
          <ul className="data-list">
            {state.mods.map((mod) => (
              <li key={`${mod.source}:${mod.path}`}>
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
                    onClick={() => {
                      if (window.confirm(`${mod.path} 개인 모드를 삭제할까요?`))
                        run({ type: 'remove-mod', path: mod.path });
                    }}
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
          <h2>런처</h2>
          {state.preferences.error && (
            <p role="alert">
              저장된 런처 설정을 읽지 못해 자동 종료를 껐습니다. 체크박스를 변경해 다시 저장하세요.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={state.preferences.closeOnLaunch}
              disabled={!ready}
              onChange={(event) =>
                run({ type: 'set-close-on-launch', value: event.target.checked })
              }
            />
            게임 실행 후 런처 종료
          </label>
          <p>게임 프로세스가 시작되면 런처를 종료합니다. 게임은 계속 실행됩니다.</p>
        </Panel>
        <Panel>
          <h2>활성 리소스팩 순서</h2>
          <p>한 줄에 하나의 팩 ID를 입력하세요. 필수 팩의 포함과 순서는 유지해야 합니다.</p>
          {packsLoad === 'loading' && <p role="status">설정을 불러오는 중…</p>}
          {packsLoad === 'failed' && (
            <p className="error" role="alert">
              설정을 불러오지 못했습니다. 다시 불러오기를 선택하세요.
            </p>
          )}
          <button
            className="button"
            type="button"
            disabled={!ready}
            onClick={() => {
              if (
                packDirty &&
                !window.confirm('저장하지 않은 리소스팩 변경을 버리고 다시 불러올까요?')
              )
                return;
              setPacksLoad('loading');
              void command({ type: 'packs' }).then((ok) => {
                setPacksLoad(ok ? 'loaded' : 'failed');
                if (ok) {
                  setPackText(state.packs.map((pack) => pack.id).join('\n'));
                  setPackDirty(false);
                }
              });
            }}
          >
            현재 설정 다시 불러오기
          </button>
          {packsLoad === 'loaded' && (
            <>
              <label className="pack-label" htmlFor="resource-packs">
                활성 팩 ID (위에서 아래 순서)
              </label>
              <textarea
                id="resource-packs"
                value={packText}
                onChange={(event) => {
                  setPackText(event.target.value);
                  setPackDirty(true);
                }}
                disabled={busy}
                rows={6}
                maxLength={65792}
              />
              <p>
                필수:{' '}
                {state.packs
                  .filter((pack) => pack.required)
                  .map((pack) => pack.id)
                  .join(', ') || '없음'}
              </p>
              {state.missingPacks.length > 0 && (
                <p>다음 실행 시 복구할 필수 팩: {state.missingPacks.join(', ')}</p>
              )}
              <button
                className="button"
                data-testid="save-button"
                type="button"
                disabled={!ready || !packDirty}
                onClick={() => {
                  void command({
                    type: 'set-packs',
                    packs: packText
                      .split('\n')
                      .map((id) => id.trim())
                      .filter(Boolean),
                  }).then((ok) => {
                    if (ok) setPackDirty(false);
                  });
                }}
              >
                리소스팩 설정 저장
              </button>
            </>
          )}
        </Panel>
        <Panel>
          <h2>서버 데이터</h2>
          <p>
            이 서버의 게임과 개인 데이터를 확인하거나 삭제할 수 있습니다. 삭제는 되돌릴 수 없습니다.
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
    <>
      <Panel>
        <h2>서버 상태</h2>
        <p>
          {state.status.state === 'online'
            ? `응답 있음 · ${state.status.online}/${state.status.maximum}명 · ${state.status.latencyMs}ms`
            : state.status.state === 'unavailable'
              ? '서버에 연결할 수 없습니다. 서버 주소와 네트워크를 확인하세요.'
              : '서버 상태를 아직 확인하지 않았습니다.'}
        </p>
        <button
          className="button"
          type="button"
          disabled={!ready}
          onClick={() => run({ type: 'status' })}
        >
          서버 상태 확인
        </button>
      </Panel>
      <Panel>
        <h2>계정 세션</h2>
        <p>
          {state.account
            ? `${state.account.name} · 만료 ${new Date(state.account.expiresAt).toLocaleString()}`
            : '저장된 세션이 없습니다.'}
        </p>
        <div className="action-row">
          <button
            className="button"
            type="button"
            disabled={!ready || !state.account}
            onClick={() => run({ type: 'refresh' })}
          >
            세션 갱신
          </button>
          <button
            className="button"
            type="button"
            disabled={!ready || !state.account}
            onClick={() => {
              if (window.confirm('저장된 계정을 로그아웃할까요?')) run({ type: 'logout' });
            }}
          >
            로그아웃
          </button>
        </div>
        <p>
          계정 복원은 런처 시작 시 자동으로 시도됩니다. 로그인 코드를 다시 입력해야 하면 홈의 로그인
          동작을 사용하세요.
        </p>
      </Panel>
      <Panel>
        <h2>중단된 작업 복구</h2>
        <p>
          {state.recovery
            ? `잠금: ${state.recovery.lock} · ${state.recovery.needed ? '복구 필요' : '복구할 작업 없음'}`
            : '복구 상태를 아직 확인하지 않았습니다.'}
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
              onClick={() => {
                if (window.confirm('다른 게임 프로세스가 없음을 확인했나요?'))
                  run({ type: 'recover', acceptUncertain: true });
              }}
            >
              다른 게임 종료 확인 후 잠금 복구
            </button>
          )}
        </div>
      </Panel>
      <Panel>
        <h2>최근 진단 기록</h2>
        <p>인증 정보와 URL을 가린 제한된 로그입니다. 게임 종료 결과: {state.outcome ?? '없음'}</p>
        <pre className="game-log" aria-live="off">
          {state.logs.map((entry) => entry.text).join('\n') || '실행 로그가 없습니다.'}
        </pre>
      </Panel>
    </>
  );
}
