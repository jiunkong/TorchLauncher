import type { DesktopApi } from '@torchlauncher/core/desktop';
import type {
  DeploymentFilePolicy,
  DeploymentGame,
} from '../../../../packages/core/src/deployment/contracts/index.js';
export const studioChannel = 'studio:request';
/** Main -> renderer event: the window is closing with unsaved changes; the renderer must answer with `closeConfirm` or `closeCancel`. */
export const studioCloseChannel = 'studio:close-request';
export const brandingDialogText = {
  icon: '앱 아이콘 선택',
  background: '홈 배경 선택',
  filter: '브랜딩 이미지',
} as const;
export interface ProjectFile {
  path: string;
  policy: DeploymentFilePolicy;
}
export interface StudioBranding {
  appName?: string;
  icon?: import('../../../../packages/core/src/branding/index.js').BrandingAssetMetadata | null;
  background?:
    | import('../../../../packages/core/src/branding/index.js').BrandingAssetMetadata
    | null;
}
export interface StudioProject {
  format: 'torchlauncher-project';
  /** The one current schema. Earlier development files are rejected, not migrated. */
  version: 1;
  serverId: string;
  name: string;
  address: string;
  sourceUrl: string;
  game: DeploymentGame;
  files: ProjectFile[];
  branding?: StudioBranding;
  /** Highest deployment sequence used by a build of this project (signing, torchpack 1.2). */
  sequence?: number;
  /** v2. Written by the main process after a build; the renderer cannot change it. */
  lastBuild?: StudioLastBuild;
  /** v2. Game settings preset (options.txt items, packs). Edited only through settings commands. */
  gameSettings?: StudioGameSettings;
}
/** What the last successful build of this project contained (basis of the file diff). */
export interface StudioLastBuild {
  deploymentId: string;
  builtAt: number;
  fileName: string;
  totalLength: number;
  sequence: number | null;
  game: DeploymentGame;
  /** sha256 of "<icon sha>|<background sha>|<appName>" at build time. */
  brandingKey: string;
  files: { path: string; sha256: string; length: number; policy: DeploymentFilePolicy }[];
}
export type SettingPolicyChoice = 'none' | 'initial' | 'required';
export type PackKind = 'resourcepack' | 'shaderpack';
export type SettingValueType = 'boolean' | 'number' | 'json' | 'text';
export interface StudioGameOption {
  key: string;
  value: string;
  policy: SettingPolicyChoice;
  /** From the import (core `classifyOptionKey`); absent for items created by hand. */
  kind?: 'keybind' | 'mod-keybind' | 'other';
  group?: string;
  valueType?: SettingValueType;
}
/** One `key=value` item of a mod config file or a shader pack options file. */
export interface StudioConfigItem {
  key: string;
  value: string;
  policy: SettingPolicyChoice;
  valueType?: SettingValueType;
}
/** A `.properties`/`.txt` mod config file below `config/` managed item by item. */
export interface StudioConfigFile {
  /** Game-relative path such as `config/sodium-extra.properties`. */
  path: string;
  items: StudioConfigItem[];
}
export const shaderConfigPaths = ['config/iris.properties', 'config/oculus.properties'] as const;
export interface StudioShaderSettings {
  /** Iris (Fabric) or Oculus (NeoForge) settings file. */
  configPath: (typeof shaderConfigPaths)[number];
  /** `enableShaders` */
  enabled: { policy: SettingPolicyChoice; value: boolean };
  /** `shaderPack`: file name inside `shaderpacks/`; empty string means "no pack". */
  pack: { policy: SettingPolicyChoice; value: string };
  /** Values of `shaderpacks/<pack>.txt`. */
  packOptions: { pack: string; items: StudioConfigItem[] }[];
}
export interface StudioPack {
  /** File name inside `resourcepacks/` or `shaderpacks/` of the source folder, e.g. `server.zip`. */
  name: string;
  sha256: string;
  length: number;
  /** none = not shipped; initial = initial-only file and default list; required = always file and forced. */
  policy: SettingPolicyChoice;
}
export interface StudioGameSettings {
  options: StudioGameOption[];
  /** Order is the operator's pack order (later = higher priority in Minecraft's list). */
  resourcePacks: StudioPack[];
  shaderPacks: StudioPack[];
  /** Mod config files (schema 2, optional). Needs a launcher that reads policy v2 when any item is set. */
  configFiles?: StudioConfigFile[];
  /** Shader selection and per-pack options (optional). Needs policy v2 when any item is set. */
  shader?: StudioShaderSettings;
}
export interface StudioSigning {
  encryptionAvailable: boolean;
  keyExists: boolean;
  /** Ed25519 public key (base64url). The private key never leaves the main process. */
  publicKey: string | null;
  lastSequence: number;
  /** Set by the last build or export: what happened to the key and the sequence. */
  lastOperation: { keyCreated: boolean; sequence: number | null } | null;
}
export type FilePolicyChoice = 'always' | 'initial-only' | 'excluded';
export type FileChange = 'added' | 'modified' | 'removed' | 'unchanged';
export interface StudioFileEntry {
  path: string;
  /** Bytes in the source folder; null when the file is not (or no longer) there. */
  size: number | null;
  /** `managed` = options.txt, resourcepacks/, shaderpacks/ and the generated policy (game settings). */
  policy: FilePolicyChoice | 'managed';
  /** Change versus the last build; null when the project has no last build. */
  change: FileChange | null;
  /** The project includes the file but the source folder no longer has it (a build would fail). */
  missing: boolean;
}
export interface StudioFileCounts {
  total: number;
  totalBytes: number;
  added: number;
  modified: number;
  removed: number;
  excluded: number;
  managed: number;
  missing: number;
}
export interface StudioFiles {
  scannedAt: number;
  entries: StudioFileEntry[];
  counts: StudioFileCounts;
  /** More than the file limit exist in the source folder; the extra ones are not listed. */
  truncated: boolean;
  /** Entries skipped because they are links or special files. */
  skipped: number;
}
export type StudioDeployReason = 'files' | 'game' | 'branding' | 'settings';
export interface StudioDeploy {
  /** none = never built; unknown = built before but no source folder is selected to compare; */
  status: 'none' | 'unknown' | 'changed' | 'upToDate';
  reasons: StudioDeployReason[];
  lastBuild: {
    fileName: string;
    builtAt: number;
    fileCount: number;
    totalLength: number;
    sequence: number | null;
  } | null;
  /** Added/modified/removed against the last build (same numbers as `files.counts`). */
  changes: { added: number; modified: number; removed: number };
}
export type UrlCheckState = 'ok' | 'mismatch' | 'failed' | 'unknown';
export interface StudioUrlCheck {
  checkedAt: number;
  url: string;
  serverId: UrlCheckState;
  game: UrlCheckState;
  /** Game environment the remote pack declares (null when it could not be read). */
  remoteGame: DeploymentGame | null;
  fileList: { state: UrlCheckState; count: number | null };
  range: UrlCheckState;
  /** current = same deployment as the last build; older = a different one; unknown = no last build or unreadable. */
  deployment: 'current' | 'older' | 'unknown';
  /** True when project fields the check depends on changed after the check ran. */
  stale: boolean;
}
export type ExportBlockReason =
  | 'server-id'
  | 'game'
  | 'url-unchecked'
  | 'url-failed'
  | 'range'
  | 'no-deployment'
  | 'deployment-outdated'
  | 'deployment-changed';
