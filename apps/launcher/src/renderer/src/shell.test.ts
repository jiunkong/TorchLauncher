import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu, type MenuProps } from './components/Menu';
import { SplashView } from './components/Splash';
import { StopDialog } from './components/StopDialog';
import { productState } from './fixtures';
import { LauncherLocaleProvider } from './i18n';
import { Home, type HomeProps } from './pages/Home';

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(LauncherLocaleProvider, null, element));

const menuProps: MenuProps = {
  open: false,
  onToggle: () => {},
  page: 'home',
  onNavigate: () => {},
  serverName: 'Fixture Server',
  accountName: 'Player',
  logoutDisabled: false,
  onLogout: () => {},
};
const homeProps = (overrides: Partial<HomeProps> = {}): HomeProps => ({
  state: productState(),
  productError: null,
  pending: false,
  elapsedMs: 0,
  seenSteps: [],
  applicationVersion: '0.1.0',
  applicationInfoFailed: false,
  onPrimary: () => {},
  onCancel: () => {},
  onStop: () => {},
  onViewLogs: () => {},
  ...overrides,
});

describe('menu accessibility', () => {
  it('starts collapsed in one container with labelled buttons and aria-expanded=false', () => {
    const html = render(createElement(Menu, menuProps));
    expect(html).toContain('data-open="false"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="메뉴 열기"');
    for (const label of ['플레이', '내 모드', '설정', '로그'])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-current="page"');
    // Hidden labels stay out of the tab order and accessibility tree.
    expect(html).toMatch(/<strong class="side-name fade" inert=""/);
    expect(html).toMatch(/<button class="lo fade"[^>]*inert=""/);
    expect(html).toContain('class="lbl fade" aria-hidden="true"');
    expect(html).toContain('title="설정"');
  });

  it('shows names, the server, and the account controls when expanded', () => {
    const html = render(createElement(Menu, { ...menuProps, open: true }));
    expect(html).toContain('data-open="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="메뉴 닫기"');
    expect(html).toContain('Fixture Server');
    expect(html).toContain('Player');
    expect(html).toContain('aria-label="로그아웃"');
    expect(html).not.toMatch(/inert=""/);
    expect(html).not.toContain('play.example.invalid');
  });

  it('keeps the same toggle and item buttons in both states', () => {
    const count = (html: string) => html.match(/<button/g)?.length;
    expect(count(render(createElement(Menu, menuProps)))).toBe(
      count(render(createElement(Menu, { ...menuProps, open: true }))),
    );
  });

  it('offers no logout without an account', () => {
    const html = render(createElement(Menu, { ...menuProps, open: true, accountName: null }));
    expect(html).toContain('로그인 필요');
    expect(html).not.toContain('aria-label="로그아웃"');
  });
});

describe('home states', () => {
  it('shows status, server name, version line, and play without the server address', () => {
    const html = render(createElement(Home, homeProps()));
    expect(html).toContain('온라인 · 12명 접속 · 31ms');
    expect(html).toContain('<h1>Fixture Server</h1>');
    expect(html).toContain('Minecraft 1.21.1');
    expect(html).toContain('플레이');
    expect(html).not.toContain('play.example.invalid');
    expect(html).not.toContain('role="alert"');
  });

  it('distinguishes unqueried, checking, and failed server status', () => {
    const unknown = productState({ status: { state: 'unknown' } });
    expect(render(createElement(Home, homeProps({ state: unknown })))).toContain('아직 확인하지');
    expect(
      render(createElement(Home, homeProps({ state: { ...unknown, operation: 'status' } }))),
    ).toContain('서버 상태 확인 중…');
    expect(
      render(
        createElement(
          Home,
          homeProps({ state: productState({ status: { state: 'unavailable' } }) }),
        ),
      ),
    ).toContain('서버 상태를 확인하지 못했습니다');
  });

  it('asks for Microsoft login without a saved account', () => {
    const html = render(
      createElement(
        Home,
        homeProps({ state: productState({ account: null, error: 'no_session' }) }),
      ),
    );
    expect(html).toContain('Microsoft 계정으로 로그인');
    expect(html).not.toContain('role="alert"');
  });

  it('shows the installation panel with indeterminate progress, chips, and cancel', () => {
    const state = productState({
      operation: 'launch',
      phase: 'game-sync',
      activity: {
        phase: 'downloading',
        component: 'library',
        active: 4,
        completed: 97,
        total: null,
      },
    });
    const html = render(
      createElement(Home, homeProps({ state, seenSteps: ['java', 'game', 'library'] })),
    );
    expect(html).toContain('라이브러리 다운로드 중');
    expect(html).toContain('완료 97개 · 4개 작업 중');
    expect(html).toContain('progress indet');
    expect(html).toContain('전체 개수를 아직 알 수 없습니다');
    expect(html).toContain('<li class="done">Java</li>');
    expect(html).toContain('<li class="now">라이브러리</li>');
    expect(html).toContain('설치하는 중…');
    expect(html).toContain('>취소<');
    expect(html).not.toContain('%');
  });

  it('shows measured progress only with measured counts', () => {
    const state = productState({
      operation: 'launch',
      activity: { phase: 'downloading', component: 'asset', active: 1, completed: 2, total: 8 },
    });
    const html = render(createElement(Home, homeProps({ state })));
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('width:25%');
  });

  it('shows elapsed time and a red stop button while the game runs', () => {
    const html = render(
      createElement(
        Home,
        homeProps({
          state: productState({ running: true, operation: 'launch' }),
          elapsedMs: 222_000,
        }),
      ),
    );
    expect(html).toContain('게임 실행 중 · 3분 42초');
    expect(html).toContain('btn stop lg');
    expect(html).toContain('게임 종료');
  });

  it('explains a failure with the existing cause text, retry, and a logs link', () => {
    const html = render(
      createElement(Home, homeProps({ state: productState({ error: 'network_failed' }) })),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('panel warn');
    expect(html).toContain('네트워크 요청에 실패했습니다.');
    expect(html).toContain('다시 시도');
    expect(html).toContain('로그 보기 →');
  });

  it('blocks play and names the cause when the server configuration is missing', () => {
    const html = render(
      createElement(
        Home,
        homeProps({ state: productState({ configuration: 'unavailable', server: null }) }),
      ),
    );
    expect(html).toContain('서버 구성 없음');
    expect(html).toContain('disabled=""');
  });
});

describe('stop confirmation', () => {
  it('is a modal dialog with the confirmed wording', () => {
    const html = render(createElement(StopDialog, { onCancel: () => {}, onConfirm: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('게임을 종료할까요?');
    expect(html).toContain('저장되지 않은 진행 상황이 사라질 수 있습니다.');
  });
});

describe('splash', () => {
  it('always shows the TorchLauncher logo and name with a labelled loading bar', () => {
    const html = render(createElement(SplashView, { phase: 'waiting', minimumMs: 2200 }));
    expect(html).toContain('aria-label="TorchLauncher"');
    expect(html).toContain('TORCH');
    expect(html).toContain('LAUNCHER');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('is-waiting');
  });
});
