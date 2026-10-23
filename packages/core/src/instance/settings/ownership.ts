import { collisionKey } from '../sync/safety.js';
import {
  OPTIONS_PATH,
  SettingsError,
  type SettingsPathClass,
  type SettingsPolicy,
  type SyncOwnership,
} from './types.js';

function find(ownership: SyncOwnership, path: string) {
  const key = collisionKey(path);
  return ownership.files.find((file) => collisionKey(file.path) === key);
}

/** Classify one game-directory-relative path against the injected sync ownership. */
export function classifySettingsPath(path: string, ownership: SyncOwnership): SettingsPathClass {
  const file = find(ownership, path);
  if (!file) return 'user';
  return file.policy === 'always' ? 'required' : 'initial-default';
}

export interface ManagedFileDescription {
  path: string;
  classification: Exclude<SettingsPathClass, 'user'>;
  sha256: string;
  length: number;
}

export function describeManagedFiles(ownership: SyncOwnership): ManagedFileDescription[] {
  return ownership.files
    .map((file) => ({
      path: file.path,
      classification: (file.policy === 'always' ? 'required' : 'initial-default') as
        | 'required'
        | 'initial-default',
      sha256: file.sha256,
      length: file.length,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** options.txt is a mixed file: sync must never own it as `always`. */
export function assertOptionsNotSyncOwned(ownership: SyncOwnership): void {
  if (classifySettingsPath(OPTIONS_PATH, ownership) === 'required')
    throw new SettingsError(
      'options-owned-by-sync',
      'options.txt is deployed as an always-synchronized file; use settings-policy.json instead',
    );
}

export interface ManagedSettingsDescription {
  requiredKeys: string[];
  initialKeys: string[];
  requiredResourcePacks: string[];
  initialResourcePacks: string[];
  configFiles: { path: string; requiredKeys: string[]; initialKeys: string[] }[];
}

/** Per-key view of the mixed options.txt, for UI display of what the operator controls. */
export function describeManagedSettings(policy: SettingsPolicy): ManagedSettingsDescription {
  return {
    requiredKeys: policy.required.map(([key]) => key),
    initialKeys: policy.initial.map(([key]) => key),
    requiredResourcePacks: [...policy.resourcePacks.required],
    initialResourcePacks: [...policy.resourcePacks.initial],
    configFiles: policy.configFiles.map((file) => ({
      path: file.path,
      requiredKeys: file.required.map(([key]) => key),
      initialKeys: file.initial.map(([key]) => key),
    })),
  };
}

/**
 * Config files edited by a version 2 policy must not be `always`-synchronized: two writers would
 * fight over the same bytes. `initial-only` ownership is allowed (sync places the file once, the
 * policy then applies item by item).
 */
export function assertConfigFilesNotSyncOwned(
  policy: SettingsPolicy,
  ownership: SyncOwnership,
): void {
  for (const file of policy.configFiles)
    if (classifySettingsPath(file.path, ownership) === 'required')
      throw new SettingsError(
        'config-owned-by-sync',
        `${file.path} is deployed as an always-synchronized file; remove it from the files or from settings-policy.json`,
      );
}