export interface StudioExportCheck {
  id: 'serverId' | 'game' | 'url' | 'deployment';
  ok: boolean;
  reasons: ExportBlockReason[];
}
export interface StudioExport {
  checks: StudioExportCheck[];
  blocked: boolean;
  /** Set after a successful export. */
  done: { fileName: string; size: number } | null;
}
export interface StudioPresetPreview {
  source: 'folder' | 'file' | 'test';
  optionCount: number;
  /** Lines/keys that were ignored (invalid key, too long value, duplicates, owned by the game). */
  ignored: number;
  /** Informational: files found next to options.txt that the preset cannot manage yet. */
  detected: { modConfigs: string[]; resourcePacks: string[]; shaderPacks: string[] };
  /** Config files parsed as candidates. Read-only test previews do not import them. */
  importedConfigs: string[];
  /** Config files found but not importable (unsupported format, unsafe, too large). */
  skippedConfigs: {
    path: string;
    reason: 'unsupported' | 'invalid-config' | 'limit-exceeded' | 'unsafe-path';
  }[];
  /** Iris/Oculus file read for shader selection, and the `shaderpacks/*.txt` option files read. */
  shader: { configPath: string | null; packOptionFiles: string[] } | null;
}
/** Result of building `torchlauncher/settings-policy.json` from the current preset. */
export interface StudioPolicyStatus {
  /** Number of config files the policy edits (0 when only options.txt items); `generated` is false when no policy is produced. */
  configFiles: number;
  generated: boolean;
  bytes: number;
  /** The launcher's policy size limit. */
  limit: number;
  /** Why the policy cannot be built (or why the last settings command was rejected); null when fine. */
  error: { code: string; message: string } | null;
}
/** Renderer-safe structural DTOs; do not import Node implementation modules into this contract. */
export interface StudioCompatibilityReport {
  status: 'problems' | 'no-problems-found' | 'incomplete';
  truncated: boolean;
  items: {
    severity: 'error' | 'warning' | 'info';
    category:
      | 'loader-resolution'
      | 'mixin'
      | 'class-loading'
      | 'out-of-memory'
      | 'java-version'
      | 'crash'
      | 'unclassified';
    modIds?: string[];
    files?: string[];
    summary: { code: string; parameters: Record<string, string | number> };
    evidence: { source: 'log' | 'crash-report'; line: number; text: string }[];
  }[];
}
export interface StudioModInfo {
  loader: 'fabric' | 'neoforge';
  file?: string;
  mods: {
    id: string;
    version: string;
    environment?: '*' | 'client' | 'server';
    dependencies: { id: string; version: string | string[]; type?: string; side?: string }[];
  }[];
}
export interface StudioAccount {
  signedIn: boolean;
  name: string | null;
  available: boolean;
  error: string | null;
}
/** Read-only last-test preview. Counts never imply that settings have been imported. */
export interface StudioTestExtracted extends StudioPresetPreview {
  keybindCount: number;
  otherOptionCount: number;
  /** Newly detected generic configs, including formats the item editor cannot import. */
  newConfigCount: number;
}
export interface StudioTestRun {
  phase:
    | 'idle'
    | 'preparing'
    | 'installing'
    | 'syncing'
    | 'running'
    | 'analyzing'
    | 'done'
    | 'failed';
  serverId: string | null;
  exit: {
    reason: 'exited' | 'stopped' | 'cancelled' | 'process-error' | 'lock-error';
    code: number | null;
    signal: string | null;
  } | null;
  progress: {
    component:
      | 'metadata'
      | 'game'
      | 'java'
      | 'library'
      | 'asset'
      | 'logging'
      | 'loader'
      | 'files'
      | 'settings';
    completed: number;
    total: number | null;
  } | null;
  logs: { stream: 'stdout' | 'stderr'; text: string }[];
  truncated: boolean;
  report: StudioCompatibilityReport | null;
  mods: StudioModInfo[];
  metadataErrors: { file: string; code: string }[];
  extracted: StudioTestExtracted | null;
  /** Read-only instance config candidates, separate from project.gameSettings. */
  configFiles: StudioConfigFile[] | null;
  configPreview: StudioPresetPreview | null;
  configError: string | null;
  extractionError: string | null;
  error: string | null;
}
export type StudioTestCommand =
  | { action: 'testLogin' | 'testLogout' | 'testStart' | 'testStop' }
  | { action: 'testReset'; confirmed: true };
