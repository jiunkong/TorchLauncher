/**
 * Read model of the main-process status (file diff, deploy status, address check, export checks)
 * for the pages. Everything comes from `StudioState`; this module only supplies defaults and
 * the counters the sidebar and overview need.
 */
import type {
  StudioDeploy,
  StudioExport,
  StudioFiles,
  StudioState,
  StudioUrlCheck,
} from '../../../shared/studio.js';

export interface Insights {
  deploy: StudioDeploy;
  files: StudioFiles | null;
  urlCheck: StudioUrlCheck | null;
  export: StudioExport | null;
  /** Added + modified + removed files since the last build. */
  changed: number;
  /** The last address check ran and still applies to the project. */
  addressState: 'unchecked' | 'ok' | 'bad' | 'stale';
}

const noDeploy: StudioDeploy = {
  status: 'none',
  reasons: [],
  lastBuild: null,
  changes: { added: 0, modified: 0, removed: 0 },
};

export function addressState(check: StudioUrlCheck | null): Insights['addressState'] {
  if (!check) return 'unchecked';
  if (check.stale) return 'stale';
  const ok =
    check.serverId === 'ok' &&
    check.game === 'ok' &&
    check.fileList.state === 'ok' &&
    check.range === 'ok';
  return ok ? 'ok' : 'bad';
}

export function deriveInsights(state: StudioState | null): Insights {
  const deploy = state?.deploy ?? noDeploy;
  return {
    deploy,
    files: state?.files ?? null,
    urlCheck: state?.urlCheck ?? null,
    export: state?.export ?? null,
    changed: deploy.changes.added + deploy.changes.modified + deploy.changes.removed,
    addressState: addressState(state?.urlCheck ?? null),
  };
}
