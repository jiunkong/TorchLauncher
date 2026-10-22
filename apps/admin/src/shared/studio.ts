import type { DesktopApi } from '@torchlauncher/core/desktop';
import type {
  DeploymentFilePolicy,
  DeploymentGame,
} from '../../../../packages/core/src/deployment/contracts/index.js';
export const studioChannel = 'studio:request';
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
export interface StudioState {
  project: StudioProject | null;
  projectName: string | null;
  sourceName: string | null;
  dirty: boolean;
  busy: 'saving' | 'opening' | 'choosing' | 'building' | 'checking' | 'exporting' | null;
  progress: number;
  result: string | null;
  signing: StudioSigning | null;
}
export type StudioCommand =
  | {
      action:
        | 'state'
        | 'touch'
        | 'new'
        | 'open'
        | 'save'
        | 'saveAs'
        | 'source'
        | 'files'
        | 'build'
        | 'check'
        | 'export'
        | 'cancel';
    }
  | { action: 'update'; project: StudioProject };
export type StudioBrandingCommand =
  | { action: 'brandingSelect' | 'brandingRemove'; role: 'icon' | 'background' }
  | { action: 'brandingName'; appName: string | null };
export type StudioSigningCommand =
  | { action: 'keyStatus' | 'keyCreate' }
  | { action: 'keyExport'; passphrase: string }
  | { action: 'keyImport'; passphrase: string; replace: boolean };
export type StudioRequest = StudioCommand | StudioBrandingCommand | StudioSigningCommand;
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
  | 'BACKUP_AUTH';
export type StudioReply = { ok: true; state: StudioState } | { ok: false; code: StudioError };
export interface StudioApi extends DesktopApi {
  request(command: StudioRequest): Promise<StudioReply>;
}
