import type { MicrosoftTokenStorage, StoredMicrosoftSession } from '@torchlauncher/core/auth';
import { EncryptedAuthStore, type EncryptedAuthStoreOptions } from './encrypted-store';
import { HostAuthenticationError } from './errors';

export type { SafeStorageBoundary } from './encrypted-store';
export type EncryptedTokenStorageOptions = EncryptedAuthStoreOptions;

function session(value: unknown): StoredMicrosoftSession {
  if (typeof value !== 'object' || value === null)
    throw new HostAuthenticationError('storage_failed');
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    typeof data.refreshToken !== 'string' ||
    !data.refreshToken ||
    data.refreshToken.length > 65_536 ||
    /\s/.test(data.refreshToken)
  ) {
    throw new HostAuthenticationError('storage_failed');
  }
  return { version: 1, refreshToken: data.refreshToken };
}

export class EncryptedMicrosoftTokenStorage
  extends EncryptedAuthStore<StoredMicrosoftSession>
  implements MicrosoftTokenStorage
{
  constructor(options: EncryptedTokenStorageOptions) {
    super(
      options,
      session,
      /^torchlauncher\.microsoft\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
    );
  }
}
