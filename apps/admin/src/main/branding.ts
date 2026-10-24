import { createHash } from 'node:crypto';
import {
  BRANDING_ROLES,
  type BrandingAssetMetadata,
  type BrandingMediaType,
  type BrandingRole,
  inspectBrandingImage,
  isBrandingAssetMetadata,
} from '../../../../packages/core/src/branding/index.js';
import { parseServerBranding } from '../../../../packages/core/src/server-config/index.js';
import type { StudioBranding, StudioProject } from '../shared/studio.js';
import { StudioFailure } from './project.js';

export type ImageDecoder = (bytes: Buffer) => { width: number; height: number };
export type BrandingSnapshots = Partial<Record<BrandingRole, Buffer>>;
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
      parseServerBranding({ appName: b.appName });
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