export interface StudioState {
  account: StudioAccount;
  testRun: StudioTestRun;
  project: StudioProject | null;
  projectName: string | null;
  sourceName: string | null;
  dirty: boolean;
  busy: 'saving' | 'opening' | 'choosing' | 'building' | 'checking' | 'exporting' | null;
  progress: number;
  result: string | null;
  signing: StudioSigning | null;
  /** Source folder listing and diff; null until a source folder is selected and scanned. */
  files: StudioFiles | null;
  deploy: StudioDeploy | null;
  urlCheck: StudioUrlCheck | null;
  export: StudioExport | null;
  /** Result of the last preset import (informational). */
  preset: StudioPresetPreview | null;
  policy: StudioPolicyStatus | null;
}
export type StudioCommand =
  | {
      action:
        | 'state'
        | 'touch'
        | 'save'
        | 'saveAs'
        | 'source'
        | 'files'
        | 'build'
        | 'check'
        | 'export'
        | 'cancel';
    }
  | {
      action: 'new' | 'open';
      /** Must be true when the current project has unsaved changes, sent only after the renderer's own confirmation. */
      discard?: boolean;
    }
  | { action: 'update'; project: StudioProject };
/** Source folder, deploy and export commands added by STUDIO-MAIN-01. */
export type StudioWorkCommand =
  | {
      action: /** Re-read the source folder and recompute `files` and `deploy`. */
        | 'rescan'
        /** Re-evaluate `export.checks` (rescans the source folder; no network, nothing written). */
        | 'exportCheck'
        /** Show the last built pack in the OS file manager. */
        | 'revealPack'
        /** Show the last exported ZIP in the OS file manager. */
        | 'revealExport'
        /** Answer to a close request: discard unsaved changes and close the window. Only valid after `onCloseRequest` fired. */
        | 'closeConfirm'
        /** Answer to a close request: keep the window open. */
        | 'closeCancel';
    }
  | {
      action: 'filesPolicy';
      /** Source-relative, slash-separated paths (max 1000); each must exist in the source folder. */
      paths: string[];
      policy: FilePolicyChoice;
    };
