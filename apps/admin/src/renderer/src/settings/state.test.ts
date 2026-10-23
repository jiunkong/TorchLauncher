import { describe, expect, it } from 'vitest';
import { matchesKey, optionLabel } from './state';

const vanilla = { id: 'key_key.jump', mod: false };
const mod = { id: 'key_key.map.zoom', mod: true };

describe('settings key filtering', () => {
  it('filters by origin and by whether a policy is set', () => {
    expect(matchesKey(vanilla, '', 'base', 'none')).toBe(true);
    expect(matchesKey(mod, '', 'base', 'none')).toBe(false);
    expect(matchesKey(mod, '', 'mod', 'none')).toBe(true);
    expect(matchesKey(vanilla, '', 'set', 'none')).toBe(false);
    expect(matchesKey(vanilla, '', 'set', 'required')).toBe(true);
  });
  it('searches raw keys case-insensitively', () => {
    expect(matchesKey(vanilla, 'KEY_KEY.JUMP', 'all', 'none')).toBe(true);
    expect(matchesKey(vanilla, 'zoom', 'all', 'none')).toBe(false);
  });
  it('labels keys without the options.txt prefix', () => {
    expect(optionLabel('key_key.jump')).toBe('key.jump');
    expect(optionLabel('renderDistance')).toBe('renderDistance');
  });
});
