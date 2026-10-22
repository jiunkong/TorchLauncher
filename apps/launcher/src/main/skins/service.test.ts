import { describe, expect, it, vi } from 'vitest';
import { createSkinService, skinDimensions } from './service';

const ID = '069a79f444e94726a5befca90e38aaf5';
const URL = `http://textures.minecraft.net/texture/${'a'.repeat(64)}`;
function png(height = 64) {
  const bytes = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(64, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function profile(url = URL, id = ID) {
  return {
    id,
    properties: [
      {
        name: 'textures',
        value: Buffer.from(JSON.stringify({ profileId: id, textures: { SKIN: { url } } })).toString(
          'base64',
        ),
      },
    ],
  };
}
function harness(
  options: {
    profile?: unknown;
    image?: Buffer;
    decode?: (bytes: Buffer) => Buffer | null;
    now?: () => number;
  } = {},
) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).startsWith('https://sessionserver.mojang.com/'))
      return Response.json(Object.hasOwn(options, 'profile') ? options.profile : profile());
    return new Response(new Uint8Array(options.image ?? png()));
  });
  const decode = vi.fn(options.decode ?? ((bytes: Buffer) => bytes));
  const service = createSkinService({
    fetch: fetcher,
    canonicalize: decode,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, fetcher, decode };
}

