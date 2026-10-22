import { createTranslator } from '@torchlauncher/core/i18n';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductState } from '../../shared/product';
import { DeleteDialog } from './components/DeleteDialog';
import { RecoveryDialog } from './components/RecoveryDialog';
import { productState } from './fixtures';
import { formatBytes } from './format';
import { LauncherLocaleProvider } from './i18n';
import { launcherTranslations } from './i18n/catalog';
import { failureMessage, operationLabel, outcomeLabel, recoveryIssueText } from './labels';
import { Home } from './pages/Home';
import { filterLogs, LogsPage } from './pages/Logs';
import { ModsAddButton, ModsPage, ModsView, modNeedsCheck, modNotes } from './pages/Mods';
import { arrangePacks, canMove, movePack, packIds } from './pages/packs';
import { SettingsPage } from './pages/Settings';

const t = createTranslator(launcherTranslations, 'ko');
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(LauncherLocaleProvider, null, element));
const noop = async () => true;

const mod = (
  path: string,
  source: ProductState['mods'][number]['source'],
  extra: Partial<ProductState['mods'][number]> = {},
): ProductState['mods'][number] => ({
  path,
  source,
  state: 'ok',
  conflicts: 0,
  modIds: [path.replace(/\W/g, '')],
  ...extra,
});

describe('labels moved to the dictionary', () => {
  it('keeps the existing failure, operation, and outcome wording', () => {
    expect(failureMessage(t, 'required-pack-removed')).toBe(
      '운영자 필수 리소스팩을 포함해서 저장하세요.',
    );
    expect(failureMessage(t, 'required-pack-reordered')).toContain('순서를 유지');
    expect(failureMessage(t, 'confirmation-expired')).toContain('만료');
    expect(failureMessage(t, 'constructor')).toBe(failureMessage(t, 'unknown-code'));
    expect(operationLabel(t, 'launch', 'game-running')).toBe('게임 실행 중');
    expect(operationLabel(t, 'usage', 'idle')).toBe('서버 데이터 용량 확인 중');
    expect(outcomeLabel(t, 'exited-0')).toBe('게임을 정상 종료했습니다.');
    expect(outcomeLabel(t, 'exited-1')).toBe('게임이 종료되었습니다 (코드 1).');
    expect(outcomeLabel(t, '__proto__')).toContain('로그');
  });

  it('names recovery causes once each and falls back for unknown codes', () => {
    expect(recoveryIssueText(t, ['lock-uncertain', 'lock-uncertain'])).toBe(
      '이전 실행의 잠금 상태를 확인할 수 없습니다.',
    );
    expect(recoveryIssueText(t, [])).toBe('자동으로 정리할 수 없는 항목이 있습니다.');
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB');
  });
});

describe('play page', () => {
  it('does not show the previous operation outcome', () => {
    const html = render(
      createElement(Home, {
        state: productState({ outcome: 'exited-1' }),
        productError: null,
        pending: false,
        elapsedMs: 0,
        stage: null,
        applicationVersion: null,
        applicationInfoFailed: false,
        onPrimary: () => {},
        onCancel: () => {},
        onStop: () => {},
        onViewLogs: () => {},
        onReviewRecovery: () => {},
      }),
    );
    expect(html).not.toContain('최근 결과');
    expect(html).not.toContain('게임이 종료되었습니다 (코드 1).');
  });
});

