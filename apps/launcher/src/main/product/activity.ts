import type { SyncFileActivity } from '../../../../../packages/core/src/instance/sync/types';
import type { InstallActivity } from '../../../../../packages/core/src/minecraft/installer';
import type { ProductActivity } from '../../shared/product';

/** Display metadata must never expose a URL, an absolute path, or an unsafe path. */
function relativePath(path: string | undefined): { path?: string } {
  if (
    !path ||
    path.length > 1024 ||
    /[:\\?#\p{Cc}\p{Cf}]/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return {};
  return { path };
}

export function installationActivity(activity: InstallActivity): ProductActivity {
  return {
    phase: activity.phase,
    component: activity.component,
    ...relativePath(activity.path),
    active: activity.active,
    completed: activity.completed,
    total: activity.total,
  };
}

export function synchronizationActivity(activity: SyncFileActivity): ProductActivity {
  const path = activity.path;
  const component = path.startsWith('mods/')
    ? 'server-mod'
    : path.startsWith('resourcepacks/')
      ? 'resource-pack'
      : path.startsWith('config/') ||
          path === 'options.txt' ||
          path === 'torchlauncher/settings-policy.json'
        ? 'server-config'
        : 'server-file';
  return {
    phase: activity.phase,
    component,
    ...relativePath(path),
    active: activity.state === 'started' ? 1 : 0,
    completed: null,
    total: null,
  };
}
