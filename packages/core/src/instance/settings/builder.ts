import { parseSettingsPolicy } from './policy.js';
import { checkPolicyAgainstProfile, FALLBACK_PROFILE, OPTIONS_PROFILES } from './profiles.js';
import { SettingsError, type SettingsPolicy } from './types.js';

/** The three states Studio offers per item. */
export type SettingState = 'unset' | 'initial' | 'required';

export interface SettingChoice {
  key: string;
  state: SettingState;
  /** Ignored for `unset`. */
  value: string;
}

export interface ConfigFileChoices {
  /** Game-directory-relative path, e.g. `config/iris.properties` or `shaderpacks/Pack.zip.txt`. */
  path: string;
  items: readonly SettingChoice[];
}

/** Everything Studio's 게임 설정 collects. */
export interface PolicySelection {
  /** options.txt items (not `resourcePacks`/`version`). */
  options?: readonly SettingChoice[];
  resourcePacks?: { required?: readonly string[]; initial?: readonly string[] };
  configFiles?: readonly ConfigFileChoices[];
  /** Minecraft version used to pick the options.txt format profile for validation (default 1.21.1). */
  minecraftVersion?: string;
}

export interface BuiltSettingsPolicy {
  policy: SettingsPolicy;
  /** Deterministic JSON text (2-space indent, trailing newline) of the policy. */
  json: string;
  /** UTF-8 bytes of `json`, ready to deploy as `torchlauncher/settings-policy.json`. */
  bytes: Uint8Array;
}

function invalid(message: string): never {
  throw new SettingsError('invalid-policy', message);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function split(items: readonly SettingChoice[] | undefined, name: string) {
  const required: [string, string][] = [];
  const initial: [string, string][] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    if (item.state !== 'unset' && item.state !== 'initial' && item.state !== 'required')
      invalid(`${name}: unknown state for ${String(item.key)}`);
    if (seen.has(item.key)) invalid(`${name}: duplicate key ${item.key}`);
    seen.add(item.key);
    if (item.state === 'required') required.push([item.key, item.value]);
    else if (item.state === 'initial') initial.push([item.key, item.value]);
  }
  required.sort((a, b) => cmp(a[0], b[0]));
  initial.sort((a, b) => cmp(a[0], b[0]));
  return { required, initial };
}

/**
 * Serialize a policy deterministically: sorted keys and config files, empty sections omitted,
 * The output is re-parsed with the launcher's
 * strict parser, so anything returned is accepted by `applySettingsPolicy`. Resource pack lists
 * keep their order (it is meaningful).
 */
export function serializeSettingsPolicy(policy: SettingsPolicy): BuiltSettingsPolicy {
  const map = (pairs: readonly (readonly [string, string])[]) =>
    Object.fromEntries([...pairs].sort((a, b) => cmp(a[0], b[0])));
  const out: Record<string, unknown> = {
    version: 1,
    file: 'options.txt',
  };
  if (policy.required.length > 0) out.required = map(policy.required);
  if (policy.initial.length > 0) out.initial = map(policy.initial);
  const rp: Record<string, unknown> = {};
  if (policy.resourcePacks.required.length > 0) rp.required = [...policy.resourcePacks.required];
  if (policy.resourcePacks.initial.length > 0) rp.initial = [...policy.resourcePacks.initial];
  if (Object.keys(rp).length > 0) out.resourcePacks = rp;
  if (policy.configFiles.length > 0) {
    out.configFiles = Object.fromEntries(
      [...policy.configFiles]
        .sort((a, b) => cmp(a.path, b.path))
        .map((file) => {
          const entry: Record<string, unknown> = {};
          if (file.required.length > 0) entry.required = map(file.required);
          if (file.initial.length > 0) entry.initial = map(file.initial);
          return [file.path, entry];
        }),
    );
  }
  const json = `${JSON.stringify(out, null, 2)}\n`;
  const bytes = new TextEncoder().encode(json);
  const parsed = parseSettingsPolicy(bytes);
  return { policy: parsed, json, bytes };
}