export type StudioSettingsCommand =
  | { action: 'settingsImport'; source: 'folder' | 'file' }
  | { action: 'settingsImportOptions'; source: 'test' | 'file' }
  | { action: 'settingsTestConfigs' }
  | {
      action: 'settingsOptions';
      /** Max 512 changes. `value` (optional) overrides the imported value. */
      changes: { key: string; policy: SettingPolicyChoice; value?: string }[];
    }
  | {
      action: 'settingsConfigItems';
      /** `config/**.properties|txt` (not iris/oculus). Creates the file entry; unknown keys are created and need `value`. */
      path: string;
      changes: { key: string; policy: SettingPolicyChoice; value?: string }[];
    }
  | { action: 'settingsConfigRemove'; path: string }
  | {
      action: 'settingsShader';
      /** At least one field. */
      configPath?: (typeof shaderConfigPaths)[number];
      enabled?: { policy: SettingPolicyChoice; value: boolean };
      pack?: { policy: SettingPolicyChoice; value: string };
    }
  | {
      action: 'settingsShaderOptions';
      /** Pack file name; the options file is `shaderpacks/<pack>.txt`. Unknown keys are created and need `value`. */
      pack: string;
      changes: { key: string; policy: SettingPolicyChoice; value?: string }[];
    }
  | { action: 'settingsShaderOptionsRemove'; pack: string }
  | { action: 'settingsPackAdd'; kind: PackKind }
  | { action: 'settingsPackPolicy'; kind: PackKind; name: string; policy: SettingPolicyChoice }
  | { action: 'settingsPackMove'; kind: PackKind; name: string; index: number }
  | { action: 'settingsPackRemove'; kind: PackKind; name: string };
export type StudioBrandingCommand =
  | { action: 'brandingSelect' | 'brandingRemove'; role: 'icon' | 'background' }
  | { action: 'brandingName'; appName: string | null };
export type StudioSigningCommand =
  | { action: 'keyStatus' | 'keyCreate' }
  | { action: 'keyExport'; passphrase: string }
  | { action: 'keyImport'; passphrase: string; replace: boolean };
export type StudioRequest =
  | StudioCommand
  | StudioWorkCommand
  | StudioBrandingCommand
  | StudioSigningCommand
  | StudioSettingsCommand
  | StudioTestCommand;
export type StudioError =
  | 'INVALID'
  | 'BUSY'
  | 'CANCELLED'
  | 'IO'
  | 'MISMATCH'
  | 'NO_PROJECT'
  | 'UNTRUSTED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'KEY_EXISTS'
  | 'KEY_MISSING'
  | 'KEY_CORRUPT'
  | 'KEY_MISMATCH'
  | 'WEAK_PASSPHRASE'
  | 'BACKUP_INVALID'
  | 'BACKUP_UNSUPPORTED'
  | 'BACKUP_AUTH'
  /** Unsaved changes would be lost: ask in the app, then repeat with `discard: true`. */
  | 'UNSAVED'
  /** Export refused: read `state.export.checks`. */
  | 'BLOCKED'
  /** A chosen file or pack is larger than the limit. */
  | 'TOO_LARGE';
export type StudioTestSettingsError = 'NO_TEST_RESULT' | 'TEST_OPTIONS_MISSING';
export type StudioReply =
  | { ok: true; state: StudioState }
  | { ok: false; code: StudioError; detail?: { code: StudioTestSettingsError } };
export interface StudioApi extends DesktopApi {
  request(command: StudioRequest): Promise<StudioReply>;
  /** Subscribes to window-close requests while the project has unsaved changes. Returns an unsubscribe function. */
  onCloseRequest(listener: () => void): () => void;
}