describe('my mods page', () => {
  const state = productState({
    mods: [
      mod('mods/sodium.jar', 'user', { modIds: ['sodium'] }),
      mod('mods/shader-helper.jar', 'user', { modIds: [] }),
      mod('mods/clash.jar', 'user', { modIds: ['x'], conflicts: 2, state: 'modified' }),
      mod('mods/fabric-api.jar', 'operator'),
      mod('mods/old-test.jar', 'unregistered'),
      mod('mods/broken.jar', 'unregistered', { state: 'unsafe' }),
    ],
  });
  const page = (s: ProductState) =>
    render(createElement(ModsPage, { active: false, state: s, pending: false, command: noop }));

  it('keeps counts out of the headings until the list is loaded', () => {
    const html = page(state);
    expect(html).toContain('내가 추가한 모드 (–)');
    expect(html).not.toContain('sodium.jar');
  });

  it('lists user, server, and unregistered files once loaded, with per-item status', () => {
    const html = render(
      createElement(ModsView, {
        state,
        load: 'loaded',
        ready: true,
        command: noop,
        onRetry: () => {},
      }),
    );
    expect(html).toContain('내가 추가한 모드 (3)');
    expect(html).toContain('서버가 관리하는 모드 (1)');
    expect(html).toContain('등록되지 않은 파일 (2)');
    expect(html).toContain('운영자 관리');
    expect(html).toContain('모드 ID를 읽지 못했습니다 · 중복 검사를 건너뛰었습니다');
    expect(html).toContain('모드 ID 충돌 2건');
    expect(html).toContain('서버 모드와 호환되지 않을 수 있습니다.');
    expect(html).toContain('서버 목록에도 내 모드 목록에도 없습니다');
    // Only a readable, intact unregistered file can be adopted; there is no delete for it.
    expect(html.match(/내 모드로 등록<\/button>/g)).toHaveLength(1);
    expect(html.match(/>삭제<\/button>/g)).toHaveLength(3);
  });

  it('distinguishes loading, failure, and an empty list', () => {
    const view = (load: 'loading' | 'failed' | 'loaded') =>
      render(
        createElement(ModsView, {
          state: productState(),
          load,
          ready: true,
          command: noop,
          onRetry: () => {},
        }),
      );
    expect(view('loading')).toContain('모드 목록을 불러오는 중…');
    expect(view('failed')).toContain('모드 목록을 불러오지 못했습니다.');
    expect(view('failed')).toContain('다시 시도');
    expect(view('loaded')).toContain('추가한 모드가 없습니다.');
    expect(view('loaded')).not.toContain('등록되지 않은 파일');
  });

  it('flags unreadable mod IDs, changed files, and conflicts as needing a check', () => {
    expect(modNeedsCheck(mod('a.jar', 'user', { modIds: [] }))).toBe(true);
    expect(modNeedsCheck(mod('a.jar', 'user', { conflicts: 1 }))).toBe(true);
    expect(modNeedsCheck(mod('a.jar', 'user', { state: 'missing' }))).toBe(true);
    expect(modNeedsCheck(mod('a.jar', 'user'))).toBe(false);
    expect(modNotes(t, mod('a.jar', 'user', { conflicts: 2, state: 'modified' }))).toEqual([
      '등록한 뒤 파일이 바뀌었습니다',
      '모드 ID 충돌 2건',
    ]);
  });

  it('has the add button wired to the existing command slot and disabled when not ready', () => {
    const html = render(createElement(ModsAddButton, { disabled: true, onClick: () => {} }));
    expect(html).toContain('모드 추가 (.jar)');
    expect(html).toContain('disabled=""');
  });
});

describe('settings page', () => {
  const settings = (s: ProductState) =>
    render(
      createElement(SettingsPage, {
        active: false,
        state: s,
        pending: false,
        command: noop,
        onDelete: () => {},
      }),
    );

  it('exposes close-on-launch as an accessible switch', () => {
    const on = settings(productState({ preferences: { closeOnLaunch: true } }));
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('게임 실행 후 런처 종료');
    expect(settings(productState())).toContain('aria-checked="false"');
  });

  it('renders GB memory fields, an optional initial value, and the next-launch note', () => {
    const html = settings(productState());
    expect(html).toContain('data-testid="max-memory"');
    expect(html).toContain('data-testid="initial-memory"');
    expect(html).toContain('최대 메모리 (Xmx)');
    expect(html).toContain('저장한 값은 다음 실행부터 적용됩니다.');
    expect(html).toContain('초기 메모리는 비워 두면 Java 기본값을 사용합니다.');
    expect(html).not.toContain('0.5 GB 단위로 권장합니다');
    expect(html).not.toContain('저장했습니다.');
    expect(html.match(/step="0\.25"/g)).toHaveLength(2);
  });

  it('locks required packs and offers move buttons for user packs only', () => {
    const html = settings(
      productState({
        packs: [
          { id: 'file/server.zip', required: true },
          { id: 'file/a.zip', required: false },
          { id: 'file/b.zip', required: false },
        ],
      }),
    );
    expect(html).toContain('필수');
    expect(html).toContain('aria-label="file/a.zip 위로 이동"');
    expect(html).toContain('aria-label="file/b.zip 아래로 이동"');
    expect(html).not.toContain('file/server.zip 위로');
    expect(html).not.toContain('file/server.zip 아래로');
    // First user pack cannot move up; last cannot move down.
    expect(html).toMatch(
      /disabled=""[^>]*aria-label="file\/a\.zip 위로 이동"|aria-label="file\/a\.zip 위로 이동"[^>]*disabled=""/,
    );
  });

  it('shows usage and no deletion location before a preview exists', () => {
    const html = settings(
      productState({ usage: { bytes: 4.2 * 1024 ** 3, files: 18342, directories: 3 } }),
    );
    expect(html).toContain('4.2 GB');
    expect(html).toContain('서버 데이터 삭제…');
    expect(html).not.toContain('>위치<');
  });
});

