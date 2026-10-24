import { describe, expect, it } from 'vitest';
import { managedBy, managedPage } from './filePaths';

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

describe('managedPage', () => {
  it('links each managed file to the page that owns it', () => {
    expect(managedPage('resourcepacks/a.zip')).toBe('packs');
    expect(managedPage('shaderpacks/a.zip')).toBe('shaders');
    expect(managedPage('config/sodium.properties')).toBe('mods');
    expect(managedPage('options.txt')).toBe('playerSettings');
    expect(managedPage('torchlauncher/settings-policy.json')).toBe('playerSettings');
  });
});
