import { expect, it } from 'vitest';
import { installationActivity, synchronizationActivity } from './activity';

it('keeps cached checking and Java staging distinct from network downloading', () => {
  for (const phase of ['checking', 'downloading', 'staging', 'publishing'] as const) {
    expect(
      installationActivity({
        phase,
        component: 'java',
        path: 'runtime/java.tar.gz',
        active: 2,
        completed: 4,
        total: 10,
      }),
    ).toEqual({
      phase,
      component: 'java',
      path: 'runtime/java.tar.gz',
      active: 2,
      completed: 4,
      total: 10,
    });
  }
  expect(
    installationActivity({
      phase: 'planning',
      component: 'metadata',
      active: 0,
      completed: 0,
      total: null,
    }).total,
  ).toBeNull();
});

it.each([
  ['mods/no-extension', 'server-mod'],
  ['resourcepacks/arbitrary.pack', 'resource-pack'],
  ['config/nested/file.bin', 'server-config'],
  ['options.txt', 'server-config'],
  ['torchlauncher/settings-policy.json', 'server-config'],
  ['custom/content.unknown', 'server-file'],
])('categorizes %s by ownership location without extension restrictions', (path, component) => {
  expect(synchronizationActivity({ phase: 'staging', state: 'started', path })).toEqual({
    phase: 'staging',
    component,
    path,
    active: 1,
    completed: null,
    total: null,
  });
  expect(synchronizationActivity({ phase: 'applying', state: 'completed', path }).active).toBe(0);
});

it.each([
  '/absolute/private',
  'C:\\private\\file',
  '../private',
  'https://private/path?token=secret',
  'mods/a?token=secret',
])('omits unsafe display path %s and extra private fields', (path) => {
  const result = installationActivity({
    phase: 'checking',
    component: 'game',
    path,
    active: 1,
    completed: 0,
    total: null,
    ...{ url: 'https://private', accessToken: 'secret' },
  });
  expect(result).not.toHaveProperty('path');
  expect(JSON.stringify(result)).not.toMatch(/private|secret|accessToken|url/);
});
