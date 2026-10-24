import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuProps } from './components/Menu';
import { SplashView } from './components/Splash';
import { StopDialog } from './components/StopDialog';
import { productState } from './fixtures';
import { LauncherLocaleProvider } from './i18n';
import { Home, type HomeProps } from './pages/Home';

const localePreferenceKey = 'torchlauncher.launcher.locale-preference';
const storageValues = new Map<string, string>();
const storageMock = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, value),
  removeItem: (key: string) => storageValues.delete(key),
};
let previousStorage: Storage | undefined;
beforeEach(() => {
  previousStorage = globalThis.localStorage;
  storageValues.clear();
  storageMock.setItem(localePreferenceKey, JSON.stringify({ mode: 'explicit', locale: 'ko' }));
  vi.stubGlobal('localStorage', storageMock);
});
afterEach(() => {
  if (previousStorage === undefined) vi.unstubAllGlobals();
  else vi.stubGlobal('localStorage', previousStorage);
  storageValues.clear();
});

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
  stage: null,
  onReviewRecovery: () => {},
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

  it('shows default app name and account controls when expanded', () => {
    const html = render(createElement(Menu, { ...menuProps, open: true }));
    expect(html).toContain('data-open="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="메뉴 닫기"');
    expect(html).toContain('TorchLauncher');
    expect(html).not.toContain('Fixture Server');
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

  it('shows the installation panel as the real stage order with a stage-level summary', () => {
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
    const html = render(createElement(Home, homeProps({ state, stage: 'game' })));
    expect(html).toContain('게임 파일을 확인하고 받는 중');
    expect(html).toContain('progress indet');
    expect(html).toContain('전체 개수를 아직 알 수 없습니다');
    expect(html).toContain('<li class="done">정보 확인</li>');
    expect(html).toContain('<li class="now">게임 파일 확인·받기</li>');
    expect(html).toContain('<li class="">로더 설치</li>');
    expect(html).toContain('<li class="">서버 파일 동기화</li>');
    expect(html.indexOf('정보 확인')).toBeLessThan(html.indexOf('게임 파일 확인·받기'));
    expect(html.indexOf('로더 설치')).toBeLessThan(html.indexOf('서버 파일 동기화'));
    // No per-file names and no invented counts.
    expect(html).not.toContain('완료 97');
    expect(html).not.toContain('Java');
    expect(html).toContain('설치하는 중…');
    expect(html).toContain('>취소<');
    expect(html).not.toContain('%');
  });

  it('keeps showing the furthest stage when an earlier component reports late', () => {
    const state = productState({
      operation: 'launch',
      activity: { phase: 'downloading', component: 'asset', active: 1, completed: 5, total: 9 },
    });
    const html = render(createElement(Home, homeProps({ state, stage: 'loader' })));
    expect(html).toContain('<li class="now">로더 설치</li>');
    expect(html).toContain('로더를 설치하는 중');
    expect(html).not.toContain('완료 5 / 전체 9');
  });

  it('shows "completed / total" and a ratio bar for game files only when measured', () => {
    const state = productState({
      operation: 'launch',
      activity: { phase: 'downloading', component: 'asset', active: 1, completed: 2, total: 8 },
    });
    const html = render(createElement(Home, homeProps({ state, stage: 'game' })));
    expect(html).toContain('완료 2 / 전체 8');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('width:25%');
  });

  it('never shows a ratio for server file synchronization', () => {
    const state = productState({
      operation: 'launch',
      activity: { phase: 'staging', component: 'server-mod', active: 1, completed: 4, total: 9 },
    });
    const html = render(createElement(Home, homeProps({ state, stage: 'sync' })));
    expect(html).toContain('서버 파일을 동기화하는 중');
    expect(html).toContain('완료 4개');
    expect(html).toContain('progress indet');
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toContain('/ 전체');
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
    const html = render(createElement(SplashView, { phase: 'waiting', minimumMs: 1600 }));
    expect(html).toContain('aria-label="TorchLauncher"');
    expect(html).toContain('TORCH');
    expect(html).toContain('LAUNCHER');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('is-waiting');
  });
});

describe('recovery on the home screen', () => {
  const blocked = (recovery: NonNullable<ReturnType<typeof productState>['recovery']>) =>
    productState({ error: 'recovery-required', recovery });
  it('offers the previous-run window when confirmation is possible', () => {
    const html = render(
      createElement(
        Home,
        homeProps({
          state: blocked({
            needed: true,
            lock: 'uncertain',
            confirmable: true,
            issues: ['lock-uncertain'],
          }),
        }),
      ),
    );
    expect(html).toContain('이전 실행의 정리가 필요합니다.');
    expect(html).toContain('data-testid="review-recovery"');
    expect(html).toContain('이전 실행 확인');
    expect(html).toContain('로그 보기 →');
  });

  it('explains the cause and offers only logs when it cannot be confirmed away', () => {
    const html = render(
      createElement(
        Home,
        homeProps({
          state: blocked({
            needed: true,
            lock: 'free',
            confirmable: false,
            issues: ['install-invalid', 'something-new'],
          }),
        }),
      ),
    );
    expect(html).toContain('게임 설치 상태가 올바르지 않습니다.');
    expect(html).toContain('자동으로 정리할 수 없는 항목이 있습니다.');
    expect(html).not.toContain('review-recovery');
    expect(html).toContain('로그 보기 →');
  });
});
