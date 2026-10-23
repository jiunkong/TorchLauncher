/**
 * Adapter between the Studio renderer and everything the mockups show that the current Studio API
 * cannot provide yet: the last deployment, a diff against it, per-check address results and the
 * export outcome. Today it derives what it can from the operations of this renderer session
 * (`StudioRun`) and the draft project; whatever cannot be known is `null`/`unknown` and the pages
 * render it as unavailable instead of inventing a value.
 *
 * STUDIO-UI-02 replaces `useInsights` with the real main-process data (file sizes, persisted last
 * deployment, per-check results, export file); the shape of `Insights` is the page contract.
 */
import { useEffect, useRef, useState } from 'react';
import type { StudioProject } from '../../../shared/studio.js';
import type { StudioController } from '../hooks/useStudio';

export type FileChange = 'added' | 'modified';
export type CheckId = 'serverId' | 'game' | 'files' | 'range';
export type CheckStatus = 'ok' | 'bad' | 'pending';
export interface DeployCheck {
  id: CheckId;
  status: CheckStatus;
}
export type DeployState = 'unknown' | 'current' | 'stale';
export type AddressState = 'unchecked' | 'ok' | 'bad' | 'stale';

export interface Insights {
  deploy: {
    state: DeployState;
    builtAt: Date | null;
    /** Files of the last deployment built in this session. */
    fileCount: number | null;
    /** Not available from the current API. */
    bytes: number | null;
    changes: { added: number; modified: number; excluded: number };
  };
  fileChanges: ReadonlyMap<string, FileChange>;
  address: { state: AddressState; checkedAt: Date | null; checks: DeployCheck[] };
  exported: { at: Date } | null;
}

interface Baseline {
  at: Date;
  files: StudioProject['files'];
  signature: string;
}
interface CheckRecord {
  at: Date;
  ok: boolean;
  signature: string;
}

const checkIds: CheckId[] = ['serverId', 'game', 'files', 'range'];

/** What a deployment file contains; the public address and the name are not part of it. */
export function deploySignature(project: StudioProject): string {
  return JSON.stringify({
    serverId: project.serverId,
    game: project.game,
    branding: project.branding ?? null,
    files: [...project.files].sort((a, b) => a.path.localeCompare(b.path)),
  });
}
/** What the address check compares: the project identity and game against the public file. */
export function checkSignature(project: StudioProject): string {
  return JSON.stringify({ serverId: project.serverId, game: project.game, url: project.sourceUrl });
}

export function computeInsights(
  project: StudioProject | null,
  baseline: Baseline | null,
  check: CheckRecord | null,
  exported: Date | null,
): Insights {
  const changes = { added: 0, modified: 0, excluded: 0 };
  const fileChanges = new Map<string, FileChange>();
  if (project && baseline) {
    const before = new Map(baseline.files.map((file) => [file.path, file.policy]));
    for (const file of project.files) {
      const previous = before.get(file.path);
      if (previous === undefined) {
        fileChanges.set(file.path, 'added');
        changes.added += 1;
      } else if (previous !== file.policy) {
        fileChanges.set(file.path, 'modified');
        changes.modified += 1;
      }
    }
    const now = new Set(project.files.map((file) => file.path));
    changes.excluded = baseline.files.filter((file) => !now.has(file.path)).length;
  }
  let deployState: DeployState = 'unknown';
  if (project && baseline)
    deployState = deploySignature(project) === baseline.signature ? 'current' : 'stale';

  let addressState: AddressState = 'unchecked';
  if (project && check) {
    if (!check.ok) addressState = 'bad';
    else addressState = checkSignature(project) === check.signature ? 'ok' : 'stale';
  }
  // The API reports one pass/fail for a whole check; items other than the identity pair are
  // only known to pass when the whole check passed.
  const checks: DeployCheck[] = checkIds.map((id) => ({
    id,
    status:
      addressState === 'ok'
        ? 'ok'
        : addressState === 'bad' && (id === 'serverId' || id === 'game')
          ? 'bad'
          : 'pending',
  }));
  return {
    deploy: {
      state: deployState,
      builtAt: baseline?.at ?? null,
      fileCount: baseline?.files.length ?? null,
      bytes: null,
      changes,
    },
    fileChanges,
    address: { state: addressState, checkedAt: check?.at ?? null, checks },
    exported: exported ? { at: exported } : null,
  };
}

/** Records the outcome of build/check/export runs of this session against the draft project. */
export function useInsights(studio: StudioController): Insights {
  const { draft, lastRun } = studio;
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [check, setCheck] = useState<CheckRecord | null>(null);
  const [exported, setExported] = useState<Date | null>(null);
  const handled = useRef(0);
  const serverId = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    if (serverId.current !== null && serverId.current !== draft.serverId) {
      // A different project was opened: nothing recorded belongs to it.
      setBaseline(null);
      setCheck(null);
      setExported(null);
    }
    serverId.current = draft.serverId;
  }, [draft]);

  useEffect(() => {
    if (!lastRun || !draft || lastRun.seq === handled.current) return;
    handled.current = lastRun.seq;
    const at = new Date();
    if (lastRun.action === 'build' && lastRun.ok)
      setBaseline({ at, files: draft.files, signature: deploySignature(draft) });
    else if (lastRun.action === 'check' && (lastRun.ok || lastRun.code === 'MISMATCH'))
      setCheck({ at, ok: lastRun.ok, signature: checkSignature(draft) });
    else if (lastRun.action === 'export' && lastRun.ok) setExported(at);
  }, [lastRun, draft]);
  return computeInsights(draft, baseline, check, exported);
}
