import { describe, expect, it } from 'vitest';
import { matchesKey } from './state';

const vanilla = { id: 'key_key.jump', name: '점프', mod: false };
const mod = { id: 'key_key.map.zoom', name: null, mod: true };

describe('settings key filtering', () => {
  it('filters by origin and by whether a policy is set', () => {
    expect(matchesKey(vanilla, '', 'base', 'none')).toBe(true);
    expect(matchesKey(mod, '', 'base', 'none')).toBe(false);
    expect(matchesKey(mod, '', 'mod', 'none')).toBe(true);
    expect(matchesKey(vanilla, '', 'set', 'none')).toBe(false);
    expect(matchesKey(vanilla, '', 'set', 'required')).toBe(true);
  });
  it('searches display names and raw keys case-insensitively', () => {
    expect(matchesKey(vanilla, '점', 'all', 'none')).toBe(true);
    expect(matchesKey(vanilla, 'KEY_KEY.JUMP', 'all', 'none')).toBe(true);
    expect(matchesKey(mod, 'zoom', 'all', 'none')).toBe(true);
    expect(matchesKey(vanilla, 'zoom', 'all', 'none')).toBe(false);
  });
});
