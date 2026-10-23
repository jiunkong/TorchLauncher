import { describe, expect, it } from 'vitest';
import { appReady, nextSplashPhase } from './splash';

describe('splash phases', () => {
  const base = { minimumElapsed: false, maximumElapsed: false, ready: false };
  it('plays until the minimum time elapsed, even when the app is ready', () => {
    expect(nextSplashPhase('playing', { ...base, ready: true })).toBe('playing');
  });
  it('waits lit while loading continues and finishes once ready', () => {
    expect(nextSplashPhase('playing', { ...base, minimumElapsed: true })).toBe('waiting');
    expect(nextSplashPhase('waiting', { ...base, minimumElapsed: true, ready: true })).toBe(
      'finishing',
    );
  });
  it('never hides a stuck startup beyond the maximum', () => {
    expect(
      nextSplashPhase('waiting', { ...base, minimumElapsed: true, maximumElapsed: true }),
    ).toBe('finishing');
  });
  it('treats a failed first load as ready so the error is not covered', () => {
    expect(appReady(false, true)).toBe(true);
    expect(appReady(false, false)).toBe(false);
  });
});
