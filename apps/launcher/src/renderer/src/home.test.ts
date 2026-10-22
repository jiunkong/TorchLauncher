import { describe, expect, it } from 'vitest';
import { productState } from './fixtures';
import { elapsedParts, gameParts, homeView, runningElapsed, visibleError } from './home';

describe('home view selection', () => {
  it('maps product state to the five home presentations', () => {
    expect(homeView(productState(), null, false).kind).toBe('ready');
    expect(homeView(productState({ account: null }), null, false)).toMatchObject({
      kind: 'login',
      primary: { type: 'login' },
    });
    expect(
      homeView(productState({ operation: 'launch', phase: 'game-sync' }), null, false),
    ).toMatchObject({ kind: 'busy', control: 'cancel', disabled: true });
    expect(
      homeView(productState({ operation: 'launch', running: true }), null, false),
    ).toMatchObject({ kind: 'running', control: 'stop' });
    expect(homeView(productState({ error: 'network_failed' }), null, false)).toMatchObject({
      kind: 'error',
      error: 'network_failed',
      primary: { type: 'launch' },
    });
  });

  it('does not present the one-shot status probe as an installation', () => {
    const view = homeView(productState({ operation: 'status' }), null, false);
    expect(view.kind).toBe('ready');
    expect(view.disabled).toBe(true);
  });

  it('treats a missing saved session as the login state, not a failure', () => {
    expect(visibleError(productState({ account: null, error: 'no_session' }), null)).toBeNull();
    expect(
      visibleError(productState({ account: null, error: 'reauthentication_required' }), null),
    ).toBe('reauthentication_required');
    expect(visibleError(productState(), 'busy')).toBe('busy');
  });

  it('blocks play without configuration or on an unsupported system', () => {
    const missing = homeView(
      productState({ configuration: 'unavailable', server: null }),
      null,
      false,
    );
    expect(missing).toMatchObject({ kind: 'unconfigured', primary: null, disabled: true });
    expect(homeView(productState({ supported: false }), null, false)).toMatchObject({
      kind: 'unsupported',
      disabled: true,
    });
  });

  it('keeps the stop control while the game runs even if an error is present', () => {
    expect(
      homeView(productState({ running: true, error: 'network_failed' }), null, false).kind,
    ).toBe('running');
  });

  it('splits elapsed time', () => {
    expect(elapsedParts(222_900)).toEqual({ h: 0, m: 3, s: 42 });
    expect(elapsedParts(3_725_000)).toEqual({ h: 1, m: 2, s: 5 });
    expect(elapsedParts(-5)).toEqual({ h: 0, m: 0, s: 0 });
  });
});

describe('game description and run start', () => {
  it('formats the game parts and drops malformed values', () => {
    const game = { minecraftVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.19.5' } as const;
    expect(gameParts(productState({ game }))).toEqual({
      minecraft: '1.21.1',
      loader: 'Fabric 0.19.5',
    });
    expect(gameParts(productState({ game: { ...game, loader: 'neoforge' } })).loader).toBe(
      'NeoForge 0.19.5',
    );
    expect(gameParts(productState())).toEqual({ minecraft: null, loader: null });
    const bad = { minecraftVersion: '<b>', loader: 'quilt', loaderVersion: '1 2' };
    expect(gameParts(productState({ game: bad as never }))).toEqual({
      minecraft: null,
      loader: null,
    });
    expect(gameParts(productState({ game: 'x' as never }))).toEqual({
      minecraft: null,
      loader: null,
    });
  });
  it('prefers the main-process start time and ignores it when not running', () => {
    const running = productState({ running: true, runningSince: 1_000 });
    expect(runningElapsed(running, 5, 11_000)).toBe(10_000);
    expect(runningElapsed(running, 5, 500)).toBe(0);
    expect(runningElapsed(productState({ running: true }), 7_000, 99_000)).toBe(7_000);
    expect(runningElapsed(productState({ running: false, runningSince: 1 }), 0, 9)).toBe(0);
    expect(runningElapsed(productState({ running: true, runningSince: Number.NaN }), 3, 9)).toBe(3);
  });
});
