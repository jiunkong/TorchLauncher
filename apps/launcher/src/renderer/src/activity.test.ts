import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductActivity } from '../../shared/product';
import { ActivityProgress, activityLabel, activityProgress } from './activity';

describe('user-facing installation activity', () => {
  it('uses Korean component and phase names for each operation category', () => {
    const components: Array<[ProductActivity['component'], string]> = [
      ['metadata', '게임 정보'],
      ['game', '게임 파일'],
      ['java', 'Java'],
      ['library', '라이브러리'],
      ['asset', '게임 리소스'],
      ['logging', '로그 설정'],
      ['loader', '모드 로더'],
      ['server-mod', '서버 모드'],
      ['resource-pack', '리소스팩'],
      ['server-config', '서버 설정'],
      ['server-file', '서버 파일'],
    ];
    for (const [component, expectedLabel] of components) {
      const actualLabel = activityLabel({
        component,
        phase: 'downloading',
        active: 1,
        completed: null,
        total: null,
      });
      expect(actualLabel).toContain('다운로드 중');
      expect(actualLabel).toContain(expectedLabel);
    }
  });

  it('does not invent counts or identify one current file for parallel work', () => {
    expect(
      activityProgress({
        component: 'game',
        phase: 'downloading',
        active: 6,
        completed: null,
        total: null,
      }),
    ).toBe('진행 중 · 6개 작업 중');
  });

  it('renders determinate progress only when the total is known', () => {
    const known = renderToStaticMarkup(
      ActivityProgress({
        activity: { component: 'game', phase: 'downloading', active: 2, completed: 3, total: 8 },
      }),
    );
    const unknown = renderToStaticMarkup(
      ActivityProgress({
        activity: {
          component: 'game',
          phase: 'downloading',
          active: 2,
          completed: null,
          total: null,
        },
      }),
    );
    expect(known).toContain('value="3"');
    expect(known).toContain('max="8"');
    expect(unknown).not.toContain('value=');
    expect(unknown).not.toContain('max=');
  });

  it('shows measured counts when available', () => {
    expect(
      activityProgress({
        component: 'server-mod',
        phase: 'applying',
        active: 1,
        completed: 4,
        total: 9,
      }),
    ).toBe('완료 4개 / 9개');
  });
});
