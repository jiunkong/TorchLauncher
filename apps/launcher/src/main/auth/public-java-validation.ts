import { randomUUID } from 'node:crypto';
import { AuthenticationError } from '@torchlauncher/core/auth';
import { authResult, record } from './public-java-protocol';

/** Fresh online checks; prismarine-auth's optional fetch helpers swallow service errors. */
export async function verifyJavaAccount(token: string, expiresAt: number, request = fetch) {
  if (
    typeof token !== 'string' ||
    !token ||
    token.length > 65_536 ||
    /\s/.test(token) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 172_800_000
  )
    throw new AuthenticationError('invalid_response', 'minecraft');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const licenseResponse = await request(
    `https://api.minecraftservices.com/entitlements/license?requestId=${randomUUID()}`,
    { headers },
  );
  if (!licenseResponse.ok)
    throw new AuthenticationError('http_failed', 'entitlements', licenseResponse.status);
  const license = record(await licenseResponse.json(), 'entitlements');
  if (!Array.isArray(license.items))
    throw new AuthenticationError('invalid_response', 'entitlements');
  if (
    !license.items.some((item: unknown) => {
      const name = record(item, 'entitlements').name;
      return name === 'game_minecraft' || name === 'product_minecraft';
    })
  )
    throw new AuthenticationError('game_not_owned', 'entitlements');
  const profileResponse = await request('https://api.minecraftservices.com/minecraft/profile', {
    headers,
  });
  if (profileResponse.status === 404)
    throw new AuthenticationError('profile_required', 'profile', 404);
  if (!profileResponse.ok)
    throw new AuthenticationError('http_failed', 'profile', profileResponse.status);
  return authResult({ accessToken: token, expiresAt, profile: await profileResponse.json() });
}
