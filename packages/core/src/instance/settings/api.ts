import {
  atomicWrite,
  guarded,
  type ReadFile,
  readBounded,
  readState,
  resolveGamePath,
  withMaintenanceLock,
  writeState,
} from './io.js';
import { mergeRequiredPacks, OptionsDocument, readPackList, writePackList } from './options.js';
import { assertOptionsNotSyncOwned } from './ownership.js';
import { parseSettingsPolicy, validPackId } from './policy.js';
import {
  type OptionsFormatProfile,
  profileAcceptsKeyValue,
  profileAcceptsPackId,
  selectProfile,
} from './profiles.js';
import {
  type ApplySettingsResult,
  OPTIONS_PATH,
  type ResourcePackList,
  SETTINGS_LIMITS,
  SETTINGS_POLICY_PATH,
  SettingsError,
  type SettingsOperationOptions,
  type SettingsPolicy,
  type SyncOwnership,
} from './types.js';

export interface ApplySettingsOptions extends SettingsOperationOptions {
  /** Injected sync ledger view; enables the options-owned-by-sync and initialized checks. */
  ownership?: SyncOwnership;
}

async function loadPolicy(root: string, signal?: AbortSignal): Promise<SettingsPolicy | null> {
  const path = await resolveGamePath(root, SETTINGS_POLICY_PATH);
  const file = await readBounded(path, SETTINGS_LIMITS.policyBytes, signal);
  return file ? parseSettingsPolicy(file.bytes) : null;
}

async function loadOptions(
  root: string,
  signal?: AbortSignal,
): Promise<{ path: string; file: ReadFile | null; doc: OptionsDocument }> {
  const path = await resolveGamePath(root, OPTIONS_PATH);
  const file = await readBounded(path, SETTINGS_LIMITS.optionsBytes, signal);
  return { path, file, doc: file ? OptionsDocument.parse(file.bytes) : OptionsDocument.empty() };
}

function checkPolicyAgainstProfile(policy: SettingsPolicy, profile: OptionsFormatProfile): void {
  for (const [key, value] of [...policy.required, ...policy.initial]) {
    if (key === 'version')
      throw new SettingsError('invalid-policy', 'the version: line is owned by the game');
    if (!profileAcceptsKeyValue(profile, key, value))
      throw new SettingsError(
        'invalid-policy',
        `${key}: legacy numeric key code is not valid for ${profile.id}`,
      );
  }
  const ids = [...policy.resourcePacks.required, ...policy.resourcePacks.initial];
  if (ids.some((id) => !profileAcceptsPackId(profile, id)))
    throw new SettingsError('invalid-policy', 'malformed resource pack id');
}

/**
 * Apply the operator's settings policy to options.txt item by item under the maintenance lock.
 * Call after synchronization finished and before launching the game.
 */
