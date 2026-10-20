import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from './desktop';

describe('renderer document validation', () => {
  it('accepts the loaded file with client-side navigation', () => {
    expect(
      isTrustedRendererUrl(
        'file:///app/out/index.html?tab=mods#settings',
        'file:///app/out/index.html',
      ),
    ).toBe(true);
  });

  it.each([
    'file:///other/index.html',
    'file://other-host/app/out/index.html',
    'https://example.com/index.html',
    'data:text/html,hello',
    'not a URL',
  ])('rejects an unexpected document: %s', (actual) => {
    expect(isTrustedRendererUrl(actual, 'file:///app/out/index.html')).toBe(false);
  });

  it.each([
    'http://localhost:5174/',
    'http://localhost:5173/other',
    'http://localhost:5173.evil.example/',
    'http://user@localhost:5173/',
  ])('rejects a different dev document or origin: %s', (actual) => {
    expect(isTrustedRendererUrl(actual, 'http://localhost:5173/')).toBe(false);
  });

  it('allows the configured development document', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/#home', 'http://localhost:5173/')).toBe(
      true,
    );
  });

  it('does not trust unsupported expected URL schemes', () => {
    expect(isTrustedRendererUrl('data:text/html,hello', 'data:text/html,hello')).toBe(false);
  });
});
