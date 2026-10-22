import { describe, expect, it } from 'vitest';
import { productState } from './fixtures';
import { appReady, nextSplashPhase } from './splash';

describe('splash readiness', () => {
  it('waits for the first state and the startup session restore', () => {
    expect(appReady(null, null)).toBe(false);
    expect(appReady(productState({ operation: 'refresh' }), null)).toBe(false);
    expect(appReady(productState(), null)).toBe(true);
    expect(appReady(productState({ error: 'no_session', account: null }), null)).toBe(true);
  });

  it('does not hide a failed product connection', () => {
    expect(appReady(null, '런처 서비스에 연결하지 못했습니다.')).toBe(true);
  });
});

describe('splash phases', () => {
  const idle = { minimumElapsed: false, maximumElapsed: false, ready: false };
  it('plays for the minimum even when loading is already done', () => {
    expect(nextSplashPhase('playing', { ...idle, ready: true })).toBe('playing');
  });
  it('keeps the torch lit while loading takes longer', () => {
    expect(nextSplashPhase('playing', { ...idle, minimumElapsed: true })).toBe('waiting');
    expect(nextSplashPhase('waiting', { ...idle, minimumElapsed: true })).toBe('waiting');
  });
  it('finishes when ready after the minimum, or at the safety cap', () => {
    expect(nextSplashPhase('playing', { ...idle, minimumElapsed: true, ready: true })).toBe(
      'finishing',
    );
    expect(
      nextSplashPhase('waiting', { minimumElapsed: true, maximumElapsed: false, ready: true }),
    ).toBe('finishing');
    expect(
      nextSplashPhase('waiting', { minimumElapsed: true, maximumElapsed: true, ready: false }),
    ).toBe('finishing');
  });
  it('never goes back once finishing', () => {
    expect(nextSplashPhase('finishing', idle)).toBe('finishing');
  });
});
