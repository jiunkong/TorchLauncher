import { describe, expect, it } from 'vitest';
import { managedBy } from './filePaths';

describe('managedBy', () => {
  it('routes options.txt and pack folders to game settings', () => {
    expect(managedBy('options.txt')).toBe('options');
    expect(managedBy('resourcepacks/server-pack.zip')).toBe('resourcepack');
    expect(managedBy('shaderpacks/BSL.zip')).toBe('shaderpack');
    expect(managedBy('ShaderPacks\\BSL.zip')).toBe('shaderpack');
  });
  it('leaves everything else to the file policy', () => {
    expect(managedBy('mods/options.txt')).toBeNull();
    expect(managedBy('config/lithium.properties')).toBeNull();
    expect(managedBy('resourcepacks')).toBeNull();
  });
});
