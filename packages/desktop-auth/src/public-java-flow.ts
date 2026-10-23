import { AuthenticationError } from '@torchlauncher/core/auth';
import {
  type CacheName,
  cacheName,
  type JavaCacheSnapshot,
  record,
  snapshot,
} from './public-java-protocol';
import { verifyJavaAccount } from './public-java-validation';

interface Cache {
  getCached(): Promise<Record<string, unknown>>;
  reset(): Promise<void>;
  setCached(value: unknown): Promise<void>;
  setCachedPartial(value: unknown): Promise<void>;
}
export type JavaFlowFactory = (
  factory: (options: { cacheName: string; username: string }) => Cache,
  onCode: (value: { user_code: string; expires_in: number }) => void,
) => { getMinecraftJavaToken(): Promise<{ token: string }> };

export async function runPublicJavaFlow(options: {
  initial: JavaCacheSnapshot;
  mode: 'login' | 'refresh';
  createFlow: JavaFlowFactory;
  persist(name: CacheName, value: Record<string, unknown>): Promise<void>;
  onCode(code: string, expiresIn: number): void;
  request: typeof fetch;
}) {
  const caches = snapshot(options.initial).caches;
  caches.xbl = {};
  caches.mca = {};
  const writes: Promise<void>[] = [];
  const save = (name: CacheName, value: Record<string, unknown>) => {
    const pending = options.persist(name, structuredClone(value));
    void pending.catch(() => {});
    writes.push(pending);
  };
  const flow = options.createFlow(
    ({ cacheName: name }) => {
      const key = cacheName(name);
      let cached = caches[key] ?? {};
      return {
        async getCached() {
          return cached;
        },
        async reset() {
          cached = {};
          caches[key] = cached;
          save(key, cached);
        },
        async setCached(value) {
          cached = record(value);
          caches[key] = cached;
          save(key, cached);
        },
        async setCachedPartial(value) {
          cached = { ...cached, ...record(value) };
          caches[key] = cached;
          save(key, cached);
        },
      };
    },
    (code) => {
      if (options.mode === 'refresh')
        throw new AuthenticationError('reauthentication_required', 'oauth');
      options.onCode(code.user_code, code.expires_in);
    },
  );
  const result = await flow.getMinecraftJavaToken();
  const data = record(record(caches.mca).mca);
  if (
    typeof data.obtainedOn !== 'number' ||
    typeof data.expires_in !== 'number' ||
    !Number.isSafeInteger(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new AuthenticationError('invalid_response', 'minecraft');
  const verified = await verifyJavaAccount(
    result.token,
    data.obtainedOn + data.expires_in * 1000,
    options.request,
  );
  // Upstream calls some cache methods without awaiting them: drain the captured promises explicitly.
  let count = 0;
  do {
    count = writes.length;
    await Promise.all(writes);
  } while (writes.length !== count);
  return verified;
}
