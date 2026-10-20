import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFullDownloader } from './index';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function server(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture listener');
  return `http://127.0.0.1:${address.port}`;
}
const local = { allowInsecureLocalhost: true, retryDelayMs: 0 };
describe('complete HTTPS download adapter', () => {
  it('reads full bounded bytes without Range, cookies or authorization', async () => {
    const bytes = vi.fn();
    const url = await server((request, response) => {
      expect(request.headers.range).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers['accept-encoding']).toBe('identity');
      response.setHeader('Content-Length', 5);
      response.end('hello');
    });
    expect(
      Buffer.from(
        await createFullDownloader({ ...local, onBytes: bytes })(url, { maxBytes: 5 }),
      ).toString(),
    ).toBe('hello');
    expect(bytes.mock.calls.reduce((sum, [count]) => sum + count, 0)).toBe(5);
  });
  it('bounds chunked responses and cancels overflow', async () => {
    const url = await server((_, response) => {
      response.write('123');
      response.end('456');
    });
    await expect(createFullDownloader(local)(url, { maxBytes: 4 })).rejects.toThrow(
      'exceeds declared limit',
    );
  });
  it('reads a larger unknown-length body within its byte limit', async () => {
    const expected = Buffer.from(Uint8Array.from({ length: 80_000 }, (_, index) => index % 251));
    const url = await server((_, response) => {
      response.write(expected.subarray(0, 40_000));
      response.end(expected.subarray(40_000));
    });
    expect(Buffer.from(await createFullDownloader(local)(url, { maxBytes: 100_000 }))).toEqual(
      expected,
    );
  });
  it('rejects oversized lengths, partial and encoded responses without retry', async () => {
    for (const headers of [
      { 'Content-Length': '100' },
      { 'Content-Range': 'bytes 0-1/2' },
      { 'Content-Encoding': 'gzip' },
    ]) {
      const fetcher = vi.fn(async () => new Response('xx', { headers }));
      await expect(
        createFullDownloader({ fetch: fetcher })('https://example.test/file', { maxBytes: 2 }),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('supports an empty full response', async () => {
    const url = await server((_, response) => {
      response.setHeader('Content-Length', 0);
      response.end();
    });
    expect(await createFullDownloader(local)(url, { maxBytes: 0 })).toHaveLength(0);
  });
  it('retries transient status and interrupted transport, never returning a partial body', async () => {
    let count = 0;
    const url = await server((_, response) => {
      count++;
      if (count === 1) {
        response.writeHead(503);
        response.end();
      } else if (count === 2) {
        response.setHeader('Content-Length', 6);
        response.write('bad');
        response.destroy();
      } else response.end('whole');
    });
    expect(Buffer.from(await createFullDownloader(local)(url, { maxBytes: 6 })).toString()).toBe(
      'whole',
    );
    expect(count).toBe(3);
  });
  it('does not retry non-transient HTTP failures', async () => {
    const fetcher = vi.fn(async () => new Response('no', { status: 404 }));
    await expect(
      createFullDownloader({ fetch: fetcher })('https://example.test', { maxBytes: 100 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('follows only validated redirects and stops loops', async () => {
    const url = await server((request, response) => {
      if (request.url === '/done') response.end('done');
      else {
        response.writeHead(302, { Location: request.url === '/loop' ? '/loop' : '/done' });
        response.end();
      }
    });
    expect(Buffer.from(await createFullDownloader(local)(url, { maxBytes: 4 })).toString()).toBe(
      'done',
    );
    await expect(
      createFullDownloader({ ...local, maxRedirects: 1 })(`${url}/loop`, { maxBytes: 4 }),
    ).rejects.toThrow('redirect limit');
  });
  it.each([
    'http://example.test/file',
    'https://user:pass@example.test/file',
    'https://example.test/file#fragment',
  ])('rejects unsafe initial URL %s', async (url) => {
    const fetcher = vi.fn();
    await expect(
      createFullDownloader({ fetch: fetcher, allowInsecureLocalhost: true })(url, { maxBytes: 10 }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http://127.0.0.1/file', 'file:///etc/passwd', 'https://user:pass@example.test'])(
    'refuses unsafe redirect %s',
    async (target) => {
      const fetcher = vi.fn(
        async () => new Response(null, { status: 302, headers: { Location: target } }),
      );
      await expect(
        createFullDownloader({ fetch: fetcher, allowInsecureLocalhost: true })(
          'https://example.test',
          { maxBytes: 10 },
        ),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('cancels a stalled body and does not retry user cancellation', async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(Buffer.from('partial'));
            },
            cancel: cancelled,
          }),
        ),
    );
    const pending = createFullDownloader({ fetch: fetcher })('https://example.test', {
      maxBytes: 100,
      signal: controller.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out stalled bodies with a bounded attempt count', async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream()));
    await expect(
      createFullDownloader({ fetch: fetcher, timeoutMs: 10, maxAttempts: 2, retryDelayMs: 0 })(
        'https://example.test',
        { maxBytes: 10 },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not include signed URLs or raw transport causes in errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('signed-url-secret');
    });
    const download = createFullDownloader({ fetch: fetcher, maxAttempts: 1 });
    await expect(
      download('https://example.test/?sig=signed-url-secret', { maxBytes: 1 }),
    ).rejects.not.toThrow('signed-url-secret');
  });
});
