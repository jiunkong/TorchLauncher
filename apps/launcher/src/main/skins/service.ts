const MAX_BYTES = 64 * 1024;
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 32;
const TIMEOUT_MS = 8_000;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PlayerSkinService {
  get(profileId: string, signal?: AbortSignal): Promise<string | null>;
  clear(): void;
}

export interface SkinDependencies {
  fetch: typeof fetch;
  canonicalize(png: Buffer): Buffer | null;
  now?: () => number;
}

/** Check dimensions before invoking the native decoder. Only ordinary Java skin sizes are accepted. */
export function skinDimensions(png: Buffer): { width: number; height: number } | null {
  if (
    png.length < 33 ||
    png.length > MAX_BYTES ||
    !png.subarray(0, 8).equals(PNG_MAGIC) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return width === 64 && (height === 32 || height === 64) ? { width, height } : null;
}

function uuid(value: string): string | null {
  if (!/^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(value))
    return null;
  return value.replaceAll('-', '').toLowerCase();
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textureUrl(profile: unknown, id: string): string | null {
  const record = object(profile);
  if (
    !record ||
    record.id !== id ||
    !Array.isArray(record.properties) ||
    record.properties.length > 16
  )
    return null;
  const textures = record.properties.filter((item: unknown) => object(item)?.name === 'textures');
  if (textures.length !== 1) return null;
  const value = object(textures[0])?.value;
  if (
    typeof value !== 'string' ||
    value.length > MAX_BYTES ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z\d+/]+={0,2}$/.test(value)
  )
    return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return null;
  const data = object(JSON.parse(decoded.toString('utf8')));
  if (data?.profileId !== id) return null;
  const skin = object(object(data.textures)?.SKIN);
  if (typeof skin?.url !== 'string') return null;
  // Validate the original spelling too: URL parsing must not normalize credentials, escapes or paths.
  const match = /^https?:\/\/textures\.minecraft\.net\/texture\/([a-f\d]{64})$/.exec(skin.url);
  return match ? `https://textures.minecraft.net/texture/${match[1]}` : null;
}

async function bytes(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetcher(url, {
    signal,
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.body) throw new Error('body');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    if (
      signal.aborted ||
      !response.ok ||
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== url)
    )
      throw new Error('response');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      throw new Error('size');
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error('size');
      chunks.push(Buffer.from(next.value));
    }
    // Native fetch decompresses the body but preserves the compressed Content-Length header.
    if ((!encoding || encoding === 'identity') && length !== null && size !== Number(length))
      throw new Error('truncated');
    return Buffer.concat(chunks, size);
  } finally {
    // Cancellation is best effort; do not let a broken transport delay fallback.
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function withAbort<T>(work: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      resolve(fallback);
    };
    signal.addEventListener('abort', abort, { once: true });
    void work.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, abort);
  });
}

export function createSkinService(dependencies: SkinDependencies): PlayerSkinService {
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, { value: string; expires: number }>();
  const pending = new Map<
    string,
    { controller: AbortController; result: Promise<string | null> }
  >();
  let generation = 0;

  async function load(id: string, signal: AbortSignal): Promise<string | null> {
    try {
      const profile = await bytes(
        dependencies.fetch,
        `https://sessionserver.mojang.com/session/minecraft/profile/${id}`,
        signal,
      );
      const url = textureUrl(JSON.parse(profile.toString('utf8')), id);
      if (!url || signal.aborted) return null;
      const png = await bytes(dependencies.fetch, url, signal);
      const dimensions = skinDimensions(png);
      if (!dimensions || signal.aborted) return null;
      const canonical = dependencies.canonicalize(png);
      const output = canonical && skinDimensions(canonical);
      if (!canonical || !output || output.height !== dimensions.height || signal.aborted)
        return null;
      return `data:image/png;base64,${canonical.toString('base64')}`;
    } catch {
      return null;
    }
  }

  return {
    get(profileId, signal) {
      const id = uuid(profileId);
      if (!id || signal?.aborted) return Promise.resolve(null);
      for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
      const cached = cache.get(id);
      if (cached) return Promise.resolve(cached.value);
      let entry = pending.get(id);
      if (!entry) {
        if (pending.size >= MAX_ENTRIES) return Promise.resolve(null);
        const controller = new AbortController();
        const startedGeneration = generation;
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const result = withAbort(load(id, controller.signal), controller.signal, null)
          .then((value) => {
            clearTimeout(timer);
            if (generation !== startedGeneration || controller.signal.aborted) return null;
            pending.delete(id);
            if (value) {
              if (cache.size >= MAX_ENTRIES) {
                const oldest = cache.keys().next().value;
                if (oldest) cache.delete(oldest);
              }
              cache.set(id, { value, expires: now() + TTL_MS });
            }
            return value;
          })
          .finally(() => {
            // Never delete a replacement request created after clear().
            if (pending.get(id)?.controller === controller) pending.delete(id);
          });
        entry = { controller, result };
        pending.set(id, entry);
      }
      return signal ? withAbort(entry.result, signal, null) : entry.result;
    },
    clear() {
      generation++;
      cache.clear();
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
    },
  };
}
