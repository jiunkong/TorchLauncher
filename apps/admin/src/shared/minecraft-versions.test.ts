import { describe, expect, it } from 'vitest';
import { minecraftVersions } from './minecraft-versions.js';

describe('pinned Minecraft release catalog', () => {
  it('contains stable releases from 1.14 onward and has no duplicates', () => {
    expect(minecraftVersions[0]).toBe('26.3');
    expect(minecraftVersions.at(-1)).toBe('1.14');
    expect(minecraftVersions).toContain('1.21.1');
    expect(minecraftVersions).not.toContain('1.13.2');
    expect(minecraftVersions).toHaveLength(48);
    expect(new Set(minecraftVersions).size).toBe(minecraftVersions.length);
    expect(minecraftVersions.some((version) => /snapshot|pre|rc/i.test(version))).toBe(false);
  });
});
