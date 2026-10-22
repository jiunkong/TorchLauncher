import { createHash } from 'node:crypto';
import {
  BRANDING_LIMITS,
  BRANDING_ROLES,
  type BrandingAssetMetadata,
  type BrandingMediaType,
  type BrandingRole,
  inspectBrandingImage,
  isBrandingAssetMetadata,
} from '../../../../packages/core/src/branding/index.js';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index.js';
import type { StudioBranding, StudioProject } from '../shared/studio.js';
import { StudioFailure } from './project.js';

export type ImageDecoder = (bytes: Buffer) => { width: number; height: number };
export type BrandingSnapshots = Partial<Record<BrandingRole, Buffer>>;
export const PROJECT_READ_LIMIT = 20 * 1024 ** 2;
export function validateImage(
  role: BrandingRole,
  bytes: Buffer,
  decode: ImageDecoder,
  expected?: BrandingAssetMetadata,
): BrandingAssetMetadata {
  try {
    const mediaType: BrandingMediaType = bytes[0] === 137 ? 'image/png' : 'image/jpeg';
    const dimensions = inspectBrandingImage(role, mediaType, bytes);
    const metadata = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      length: bytes.length,
      mediaType,
    };
    if (
      expected &&
      (expected.sha256 !== metadata.sha256 ||
        expected.length !== metadata.length ||
        expected.mediaType !== mediaType)
    )
      throw new Error();
    const actual = decode(bytes);
    if (actual.width !== dimensions.width || actual.height !== dimensions.height) throw new Error();
    return metadata;
  } catch {
    throw new StudioFailure('INVALID');
  }
}
export function parseBranding(input: unknown): StudioBranding {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new StudioFailure('INVALID');
  const b = input as Record<string, unknown>;
  if (Object.keys(b).some((k) => !['appName', ...BRANDING_ROLES].includes(k)))
    throw new StudioFailure('INVALID');
  if (Object.hasOwn(b, 'appName')) {
    try {
      parseServerConfig({
        format: 'torchlauncher-server',
        version: 1,
        serverId: '11111111-1111-4111-8111-111111111111',
        name: 'Server',
        address: 'localhost:25565',
        sourceUrl: 'https://example.org/pack',
        branding: { appName: b.appName },
      });
    } catch {
      throw new StudioFailure('INVALID');
    }
  }
  for (const role of BRANDING_ROLES) {
    const asset = b[role];
    if (asset === undefined && Object.hasOwn(b, role)) throw new StudioFailure('INVALID');
    if (asset !== undefined && asset !== null) {
      if (
        typeof asset !== 'object' ||
        Array.isArray(asset) ||
        Object.keys(asset).sort().join(',') !== 'length,mediaType,sha256' ||
        !isBrandingAssetMetadata(role, asset as BrandingAssetMetadata)
      )
        throw new StudioFailure('INVALID');
    }
  }
  return structuredClone(input) as StudioBranding;
}
export function encodeProject(project: StudioProject, snapshots: BrandingSnapshots): string {
  const stored = structuredClone(project);
  const branding = stored.branding as Record<string, unknown> | undefined;
  for (const role of BRANDING_ROLES) {
    const asset = project.branding?.[role];
    if (asset) {
      const bytes = snapshots[role];
      if (!bytes || !branding) throw new StudioFailure('INVALID');
      branding[role] = { ...asset, base64: bytes.toString('base64') };
    }
  }
  return `${JSON.stringify(stored, null, 2)}\n`;
}
export function decodeProject(
  input: unknown,
  decode: ImageDecoder,
): { input: unknown; snapshots: BrandingSnapshots } {
  const stored = structuredClone(input) as StudioProject;
  const snapshots: BrandingSnapshots = {};
  if (
    stored &&
    typeof stored === 'object' &&
    stored.branding &&
    typeof stored.branding === 'object'
  ) {
    const branding = stored.branding as Record<string, unknown>;
    for (const role of BRANDING_ROLES) {
      const asset = branding[role];
      if (asset && typeof asset === 'object' && !Array.isArray(asset)) {
        const { base64, ...metadata } = asset as Record<string, unknown>;
        if (
          typeof base64 !== 'string' ||
          base64.length > Math.ceil(BRANDING_LIMITS[role].length / 3) * 4
        )
          throw new StudioFailure('INVALID');
        const bytes = Buffer.from(base64, 'base64');
        if (bytes.toString('base64') !== base64) throw new StudioFailure('INVALID');
        validateImage(role, bytes, decode, metadata as unknown as BrandingAssetMetadata);
        branding[role] = metadata;
        snapshots[role] = bytes;
      }
    }
  }
  return { input: stored, snapshots };
}
export function writerBranding(
  project: StudioProject,
  snapshots: BrandingSnapshots,
):
  | import('../../../../packages/core/src/deployment/writer/types.js').DeploymentBrandingInputs
  | undefined {
  const branding = project.branding;
  if (!branding || !BRANDING_ROLES.some((role) => Object.hasOwn(branding, role))) return undefined;
  const result: {
    icon?: { bytes: Buffer; mediaType: BrandingMediaType } | null;
    background?: { bytes: Buffer; mediaType: BrandingMediaType } | null;
  } = {};
  for (const role of BRANDING_ROLES) {
    const asset = branding[role];
    if (asset === undefined) continue;
    if (asset === null) {
      result[role] = null;
      continue;
    }
    const bytes = snapshots[role];
    if (!bytes) throw new StudioFailure('INVALID');
    result[role] = { bytes: Buffer.from(bytes), mediaType: asset.mediaType };
  }
  return result;
}
export function profileBranding(project: StudioProject) {
  if (!project.branding) return undefined;
  return {
    ...(project.branding.appName ? { appName: project.branding.appName } : {}),
    ...Object.fromEntries(
      BRANDING_ROLES.flatMap((role) => {
        const asset = project.branding?.[role];
        return asset
          ? [
              [
                role,
                {
                  ...asset,
                  path: `branding/${role}.${asset.mediaType === 'image/png' ? 'png' : 'jpg'}`,
                },
              ],
            ]
          : [];
      }),
    ),
  };
}
