export type LauncherTarget = 'windows' | 'linux';
export type ReleaseErrorCode =
  | 'LAUNCHER_UNCONFIGURED'
  | 'LAUNCHER_OFFLINE'
  | 'LAUNCHER_NO_RELEASE'
  | 'LAUNCHER_NO_ASSET'
  | 'LAUNCHER_RELEASE_FAILED'
  | 'LAUNCHER_VERIFY'
  | 'INVALID'
  | 'IO'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TARGET'
  | 'NO_UPDATE';
export class ReleaseFailure extends Error {
  constructor(readonly code: ReleaseErrorCode) {
    super(code);
  }
}
export interface ReleaseOptions {
  cacheDir: string;
  repository?: string;
  fetch?: typeof fetch;
}
export interface ReleaseMetadata {
  repository: string;
  target: LauncherTarget;
  version: string;
  name: string;
  size: number;
  sha256: string;
  url: string;
}
export interface ReleaseArtifact extends Omit<ReleaseMetadata, 'url'> {
  path: string;
  source: 'cache' | 'release';
}
/** Stable x.y.z only; optional v belongs to GitHub tags. No unsafe numeric components. */
export function parseStableVersion(value: unknown): readonly number[] | null {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  )
    return null;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
export function compareStableVersions(left: string, right: string): number {
  const a = parseStableVersion(left),
    b = parseStableVersion(right);
  if (!a || !b) throw new ReleaseFailure('LAUNCHER_VERIFY');
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
export function launcherTarget(platform: NodeJS.Platform, arch: string): LauncherTarget {
  if (arch !== 'x64' || (platform !== 'win32' && platform !== 'linux'))
    throw new ReleaseFailure('UNSUPPORTED_TARGET');
  return platform === 'win32' ? 'windows' : 'linux';
}
