import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StudioGameSettings } from '../../../../shared/studio.js';
import { StudioLocaleProvider } from '../../i18n';
import { useSettingsState } from '../../settings/state';
import { fakeStudio, project, useKoreanLocale } from '../fixtures/fakeStudio';
import { ConfigPanes, mergeConfigFiles } from './ModSettingsPage';
import { PlayerSettingsPage } from './PlayerSettingsPage';

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(StudioLocaleProvider, null, element));

const game: StudioGameSettings = {
  options: [
    { key: 'key_key.jump', value: 'key.keyboard.space', policy: 'required', kind: 'keybind' },
    { key: 'renderDistance', value: '12', policy: 'none', kind: 'other' },
  ],
  resourcePacks: [],
  shaderPacks: [],
};

function Player(props: { loaded: boolean }) {
  const settings = useSettingsState();
  const fake = fakeStudio({
    project: props.loaded ? { ...project, gameSettings: game } : project,
    preset: props.loaded ? ({ source: 'test', optionCount: 2, ignored: 0 } as never) : null,
  });
  return createElement(PlayerSettingsPage, {
    studio: fake.studio,
    draft: fake.studio.draft ?? project,
    insights: {} as never,
    settings,
    go: () => undefined,
  });
}

beforeAll(useKoreanLocale);

describe('player settings page', () => {
  it('offers the two import sources before anything is imported', () => {
    const html = render(createElement(Player, { loaded: false }));
    expect(html).toContain('data-testid="settings-empty"');
    expect(html).toContain('테스트 실행 결과');
    expect(html).toContain('options.txt 파일');
    expect(html).toContain('선택한 파일 없음');
    expect(html).toContain('테스트 실행으로 이동');
    expect(html).not.toContain('data-testid="settings-imported"');
  });

  it('shows the import bar as one row with a segmented toggle and a normal reload button', () => {
    const html = render(createElement(Player, { loaded: true }));
    expect(html).toContain('data-testid="settings-imported"');
    expect(html).toContain('class="seg"');
    expect(html).toContain('단축키 1개 · 옵션 1개');
    expect(html).toContain('다시 가져오기');
    expect(html).not.toMatch(/btn primary[^>]*>[^<]*<svg[^>]*>.*?다시 가져오기/s);
    expect(html).toContain('key.jump');
  });
});

describe('mod settings panes', () => {
  const files = [
    {
      path: 'config/iris.properties',
      items: [{ key: 'enableShaders', value: 'true', policy: 'initial' as const }],
    },
    { path: 'config/lithium.properties', items: [] },
  ];
  const panes = (unsupported: string[]) =>
    render(
      createElement(ConfigPanes, {
        files,
        managed: new Set<string>(),
        unsupported,
        labels: { none: 'a', initial: 'b', required: 'c' },
        send: () => undefined,
        busy: false,
      }),
    );

  it('lists files on the left and the selected file items with search on the right', () => {
    const html = panes([]);
    expect(html).toContain('iris.properties');
    expect(html).toContain('lithium.properties');
    expect(html).toContain('data-testid="config-items"');
    expect(html).toContain('enableShaders');
    expect(html).toContain('항목 검색');
    expect(html).toContain('정한 항목 1개');
  });

  it('shows unsupported formats dimmed with a chip', () => {
    const html = panes(['config/sodium-options.json']);
    expect(html).toContain('data-testid="config-unsupported"');
    expect(html).toContain('sodium-options.json');
    expect(html).toContain('지원 안 함');
  });

  it('merges managed files with test run candidates once per path', () => {
    const merged = mergeConfigFiles(
      { ...game, configFiles: [files[0] as (typeof files)[number]] } as StudioGameSettings,
      files,
    );
    expect(merged.map((file) => file.path)).toEqual([
      'config/iris.properties',
      'config/lithium.properties',
    ]);
  });
});
