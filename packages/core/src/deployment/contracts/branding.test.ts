import { describe, expect, it } from 'vitest';
import { createValidDeployment, SERVER_ID } from './fixtures/valid.js';
import {
  type DeploymentBrandingAsset,
  getDeploymentBrandingRange,
  validateDeploymentIndex,
} from './index.js';

function fixture() {
  const { header: legacyHeader, index: legacyIndex } = createValidDeployment();
  const offset = legacyHeader.totalLength - 64 - legacyHeader.indexLength;
  const icon: DeploymentBrandingAsset = {
    offset,
    sha256: 'a'.repeat(64),
    storedLength: 100,
    originalLength: 100,
    compression: 'none',
    mediaType: 'image/png',
  };
  const background: DeploymentBrandingAsset = {
    ...icon,
    offset: offset + 100,
    storedLength: 200,
    originalLength: 200,
    mediaType: 'image/jpeg',
  };
  const formatVersion = { major: 1, minor: 1 } as const;
  return {
    header: { ...legacyHeader, formatVersion, totalLength: legacyHeader.totalLength + 300 },
    index: { ...legacyIndex, formatVersion, branding: { icon, background } },
    legacyHeader,
    legacyIndex,
  };
}
const context = { expectedServerId: SERVER_ID };

describe('v1.1 isolated branding payload contracts', () => {
  it('covers game entries then icon/background with one continuous payload cursor', () => {
    const { header, index } = fixture();
    expect(validateDeploymentIndex(index, header, context)).toBe(index);
    expect(getDeploymentBrandingRange(header, 'background', index.branding.background)).toEqual({
      start: header.totalLength - 200,
      endInclusive: header.totalLength - 1,
    });
    expect(index.files.every((file) => !file.path.startsWith('branding/'))).toBe(true);
  });
  it('distinguishes legacy, omitted roles and explicit removal without payload', () => {
    const { legacyHeader, legacyIndex, header, index } = fixture();
    expect(validateDeploymentIndex(legacyIndex, legacyHeader, context).branding).toBeUndefined();
    for (const branding of [{}, { icon: null }, { icon: null, background: null }]) {
      const value = { ...index, branding };
      expect(
        validateDeploymentIndex(
          value,
          { ...header, totalLength: legacyHeader.totalLength },
          context,
        ),
      ).toBe(value);
    }
    expect(() =>
      validateDeploymentIndex({ ...legacyIndex, branding: {} }, legacyHeader, context),
    ).toThrow();
    expect(() => validateDeploymentIndex(index, legacyHeader, context)).toThrow();
    expect(() =>
      validateDeploymentIndex({ ...index, formatVersion: { major: 1, minor: 0 } }, header, context),
    ).toThrow();
    expect(() => validateDeploymentIndex(legacyIndex, header, context)).toThrow();
  });
  it.each([
    { offset: 0 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { offset: -1 },
    { offset: 1.1 },
    { storedLength: 99 },
    { originalLength: 0, storedLength: 0 },
    { storedLength: 1_048_577, originalLength: 1_048_577 },
    { sha256: 'A'.repeat(64) },
    { compression: 'gzip' },
    { mediaType: 'image/jpeg' },
    { mediaType: 'image/svg+xml' },
    { path: 'mods/collision.jar' },
    { policy: 'always' },
  ])('rejects invalid icon metadata, overlaps/gaps and namespace fields %j', (change) => {
    const { header, index } = fixture();
    expect(() =>
      validateDeploymentIndex(
        {
          ...index,
          branding: {
            ...index.branding,
            icon: { ...index.branding.icon, ...change },
          },
        },
        header,
        context,
      ),
    ).toThrow();
  });
  it('rejects background excess, trailing bytes, extra roles and non-object metadata', () => {
    const { header, index } = fixture();
    for (const branding of [
      null,
      [],
      { arbitrary: null },
      { icon: undefined },
      {
        icon: index.branding.icon,
        background: { ...index.branding.background, offset: index.branding.background.offset + 1 },
      },
      {
        icon: index.branding.icon,
        background: {
          ...index.branding.background,
          storedLength: 8_388_609,
          originalLength: 8_388_609,
        },
      },
    ])
      expect(() => validateDeploymentIndex({ ...index, branding }, header, context)).toThrow();
    expect(() =>
      validateDeploymentIndex(index, { ...header, totalLength: header.totalLength + 1 }, context),
    ).toThrow();
  });
});