describe('bounded public player skin service', () => {
  it.each([32, 64])(
    'returns canonical full %i-pixel skin and deduplicates/caches',
    async (height) => {
      const canonical = png(height);
      canonical[39] = 1;
      const { service, fetcher, decode } = harness({ image: png(height), decode: () => canonical });
      const [a, b] = await Promise.all([service.get(ID), service.get(ID.toUpperCase())]);
      expect(a).toBe(`data:image/png;base64,${canonical.toString('base64')}`);
      expect(b).toBe(a);
      expect(await service.get('069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBe(a);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(decode).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[1]?.[0]).toBe(URL.replace('http:', 'https:'));
      for (const [, init] of fetcher.mock.calls)
        expect(init).toMatchObject({
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
    },
  );

  it.each(['', 'Notch', `../${ID}`, `${ID}?x`, 'a'.repeat(33)])(
    'rejects non-UUID %s without network',
    async (id) => {
      const { service, fetcher } = harness();
      expect(await service.get(id)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    `https://evil.example/texture/${'a'.repeat(64)}`,
    URL.replace('textures.minecraft.net', 'textures.minecraft.net.evil.example'),
    URL.replace('textures.minecraft.net', 'u@textures.minecraft.net'),
    URL.replace('.net/', '.net:443/'),
    `${URL}?q=1`,
    `${URL}#x`,
    URL.replace('/texture/', '/texture/../texture/'),
    URL.replace('http:', 'file:'),
  ])('rejects an unsafe texture URL %s', async (url) => {
    const { service, fetcher } = harness({ profile: profile(url) });
    expect(await service.get(ID)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    {},
    profile(URL, 'b'.repeat(32)),
    { ...profile(), properties: [{ name: 'textures', value: '!!!!' }] },
    { ...profile(), properties: [...profile().properties, ...profile().properties] },
    {
      ...profile(),
      properties: [{ name: 'textures', value: Buffer.from('{}').toString('base64') }],
    },
    {
      ...profile(),
      properties: [
        {
          name: 'textures',
          value: Buffer.from(
            JSON.stringify({ profileId: 'b'.repeat(32), textures: { SKIN: { url: URL } } }),
          ).toString('base64'),
        },
      ],
    },
  ])('fails closed on malformed/mismatched metadata %#', async (metadata) => {
    const { service, decode } = harness({ profile: metadata });
    expect(await service.get(ID)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([Buffer.alloc(40), png(128), png().subarray(0, 24), Buffer.alloc(65_537)])(
    'rejects invalid PNG before decoding %#',
    async (image) => {
      const { service, decode } = harness({ image });
      expect(await service.get(ID)).toBeNull();
      expect(decode).not.toHaveBeenCalled();
    },
  );

  it.each([null, png(32), Buffer.alloc(0)])(
    'rejects failed or dimension-changing decoders %#',
    async (output) => {
      const { service } = harness({ decode: () => output });
      expect(await service.get(ID)).toBeNull();
    },
  );

  it('returns null on thrown native decode and offline fetch without caching failures', async () => {
    const { service, fetcher } = harness({
      decode: () => {
        throw new Error('decode');
      },
    });
    expect(await service.get(ID)).toBeNull();
    fetcher.mockRejectedValue(new Error('offline'));
    expect(await service.get(ID)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } }),
    () => new Response('x', { headers: { 'content-length': '65537' } }),
    () => new Response('x', { headers: { 'content-length': '2' } }),
    () => new Response('x'.repeat(65_537)),
    () => new Response('not JSON'),
  ])('rejects redirect, length, streaming size, and malformed JSON %#', async (response) => {
    const { service, fetcher } = harness();
    fetcher.mockResolvedValue(response());
    expect(await service.get(ID)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds decoded bytes without treating compressed Content-Length as decoded length', async () => {
    const { service, fetcher } = harness();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(profile()), {
        headers: { 'content-encoding': 'gzip', 'content-length': '100' },
      }),
    );
    expect(await service.get(ID)).not.toBeNull();
    service.clear();
    fetcher.mockResolvedValueOnce(
      new Response('x'.repeat(65_537), {
        headers: { 'content-encoding': 'br', 'content-length': '100' },
      }),
    );
    expect(await service.get(ID)).toBeNull();
  });

  it('clear during native decoding cannot publish or cache its result', async () => {
    const { service, fetcher } = harness({
      decode: (bytes) => {
        service.clear();
        return bytes;
      },
    });
    expect(await service.get(ID)).toBeNull();
    expect(await service.get(ID)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('expires success and bounds the cache count', async () => {
    let now = 0;
    const { service, fetcher } = harness({ now: () => now });
    await service.get(ID);
    now = 300_000;
    await service.get(ID);
    expect(fetcher).toHaveBeenCalledTimes(4);
    // Each profile response must match its requested UUID.
    fetcher.mockImplementation(async (url) =>
      String(url).includes('sessionserver')
        ? Response.json(profile(URL, String(url).split('/').at(-1)))
        : new Response(new Uint8Array(png())),
    );
    for (let index = 0; index < 32; index++)
      await service.get(index.toString(16).padStart(32, '0'));
    const count = fetcher.mock.calls.length;
    await service.get(ID);
    expect(fetcher).toHaveBeenCalledTimes(count + 2);
  });

  it('clear aborts in-flight work and late completion cannot refill cache', async () => {
    const { service, fetcher } = harness();
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const before = service.get(ID);
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    service.clear();
    expect(signal?.aborted).toBe(true);
    expect(await before).toBeNull();
    resolve(Response.json(profile()));
    await Promise.resolve();
    expect(await service.get(ID)).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    service.clear();
    expect(await service.get(ID)).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('an aborted subscriber does not cancel a deduplicated second caller', async () => {
    const { service } = harness();
    const controller = new AbortController();
    const first = service.get(ID, controller.signal);
    const second = service.get(ID);
    controller.abort();
    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
    expect(await service.get(ID, controller.signal)).toBeNull();
  });

  it('bounds stalled requests by timeout, including a stalled stream', async () => {
    vi.useFakeTimers();
    try {
      const { service, fetcher } = harness();
      fetcher.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
      const result = service.get(ID);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await result).toBeNull();
      service.clear();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds concurrent requests and clear allows replacements', async () => {
    const { service, fetcher } = harness();
    fetcher.mockImplementation(() => new Promise(() => {}));
    const requests = Array.from({ length: 32 }, (_, i) =>
      service.get(i.toString(16).padStart(32, '0')),
    );
    expect(await service.get(ID)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(32);
    service.clear();
    expect(await Promise.all(requests)).toEqual(Array(32).fill(null));
  });

  it('preflight requires exact PNG IHDR length/type and width', () => {
    const invalid = png();
    invalid.writeUInt32BE(128, 16);
    expect(skinDimensions(invalid)).toBeNull();
    invalid.writeUInt32BE(64, 16);
    invalid.writeUInt32BE(12, 8);
    expect(skinDimensions(invalid)).toBeNull();
  });
});
