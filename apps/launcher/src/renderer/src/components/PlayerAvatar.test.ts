import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { avatarSkinHeight, PlayerAvatar } from './PlayerAvatar';

function skin(height: number) {
  const data = new Uint8Array(40);
  data.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(data.buffer);
  view.setUint32(8, 13);
  data.set([73, 72, 68, 82], 12);
  view.setUint32(16, 64);
  view.setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...data))}`;
}
const render = (value?: string, name: string | null = 'Player') =>
  renderToStaticMarkup(
    createElement(PlayerAvatar, { name, label: 'Player label', ...(value ? { skin: value } : {}) }),
  );

describe('player avatar', () => {
  it.each([32, 64])(
    'accepts only bounded PNG skin data and renders both layers for height %i',
    (height) => {
      const value = skin(height);
      expect(avatarSkinHeight(value)).toBe(height);
      const html = render(value);
      expect(html).toContain('class="avatar player-avatar"');
      expect(html).toContain('aria-label="Player label"');
      expect(html).toContain('title="Player label"');
      expect(html).toContain('player-avatar-face');
      expect(html).toContain('player-avatar-hat');
      expect(html).toContain(`--skin-height:${height}`);
      expect(html.match(/draggable="false"/g)).toHaveLength(2);
      // Fallback remains visible until a browser confirms decoding and natural dimensions.
      expect(html).toContain('data-ready="false"');
      expect(html).toContain('player-avatar-fallback">P');
    },
  );

  it.each([
    undefined,
    'https://textures.minecraft.net/texture/abc',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,!!!!',
    'data:image/png;base64,AA==',
    skin(128),
    `${skin(64)} `,
    `data:image/png;base64,${'A'.repeat(90_000)}`,
  ])('uses the first-letter fallback without an image for invalid data %#', (value) => {
    expect(avatarSkinHeight(value)).toBeNull();
    expect(render(value)).not.toContain('<img');
    expect(render(value)).toContain('player-avatar-fallback">P');
  });

  it('preserves empty-account styling and Unicode first letters', () => {
    expect(render(undefined, null)).toContain('avatar player-avatar empty');
    expect(render(undefined, null)).toContain('player-avatar-fallback">?');
    expect(render(undefined, '😀Player')).toContain('player-avatar-fallback">😀');
    expect(render(undefined, 'alex')).toContain('player-avatar-fallback">A');
  });
});