describe('resource pack arrangement', () => {
  const current = [
    { id: 'req1', required: true },
    { id: 'a', required: false },
    { id: 'req2', required: true },
    { id: 'b', required: false },
    { id: 'c', required: false },
  ];
  it('moves user packs across fixed required packs without moving them', () => {
    const moved = movePack(current, 1, 1);
    expect(packIds(moved)).toEqual(['req1', 'b', 'req2', 'a', 'c']);
    expect(movePack(current, 0, 1)).toEqual(current);
    expect(canMove(current, 1, -1)).toBe(false);
    expect(canMove(current, 1, 1)).toBe(true);
    expect(canMove(current, 4, 1)).toBe(false);
    expect(canMove(current, 0, 1)).toBe(false);
  });

  it('keeps the draft order across refreshes and drops packs that vanished', () => {
    const arranged = arrangePacks(current, ['c', 'gone', 'a']);
    expect(packIds(arranged)).toEqual(['req1', 'c', 'req2', 'a', 'b']);
    expect(arrangePacks(current, null)).toEqual(current);
  });
});

describe('logs page', () => {
  const logs = [
    { source: 'launcher' as const, text: 'session: ready' },
    { source: 'launcher' as const, text: 'launch: started' },
    { source: 'game' as const, text: 'Loading Minecraft' },
  ];
  it('filters by source and keeps the order', () => {
    expect(filterLogs(logs, 'all')).toEqual([
      'session: ready',
      'launch: started',
      'Loading Minecraft',
    ]);
    expect(filterLogs(logs, 'launcher')).toEqual(['session: ready', 'launch: started']);
    expect(filterLogs(logs, 'game')).toEqual(['Loading Minecraft']);
  });

  it('renders accessible tabs, a selectable log, a copy button, and no open-folder button', () => {
    const state = productState({ logs });
    const html = render(
      createElement(LogsPage, {
        hidden: false,
        state,
        frame: {
          state,
          stage: null,
          productError: null,
          command: noop,
          onNavigate: () => {},
          onStop: () => {},
        },
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('game-log');
    expect(html).toContain('session: ready');
    expect(html).toContain('>복사<');
    expect(html).not.toContain('폴더 열기');
    expect(html).not.toContain('계정 세션');
    expect(html).not.toContain('안전한 복구');
  });
});

describe('confirmation windows', () => {
  const deletion: NonNullable<ProductState['deletion']> = {
    root: '/data/servers/x',
    deletable: true,
    blockers: [],
    incomplete: false,
    bytes: 4.2 * 1024 ** 3,
    confirmation: 'a'.repeat(43),
  };
  const dialog = (overrides: Partial<NonNullable<ProductState['deletion']>> = {}, busy = false) =>
    render(
      createElement(DeleteDialog, {
        deletion: { ...deletion, ...overrides },
        usage: { bytes: 1, files: 18342, directories: 1 },
        userModCount: 2,
        busy,
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );

  it('shows location, size, both lists, and the 10-minute notice', () => {
    const html = dialog();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('/data/servers/x');
    expect(html).toContain('4.2 GB · 파일 18,342개');
    expect(html).toContain('삭제되는 것');
    expect(html).toContain('삭제되지 않는 것');
    expect(html).toContain('서버 모드 · 내 모드 (2)');
    expect(html).toContain('이 확인은 10분 동안만 유효합니다.');
    expect(html).not.toMatch(/data-testid="delete-confirm"[^>]*disabled/);
  });

  it('disables deletion without a token, while blocked, or while busy', () => {
    for (const html of [
      dialog({ confirmation: null }),
      dialog({ deletable: false, blockers: ['locked'] }),
      dialog({}, true),
    ])
      expect(html).toMatch(
        /disabled=""[^>]*data-testid="delete-confirm"|data-testid="delete-confirm"[^>]*disabled=""/,
      );
  });

  it('keeps the recovery button disabled until the box is checked', () => {
    const html = render(
      createElement(RecoveryDialog, { busy: false, onLater: () => {}, onConfirm: () => {} }),
    );
    expect(html).toContain('이전 실행이 정상적으로 끝나지 않았습니다');
    expect(html).toContain('실행 중인 게임이나 런처가 없음을 확인했습니다.');
    expect(html).toContain('나중에');
    expect(html).toMatch(
      /disabled=""[^>]*data-testid="recovery-confirm"|data-testid="recovery-confirm"[^>]*disabled=""/,
    );
    expect(html).toContain('정리하고 계속');
  });
});