/**
 * Turn Studio's per-item selections (unset / initial / required) into a validated policy and its
 * deterministic JSON. Throws `SettingsError` (`invalid-policy` / `limit-exceeded`) for anything
 * `applySettingsPolicy` would reject: bad keys or values, key conflicts, traversal in config paths,
 * `resourcePacks` or `version` as plain options, numeric key codes on named-keycode profiles, etc.
 * Config file entries without any required/initial item are dropped.
 */
export function buildSettingsPolicy(selection: PolicySelection): BuiltSettingsPolicy {
  const options = split(selection.options, 'options');
  const files = (selection.configFiles ?? []).map((file) => ({
    path: file.path,
    ...split(file.items, `configFiles[${file.path}]`),
  }));
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) invalid(`duplicate config file: ${file.path}`);
    paths.add(file.path);
  }
  const draft: SettingsPolicy = {
    version: 1,
    file: 'options.txt',
    required: options.required,
    initial: options.initial,
    resourcePacks: {
      required: [...(selection.resourcePacks?.required ?? [])],
      initial: [...(selection.resourcePacks?.initial ?? [])],
    },
    configFiles: files.filter((f) => f.required.length + f.initial.length > 0),
  };
  const built = serializeSettingsPolicy(draft);
  const profile =
    selection.minecraftVersion === undefined
      ? FALLBACK_PROFILE
      : OPTIONS_PROFILES.find((p) =>
          p.minecraftVersions.includes(selection.minecraftVersion ?? ''),
        );
  if (!profile) throw new SettingsError('unsupported-options-version', 'unknown Minecraft version');
  checkPolicyAgainstProfile(built.policy, profile);
  return built;
}

/** Inverse of `buildSettingsPolicy`: reopen a saved policy as Studio selections. */
export function selectionFromPolicy(policy: SettingsPolicy): Required<
  Pick<PolicySelection, 'options' | 'configFiles'>
> & {
  resourcePacks: { required: string[]; initial: string[] };
} {
  const choices = (
    required: readonly (readonly [string, string])[],
    initial: readonly (readonly [string, string])[],
  ): SettingChoice[] => [
    ...required.map(([key, value]) => ({ key, value, state: 'required' as const })),
    ...initial.map(([key, value]) => ({ key, value, state: 'initial' as const })),
  ];
  return {
    options: choices(policy.required, policy.initial),
    resourcePacks: {
      required: [...policy.resourcePacks.required],
      initial: [...policy.resourcePacks.initial],
    },
    configFiles: policy.configFiles.map((file) => ({
      path: file.path,
      items: choices(file.required, file.initial),
    })),
  };
}

/** Iris stores its settings here; Oculus (the NeoForge port) uses `config/oculus.properties`. */
export const IRIS_CONFIG_PATH = 'config/iris.properties';
export const OCULUS_CONFIG_PATH = 'config/oculus.properties';

export interface ShaderSelection {
  /** Loader specific file; default `IRIS_CONFIG_PATH`. */
  configPath?: string;
  /** `enableShaders` flag. */
  enabled?: { state: SettingState; value: boolean };
  /** `shaderPack` (file name inside `shaderpacks/`, e.g. `BSL_v8.zip`). */
  pack?: { state: SettingState; value: string };
  /** Per-pack option values stored in `shaderpacks/<pack>.txt`. */
  packOptions?: readonly { pack: string; items: readonly SettingChoice[] }[];
}

export function shaderPackOptionsPath(pack: string): string {
  return `shaderpacks/${pack}.txt`;
}

/** Map shader choices onto generic config file choices for `PolicySelection.configFiles`. */
export function shaderSelectionToConfigFiles(selection: ShaderSelection): ConfigFileChoices[] {
  const out: ConfigFileChoices[] = [];
  const items: SettingChoice[] = [];
  if (selection.enabled)
    items.push({
      key: 'enableShaders',
      state: selection.enabled.state,
      value: selection.enabled.value ? 'true' : 'false',
    });
  if (selection.pack)
    items.push({ key: 'shaderPack', state: selection.pack.state, value: selection.pack.value });
  if (items.length > 0) out.push({ path: selection.configPath ?? IRIS_CONFIG_PATH, items });
  for (const pack of selection.packOptions ?? [])
    out.push({ path: shaderPackOptionsPath(pack.pack), items: pack.items });
  return out;
}
