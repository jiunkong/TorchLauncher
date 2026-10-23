import {
  AuthenticationError,
  type AuthStage,
  type MinecraftAuthResult,
} from '@torchlauncher/core/auth';

export const publicJavaTitle = '00000000402b5328';
export const cacheNames = ['msal', 'live', 'sisu', 'xbl', 'bed', 'mca', 'mcs', 'pfb'] as const;
export type CacheName = (typeof cacheNames)[number];
export interface JavaCacheSnapshot {
  version: 1;
  caches: Partial<Record<CacheName, Record<string, unknown>>>;
}

export function record(value: unknown, stage: AuthStage = 'storage'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AuthenticationError('invalid_response', stage);
  return value as Record<string, unknown>;
}

export function cacheName(value: unknown): CacheName {
  if (typeof value !== 'string' || !cacheNames.includes(value as CacheName))
    throw new AuthenticationError('invalid_response', 'storage');
  return value as CacheName;
}

export function snapshot(value: unknown): JavaCacheSnapshot {
  const data = record(value);
  if (data.version !== 1 || Buffer.byteLength(JSON.stringify(value)) > 128 * 1024)
    throw new AuthenticationError('invalid_response', 'storage');
  const caches = Object.fromEntries(
    Object.entries(record(data.caches)).map(([name, entry]) => [cacheName(name), record(entry)]),
  );
  return structuredClone({ version: 1, caches });
}

export function authResult(value: unknown, now = Date.now()): MinecraftAuthResult {
  const data = record(value, 'minecraft');
  const profile = record(data.profile, 'profile');
  if (
    typeof data.accessToken !== 'string' ||
    !data.accessToken ||
    data.accessToken.length > 65_536 ||
    /\s/.test(data.accessToken) ||
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt <= now ||
    data.expiresAt > now + 172_800_000 ||
    typeof profile.id !== 'string' ||
    !/^[0-9a-f]{32}$/i.test(profile.id) ||
    typeof profile.name !== 'string' ||
    !/^[A-Za-z0-9_]{1,16}$/.test(profile.name)
  )
    throw new AuthenticationError('invalid_response', 'minecraft');
  return {
    accessToken: data.accessToken,
    expiresAt: data.expiresAt,
    profile: { id: profile.id.toLowerCase(), name: profile.name },
    clientId: publicJavaTitle,
    userType: 'msa',
  };
}
