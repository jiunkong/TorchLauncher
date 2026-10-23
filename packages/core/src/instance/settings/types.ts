export type SettingsErrorCode =
  | 'aborted'
  | 'file-changed'
  | 'config-owned-by-sync'
  | 'invalid-argument'
  | 'invalid-config'
  | 'invalid-options'
  | 'invalid-policy'
  | 'invalid-state'
  | 'io-error'
  | 'limit-exceeded'
  | 'locked'
  | 'options-owned-by-sync'
  | 'required-pack-removed'
  | 'required-pack-reordered'
  | 'sync-not-initialized'
  | 'unsupported-options-version'
  | 'unsafe-path';

export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'SettingsError';
  }
}

export const SETTINGS_LIMITS = {
  policyBytes: 64 * 1024,
  optionsBytes: 1024 * 1024,
  stateBytes: 256 * 1024,
  configBytes: 1024 * 1024,
  configFiles: 32,
  configPathLength: 256,
  configPathSegments: 5,
  configSegmentLength: 128,
  stateFiles: 64,
  keysPerMap: 512,
  keyLength: 128,
  valueLength: 2048,
  packsPerList: 256,
  packIdLength: 256,
  jsonDepth: 8,
} as const;

export const SETTINGS_POLICY_PATH = 'torchlauncher/settings-policy.json';
export const SETTINGS_STATE_PATH = '.torchlauncher-user/settings.json';
export const OPTIONS_PATH = 'options.txt';

/**
 * Per-file key/value policy for a plain `key=value` file under `config/` or `shaderpacks/`
 * (policy version 2). Shader settings are expressed with these (Iris `config/iris.properties`,
 * per-pack `shaderpacks/<pack>.txt`).
 */
export interface ConfigFilePolicy {
  /** Game-directory-relative path with `/` separators. */
  readonly path: string;
  readonly required: readonly (readonly [string, string])[];
  readonly initial: readonly (readonly [string, string])[];
}

export interface SettingsPolicy {
  /** 1: options.txt only. 2: adds `configFiles` (version 1 launchers reject it instead of ignoring it). */
  readonly version: 1 | 2;
  readonly file: 'options.txt';
  /** Ordered key/value pairs enforced on every application. */
  readonly required: readonly (readonly [string, string])[];
  /** Ordered key/value pairs written once during first configuration. */
  readonly initial: readonly (readonly [string, string])[];
  readonly resourcePacks: {
    readonly required: readonly string[];
    readonly initial: readonly string[];
  };
  /** Always empty for version 1. */
  readonly configFiles: readonly ConfigFilePolicy[];
}

/** Injected view of the synchronization ledger (USER-01 provides the real reader). */
export interface SyncOwnership {
  serverId: string;
  deploymentId: string;
  initialized: boolean;
  files: readonly {
    path: string;
    policy: 'always' | 'initial-only';
    sha256: string;
    length: number;
  }[];
}

export type SettingsPathClass = 'required' | 'initial-default' | 'user';

export interface SettingsOperationOptions {
  signal?: AbortSignal;
  /** Minecraft version used to pick the options.txt format when the file has no `version:` line. */
  minecraftVersion?: string;
  /** Which format profiles may be used. Default `verified-only` (rejects everything else). */
  versionPolicy?: 'verified-only' | 'allow-researched' | 'allow-any';
  /** Test seam: runs after the temporary file is written and before it replaces the target. */
  onBeforeCommit?: (target: string) => void | Promise<void>;
}

export interface InitialSkip {
  key: string;
  /** `already-configured`: first configuration finished earlier. `user-value-present`: the key already existed. */
  reason: 'already-configured' | 'user-value-present';
}

export interface ConfigFileResult {
  path: string;
  created: boolean;
  changed: boolean;
  enforcedKeys: string[];
  initialApplied: string[];
  initialSkipped: InitialSkip[];
}

export interface ApplySettingsResult {
  status: 'no-policy' | 'applied' | 'unchanged';
  firstConfiguration: boolean;
  optionsCreated: boolean;
  optionsChanged: boolean;
  /** Required keys whose value had to be corrected or added. */
  enforcedKeys: string[];
  initialApplied: string[];
  initialSkipped: InitialSkip[];
  resourcePacks: { added: string[]; reordered: boolean; active: string[] };
  /** One entry per policy `configFiles` item, in path order. */
  configFiles: ConfigFileResult[];
  /** Format profile id used (absent for `no-policy`). */
  formatProfile?: string;
  warnings: string[];
}

export interface ResourcePackStatus {
  id: string;
  required: boolean;
}
export interface ResourcePackList {
  packs: ResourcePackStatus[];
  /** Required packs absent from options.txt (restored by the next apply). */
  missingRequired: string[];
  /** True when required packs are present but out of operator order. */
  requiredOutOfOrder: boolean;
}