export async function applySettingsPolicy(
  root: string,
  options: ApplySettingsOptions = {},
): Promise<ApplySettingsResult> {
  return withMaintenanceLock(root, async () => {
    const { signal, ownership } = options;
    if (ownership) {
      assertOptionsNotSyncOwned(ownership);
      if (!ownership.initialized)
        throw new SettingsError('sync-not-initialized', 'synchronization has not completed');
    }
    const policy = await loadPolicy(root, signal);
    const result: ApplySettingsResult = {
      status: 'no-policy',
      firstConfiguration: false,
      optionsCreated: false,
      optionsChanged: false,
      enforcedKeys: [],
      initialApplied: [],
      initialSkipped: [],
      resourcePacks: { added: [], reordered: false, active: [] },
      warnings: [],
    };
    if (!policy) return result;

    const { state, file: stateFile } = await readState(root, signal);
    const options_ = await loadOptions(root, signal);
    const { doc } = options_;
    const selection = selectProfile(doc, options.minecraftVersion, options.versionPolicy);
    const { profile } = selection;
    checkPolicyAgainstProfile(policy, profile);
    result.formatProfile = profile.id;
    result.warnings = selection.warnings;
    const first = state.initial === null;
    const doneKeys = new Set(state.initial?.keys ?? []);
    result.firstConfiguration = first;
    const processed: string[] = [...doneKeys];

    for (const [key, value] of policy.required) {
      if (doc.set(key, value)) result.enforcedKeys.push(key);
    }
    for (const [key, value] of policy.initial) {
      if (doneKeys.has(key)) continue;
      if (!first) {
        result.initialSkipped.push({ key, reason: 'already-configured' });
      } else if (doc.get(key) !== undefined) {
        result.initialSkipped.push({ key, reason: 'user-value-present' });
        processed.push(key);
      } else {
        doc.set(key, value);
        result.initialApplied.push(key);
        processed.push(key);
      }
    }

    const existing = readPackList(doc);
    if (existing?.some((id) => !profileAcceptsPackId(profile, id)))
      throw new SettingsError('invalid-options', 'malformed resource pack entry');
    let packs = existing ?? [...profile.defaultPacks];
    let resourcePacksDone = state.initial?.resourcePacks ?? false;
    if (policy.resourcePacks.initial.length > 0 && !resourcePacksDone) {
      if (first && existing === undefined) {
        packs = [...policy.resourcePacks.initial];
        result.initialApplied.push('resourcePacks');
        resourcePacksDone = true;
      } else {
        result.initialSkipped.push({
          key: 'resourcePacks',
          reason: first ? 'user-value-present' : 'already-configured',
        });
        resourcePacksDone = first;
      }
    }
    const merged = mergeRequiredPacks(packs, policy.resourcePacks.required);
    result.resourcePacks = {
      added: merged.added,
      reordered: merged.reordered,
      active: merged.packs,
    };
    const wantPacks =
      existing !== undefined
        ? JSON.stringify(merged.packs) !== JSON.stringify(existing)
        : merged.packs.length > 0 &&
          (merged.added.length > 0 || result.initialApplied.includes('resourcePacks'));
    if (wantPacks) writePackList(doc, merged.packs);

    const bytes = doc.serialize();
    const changed =
      options_.file === null
        ? bytes.byteLength > 0
        : Buffer.compare(Buffer.from(bytes), Buffer.from(options_.file.bytes)) !== 0;
    if (changed) {
      await atomicWrite(options_.path, bytes, options_.file?.stat, options);
      result.optionsCreated = options_.file === null;
      result.optionsChanged = true;
    }
    // Options first: a crash in between only skips initial keys (user data is never lost).
    if (
      first ||
      processed.length !== doneKeys.size ||
      resourcePacksDone !== (state.initial?.resourcePacks ?? false)
    )
      await writeState(
        root,
        { version: 1, initial: { keys: processed, resourcePacks: resourcePacksDone } },
        stateFile,
        options,
      );
    result.status = changed || first ? 'applied' : 'unchanged';
    return result;
  });
}

/** Current resource pack order with required packs flagged. Read-only; takes no lock. */
export async function getResourcePacks(
  root: string,
  options: SettingsOperationOptions = {},
): Promise<ResourcePackList> {
  return guarded(async () => {
    const policy = await loadPolicy(root, options.signal);
    const { doc } = await loadOptions(root, options.signal);
    const { profile } = selectProfile(doc, options.minecraftVersion, options.versionPolicy);
    const required = policy?.resourcePacks.required ?? [];
    const list = readPackList(doc) ?? [...profile.defaultPacks];
    const present = required.filter((id) => list.includes(id));
    const order = list.filter((id) => required.includes(id));
    return {
      packs: list.map((id) => ({ id, required: required.includes(id) })),
      missingRequired: required.filter((id) => !list.includes(id)),
      requiredOutOfOrder: present.some((id, index) => id !== order[index]),
    };
  });
}

/**
 * Replace the user's active pack list. The request must contain every required pack in operator
 * order; user packs may be added, removed and moved freely around them.
 */
export async function setUserResourcePacks(
  root: string,
  packs: readonly string[],
  options: SettingsOperationOptions = {},
): Promise<{ active: string[]; changed: boolean }> {
  if (
    !Array.isArray(packs) ||
    packs.length > SETTINGS_LIMITS.packsPerList ||
    packs.some((id) => !validPackId(id)) ||
    new Set(packs).size !== packs.length
  )
    throw new SettingsError('invalid-argument', 'invalid resource pack list');
  return withMaintenanceLock(root, async () => {
    const policy = await loadPolicy(root, options.signal);
    const required = policy?.resourcePacks.required ?? [];
    const missing = required.filter((id) => !packs.includes(id));
    if (missing.length > 0)
      throw new SettingsError('required-pack-removed', `required packs: ${missing.join(', ')}`);
    const order = packs.filter((id) => required.includes(id));
    if (order.some((id, index) => id !== required[index]))
      throw new SettingsError('required-pack-reordered', 'required packs must keep operator order');
    const loaded = await loadOptions(root, options.signal);
    const { profile } = selectProfile(loaded.doc, options.minecraftVersion, options.versionPolicy);
    if (packs.some((id) => !profileAcceptsPackId(profile, id)))
      throw new SettingsError('invalid-argument', 'malformed resource pack id');
    const changed = writePackList(loaded.doc, packs);
    if (changed) await atomicWrite(loaded.path, loaded.doc.serialize(), loaded.file?.stat, options);
    return { active: [...packs], changed };
  });
}
