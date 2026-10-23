import { describe, expect, it } from 'vitest';
import type { StudioUrlCheck } from '../../../shared/studio.js';
import { addressState, deriveInsights } from './insights';

const check = (patch: Partial<StudioUrlCheck> = {}): StudioUrlCheck => ({
  checkedAt: 0,
  url: 'https://example.org/p.torchpack',
  serverId: 'ok',
  game: 'ok',
  remoteGame: null,
  fileList: { state: 'ok', count: 3 },
  range: 'ok',
  deployment: 'current',
  stale: false,
  ...patch,
});

describe('insights', () => {
  it('has safe defaults without a state', () => {
    const result = deriveInsights(null);
    expect(result.deploy.status).toBe('none');
    expect(result.changed).toBe(0);
    expect(result.addressState).toBe('unchecked');
  });
  it('classifies the address check', () => {
    expect(addressState(check())).toBe('ok');
    expect(addressState(check({ stale: true }))).toBe('stale');
    expect(addressState(check({ game: 'mismatch' }))).toBe('bad');
    expect(addressState(check({ range: 'failed' }))).toBe('bad');
    expect(addressState(check({ fileList: { state: 'unknown', count: null } }))).toBe('bad');
  });
});
