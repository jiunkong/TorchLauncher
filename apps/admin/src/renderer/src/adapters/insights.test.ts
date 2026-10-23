import { describe, expect, it } from 'vitest';
import type { StudioProject } from '../../../shared/studio.js';
import { checkSignature, computeInsights, deploySignature } from './insights';

function project(overrides: Partial<StudioProject> = {}): StudioProject {
  return {
    format: 'torchlauncher-project',
    version: 1,
    serverId: '44444444-4444-4444-8444-444444444444',
    name: 'Server',
    address: 'play.example.org:25565',
    sourceUrl: 'https://example.org/pack.torchpack',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
    files: [
      { path: 'mods/a.jar', policy: 'always' },
      { path: 'config/b.toml', policy: 'initial-only' },
    ],
    ...overrides,
  };
}
const at = new Date(0);

describe('insights adapter', () => {
  it('reports unknown deployment before anything was built in this session', () => {
    const result = computeInsights(project(), null, null, null);
    expect(result.deploy.state).toBe('unknown');
    expect(result.deploy.bytes).toBeNull();
    expect(result.address.state).toBe('unchecked');
    expect(result.exported).toBeNull();
  });

  it('diffs files against the last build: added, policy-modified and excluded', () => {
    const built = project();
    const baseline = { at, files: built.files, signature: deploySignature(built) };
    const edited = project({
      files: [
        { path: 'mods/a.jar', policy: 'initial-only' },
        { path: 'mods/new.jar', policy: 'always' },
      ],
    });
    const result = computeInsights(edited, baseline, null, null);
    expect(result.deploy.state).toBe('stale');
    expect(result.deploy.changes).toEqual({ added: 1, modified: 1, excluded: 1 });
    expect(result.fileChanges.get('mods/new.jar')).toBe('added');
    expect(result.fileChanges.get('mods/a.jar')).toBe('modified');
    expect(computeInsights(built, baseline, null, null).deploy.state).toBe('current');
  });

  it('ignores name and address changes for the deployment but not the game', () => {
    const built = project();
    const baseline = { at, files: built.files, signature: deploySignature(built) };
    expect(computeInsights(project({ name: 'Other' }), baseline, null, null).deploy.state).toBe(
      'current',
    );
    const other = project({
      game: { minecraftVersion: '1.21.1', loader: { kind: 'neoforge', version: '21.1.1' } },
    });
    expect(computeInsights(other, baseline, null, null).deploy.state).toBe('stale');
  });

  it('marks the address check stale when the identity, game or URL changed afterwards', () => {
    const checked = project();
    const record = { at, ok: true, signature: checkSignature(checked) };
    expect(computeInsights(checked, null, record, null).address.state).toBe('ok');
    expect(
      computeInsights(project({ sourceUrl: 'https://example.org/other' }), null, record, null)
        .address.state,
    ).toBe('stale');
    const failed = computeInsights(checked, null, { ...record, ok: false }, null);
    expect(failed.address.state).toBe('bad');
    expect(failed.address.checks.find((item) => item.id === 'game')?.status).toBe('bad');
    expect(failed.address.checks.find((item) => item.id === 'range')?.status).toBe('pending');
  });
});
