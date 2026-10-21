export type SettingsErrorCode =
  | 'aborted'
  | 'file-changed'
  | 'invalid-argument'
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
  stateBytes: 64 * 1024,
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

export interface SettingsPolicy {
  readonly version: 1;
  readonly file: 'options.txt';
  /** Ordered key/value pairs enforced on every application. */
  readonly required: readonly (readonly [string, string])[];
  /** Ordered key/value pairs written once during first configuration. */
  readonly initial: readonly (readonly [string, string])[];
  readonly resourcePacks: {
    readonly required: readonly string[];
    readonly initial: readonly string[];
  };
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
  /** Test seam: runs after the temporary file is written and before it replaces the target. */
  onBeforeCommit?: (target: string) => void | Promise<void>;
}

export interface InitialSkip {
  key: string;
  /** `already-configured`: first configuration finished earlier. `user-value-present`: the key already existed. */
  reason: 'already-configured' | 'user-value-present';
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
