import { createHash } from 'node:crypto';
import type { DeploymentFilePolicy } from '../../../../packages/core/src/deployment/contracts/index.js';
import type {
  FileChange,
  StudioDeploy,
  StudioDeployReason,
  StudioFileEntry,
  StudioFiles,
  StudioLastBuild,
  StudioProject,
} from '../shared/studio.js';
import {
  type GeneratedPolicy,
  generatePolicy,
  isPlanReserved,
  isReservedPath,
  PACK_DIRECTORY,
  PolicyFailure,
  policyConfigPaths,
  SETTINGS_POLICY_PATH,
} from './game-settings.js';
import type { ScanResult } from './scan.js';

/** One file the next build will contain. */
export interface PlanItem {
  path: string;
  policy: DeploymentFilePolicy;
  kind: 'disk' | 'pack' | 'generated';
  /** Known up front for packs and the generated policy; read from disk for `disk`. */
  length: number | null;
  sha256: string | null;
}
export interface BuildPlan {
  items: PlanItem[];
  /** Content of the generated settings policy (written to the source folder before the build). */
  policyText: string | null;
  policy: GeneratedPolicy | null;
  /** Why the policy cannot be built; a build must refuse to run. */
  policyError: PolicyFailure | null;
  /** Paths whose items the policy manages. */
  policyPaths: string[];
}
export function buildPlan(project: StudioProject): BuildPlan {
  const settings = project.gameSettings;
  const managed: PlanItem[] = [];
  let policy: GeneratedPolicy | null = null;
  let policyError: PolicyFailure | null = null;
  const policyPaths = settings ? policyConfigPaths(settings) : [];
  if (settings) {
    for (const [kind, list] of [
      ['resourcepack', settings.resourcePacks],
      ['shaderpack', settings.shaderPacks],
      ['mod', settings.mods ?? []],
    ] as const)
      for (const pack of list) {
        // Mods are always applied whatever a saved project says.
        const choice = kind === 'mod' ? 'required' : pack.policy;
        if (choice === 'none') continue;
        managed.push({
          path: `${PACK_DIRECTORY[kind]}/${pack.name}`,
          policy: choice === 'required' ? 'always' : 'initial-only',
          kind: 'pack',
          length: pack.length,
          sha256: pack.sha256,
        });
      }
    try {
      policy = generatePolicy(settings, project.game.minecraftVersion);
    } catch (error) {
      if (!(error instanceof PolicyFailure)) throw error;
      policyError = error;
    }
    if (policy) {
      const bytes = Buffer.from(policy.text);
      managed.push({
        path: SETTINGS_POLICY_PATH,
        policy: 'always',
        kind: 'generated',
        length: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  const taken = new Set(managed.map((i) => i.path));
  // Game settings own options.txt, the generated policy, packs and imported mods; plain entries
  // for the same paths are not built twice. Other plain files under resourcepacks/ keep working.
  const plain: PlanItem[] = project.files
    .filter((f) => !taken.has(f.path) && !(settings && isPlanReserved(f.path)))
    .map((f) => ({
      path: f.path,
      policy: f.policy,
      kind: 'disk' as const,
      length: null,
      sha256: null,
    }));
  // A plain `always` file that the policy also edits would be overwritten by every sync.
  const conflict = plain.find((f) => f.policy === 'always' && policyPaths.includes(f.path));
  if (conflict && !policyError)
    policyError = new PolicyFailure(
      'config-owned-by-sync',
      `${conflict.path} is deployed as "always" and also managed by the settings policy`,
    );
  return {
    items: [...plain, ...managed],
    policyText: policy?.text ?? null,
    policy,
    policyError,
    policyPaths,
  };
}
export function brandingKey(project: StudioProject): string {
  const part = (role: 'icon' | 'background') => {
    const a = project.branding?.[role];
    return a === undefined ? '-' : a === null ? 'null' : a.sha256;
  };
  return createHash('sha256')
    .update(`${part('icon')}|${part('background')}`)
    .digest('hex');
}
export interface DiffResult {
  files: StudioFiles;
  /** Distinguishes managed (settings/pack) changes from ordinary file changes. */
  managedChanged: boolean;
  plainChanged: boolean;
}
/**
 * Compares the build plan and the scanned source folder with the last build.
 * `hash` returns the sha256 of a source file (null when unreadable); it is only called when the
 * size already matches the last build, so unchanged-size files are the only ones read.
 */
export async function computeFiles(
  project: StudioProject,
  scan: ScanResult,
  hash: (path: string, size: number) => Promise<string | null>,
  now = Date.now(),
): Promise<DiffResult> {
  const plan = buildPlan(project);
  const last = new Map((project.lastBuild?.files ?? []).map((f) => [f.path, f]));
  const planned = new Map(plan.items.map((i) => [i.path, i]));
  const entries: StudioFileEntry[] = [];
  const present = new Set<string>();
  let managedChanged = false;
  let plainChanged = false;
  const changeOf = async (
    path: string,
    item: PlanItem | undefined,
    size: number | null,
  ): Promise<FileChange | null> => {
    if (!project.lastBuild) return null;
    const before = last.get(path);
    if (!item) return before ? 'removed' : 'unchanged';
    if (!before) return 'added';
    if (before.policy !== item.policy) return 'modified';
    const length = item.length ?? size;
    if (length === null || before.length !== length) return 'modified';
    const sha = item.sha256 ?? (size === null ? null : await hash(path, size));
    return sha === before.sha256 ? 'unchanged' : 'modified';
  };
  const note = (change: FileChange | null, managed: boolean) => {
    if (change && change !== 'unchanged') {
      if (managed) managedChanged = true;
      else plainChanged = true;
    }
  };
  for (const file of scan.files) {
    present.add(file.path);
    const item = planned.get(file.path);
    const managed = isReservedPath(file.path) || plan.policyPaths.includes(file.path);
    const change = await changeOf(file.path, item, file.size);
    note(change, managed);
    entries.push({
      path: file.path,
      size: file.size,
      policy: managed ? 'managed' : item ? item.policy : 'excluded',
      change,
      missing: false,
    });
  }
  for (const item of plan.items) {
    if (present.has(item.path)) continue;
    present.add(item.path);
    const generated = item.kind === 'generated';
    // Not on disk yet: the generated policy is written at build time, which is fine; other items are missing.
    const missing = !generated;
    const change = await changeOf(item.path, item, generated ? item.length : null);
    note(change, item.kind !== 'disk');
    entries.push({
      path: item.path,
      size: generated ? item.length : null,
      policy: item.kind === 'disk' ? item.policy : 'managed',
      change,
      missing,
    });
  }
  for (const before of last.values()) {
    if (present.has(before.path)) continue;
    const managed = isReservedPath(before.path);
    note('removed', managed);
    entries.push({
      path: before.path,
      size: null,
      policy: managed ? 'managed' : 'excluded',
      change: 'removed',
      missing: false,
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const count = (change: FileChange) => entries.filter((e) => e.change === change).length;
  return {
    files: {
      scannedAt: now,
      entries,
      counts: {
        total: entries.filter((e) => e.size !== null && !e.missing).length,
        totalBytes: entries.reduce((sum, e) => sum + (e.missing ? 0 : (e.size ?? 0)), 0),
        added: count('added'),
        modified: count('modified'),
        removed: count('removed'),
        excluded: entries.filter((e) => e.policy === 'excluded' && e.size !== null).length,
        managed: entries.filter((e) => e.policy === 'managed').length,
        missing: entries.filter((e) => e.missing).length,
      },
      truncated: scan.truncated,
      skipped: scan.skipped,
    },
    managedChanged,
    plainChanged,
  };
}
export function computeDeploy(
  project: StudioProject,
  diff: DiffResult | null,
  files: StudioFiles | null,
): StudioDeploy {
  const last: StudioLastBuild | undefined = project.lastBuild;
  const changes = {
    added: files?.counts.added ?? 0,
    modified: files?.counts.modified ?? 0,
    removed: files?.counts.removed ?? 0,
  };
  if (!last) return { status: 'none', reasons: [], lastBuild: null, changes };
  const reasons: StudioDeployReason[] = [];
  if (diff?.plainChanged) reasons.push('files');
  if (diff?.managedChanged) reasons.push('settings');
  if (
    last.game.minecraftVersion !== project.game.minecraftVersion ||
    last.game.loader.kind !== project.game.loader.kind ||
    last.game.loader.version !== project.game.loader.version
  )
    reasons.push('game');
  if (last.brandingKey !== brandingKey(project)) reasons.push('branding');
  return {
    status: reasons.length ? 'changed' : diff ? 'upToDate' : 'unknown',
    reasons,
    lastBuild: {
      fileName: last.fileName,
      builtAt: last.builtAt,
      fileCount: last.files.length,
      totalLength: last.totalLength,
      sequence: last.sequence,
    },
    changes,
  };
}
