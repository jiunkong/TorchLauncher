import type { DesktopApi } from '@torchlauncher/core/desktop';
import type {
  DeploymentFilePolicy,
  DeploymentGame,
} from '../../../../packages/core/src/deployment/contracts/index.js';
export const studioChannel = 'studio:request';
export interface ProjectFile {
  path: string;
  policy: DeploymentFilePolicy;
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
}
export interface StudioState {
  project: StudioProject | null;
  projectName: string | null;
  sourceName: string | null;
  dirty: boolean;
  busy: 'saving' | 'opening' | 'choosing' | 'building' | 'checking' | 'exporting' | null;
  progress: number;
  result: string | null;
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
export type StudioError =
  | 'INVALID'
  | 'BUSY'
  | 'CANCELLED'
  | 'IO'
  | 'MISMATCH'
  | 'NO_PROJECT'
  | 'UNTRUSTED';
export type StudioReply = { ok: true; state: StudioState } | { ok: false; code: StudioError };
export interface StudioApi extends DesktopApi {
  request(command: StudioCommand): Promise<StudioReply>;
}
