// Private Node child. No stdout/stderr or provider error strings may cross the IPC boundary.
import { AuthenticationError, type AuthStage } from '@torchlauncher/core/auth';
import { runPublicJavaFlow } from './public-java-flow';
import { type CacheName, publicJavaTitle, record, snapshot } from './public-java-protocol';

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) console[method] = () => {};
process.env.DEBUG = '';
process.on('disconnect', () => process.exit(1));
const callbacks = new Map<number, { resolve(): void; reject(error: Error): void }>();
let nextId = 0;
let started = false;
let stage: AuthStage = 'oauth';

function send(value: unknown) {
  if (!process.connected || !process.send) throw new AuthenticationError('cancelled', 'browser');
  process.send(value);
}

function writeCache(name: CacheName, value: Record<string, unknown>) {
  const id = ++nextId;
  const pending = new Promise<void>((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
    send({ type: 'cache', id, name, value });
  });
  // Upstream LiveTokenManager does not await every cache update. The explicit barrier below does.
  void pending.catch(() => {});
  return pending;
}

async function run(message: Record<string, unknown>) {
  const initial = snapshot(message.snapshot);
  if (message.mode !== 'login' && message.mode !== 'refresh')
    throw new AuthenticationError('invalid_configuration', 'configuration');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    stage =
      url.hostname === 'api.minecraftservices.com'
        ? url.pathname.startsWith('/entitlements/')
          ? 'entitlements'
          : url.pathname === '/minecraft/profile'
            ? 'profile'
            : 'minecraft'
        : url.hostname === 'xsts.auth.xboxlive.com' || url.hostname === 'sisu.xboxlive.com'
          ? 'xsts'
          : url.hostname.endsWith('.xboxlive.com')
            ? 'xbox'
            : 'oauth';
    const response = await originalFetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 256 * 1024) throw new AuthenticationError('invalid_response', stage);
          chunks.push(part.value);
        }
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  const { Authflow, Titles } = await import('prismarine-auth');
  const result = await runPublicJavaFlow({
    initial,
    mode: message.mode,
    createFlow: (cacheFactory, onCode) =>
      new Authflow(
        'torchlauncher-public-java',
        cacheFactory,
        {
          flow: 'sisu',
          authTitle: Titles.MinecraftJava,
          deviceType: 'Win32',
          deviceVersion: '10.0.19041.0',
        },
        onCode,
      ),
    onCode: (code, expiresIn) => send({ type: 'device', code, expiresIn }),
    persist: writeCache,
    request: globalThis.fetch,
  });
  send({ type: 'result', value: result });
}

async function selfCheck() {
  // Constructor only: no network and no token/cache data. Verifies the actual bundled dependency.
  const { Authflow, Titles } = await import('prismarine-auth');
  const { default: metadata } = await import('prismarine-auth/package.json');
  const initialized = new Set<string>();
  new Authflow(
    'self-check',
    ({ cacheName }) => {
      initialized.add(cacheName);
      return {
        async getCached() {
          return {};
        },
        async reset() {},
        async setCached() {},
        async setCachedPartial() {},
      };
    },
    { flow: 'sisu', authTitle: Titles.MinecraftJava, deviceType: 'Win32' },
  );
  if (
    metadata.version !== '3.1.1' ||
    Titles.MinecraftJava !== publicJavaTitle ||
    !initialized.has('sisu') ||
    !initialized.has('xbl')
  )
    throw new Error();
  send({ type: 'self-check', ok: true, libraryVersion: metadata.version });
}

process.on('message', (raw) => {
  let message: Record<string, unknown>;
  try {
    message = record(raw);
  } catch {
    process.exit(1);
  }
  if (message.type === 'ack' && typeof message.id === 'number') {
    const callback = callbacks.get(message.id);
    callbacks.delete(message.id);
    if (message.ok === true) callback?.resolve();
    else callback?.reject(new AuthenticationError('storage_failed', 'storage'));
  } else if (message.type === 'self-check' && !started) {
    started = true;
    void selfCheck().catch(() => send({ type: 'self-check', ok: false }));
  } else if (message.type === 'start' && !started) {
    started = true;
    void run(message).catch((error: unknown) => {
      const safe =
        error instanceof AuthenticationError
          ? error
          : new AuthenticationError('network_failed', stage);
      send({ type: 'failure', code: safe.code, stage: safe.stage, status: safe.status });
    });
  }
});
