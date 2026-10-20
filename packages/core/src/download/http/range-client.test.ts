import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HttpRangeClient,
  RangeHttpError,
  RangeNotSupportedError,
  RangeProtocolError,
  RemoteResourceChangedError,
} from './range-client.js';

const payload = Buffer.from('abcdefgh');
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('HttpRangeClient', () => {
  it('returns only the requested bytes and pins the resource validators', async () => {
    const requests: Array<{ range: string | undefined; ifRange: string | undefined }> = [];
    const url = await serve((request, response) => {
      requests.push({
        range: headerValue(request.headers.range),
        ifRange: headerValue(request.headers['if-range']),
      });
      const [start, end] = parseRange(headerValue(request.headers.range));
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Content-Length': end - start + 1,
        ETag: '"v1"',
        'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
      });
      response.end(payload.subarray(start, end + 1));
    });

    const client = testClient();
    const first = await client.getRange(url, { start: 1, end: 3 });
    const second = await client.getRange(url, { start: 4, end: 6 });

    expect(Buffer.from(first.bytes).toString()).toBe('bcd');
    expect(Buffer.from(second.bytes).toString()).toBe('efg');
    expect(requests).toEqual([
      { range: 'bytes=1-3', ifRange: undefined },
      { range: 'bytes=4-6', ifRange: '"v1"' },
    ]);
    expect(client.snapshot?.totalLength).toBe(payload.length);
    first.snapshot.etag = 'mutated';
    expect(client.snapshot?.etag).toBe('"v1"');
    expect(second.snapshot.etag).toBe('"v1"');
  });

  it('accepts chunked partial responses without Content-Length and requests identity encoding', async () => {
    let acceptEncoding: string | undefined;
    const url = await serve((request, response) => {
      acceptEncoding = headerValue(request.headers['accept-encoding']);
      response.writeHead(206, { 'Content-Range': 'bytes 0-2/8', ETag: '"v1"' });
      response.write('a');
      response.end('bc');
    });

    const result = await testClient().getRange(url, { start: 0, end: 2 });
    expect(Buffer.from(result.bytes).toString()).toBe('abc');
    expect(acceptEncoding?.split(',').map((value) => value.trim())).toEqual([
      'identity',
      'identity',
    ]);
  });

  it('rejects encoded range responses', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('abc', {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-2/8',
          'Content-Length': '3',
          'Content-Encoding': 'gzip',
        },
      });

    await expect(
      testClient().getRange(
        'https://example.test/file',
        { start: 0, end: 2 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
  });

  it('rejects plain HTTP sources by default', async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return new Response();
    };

    await expect(
      new HttpRangeClient().getRange(
        'http://example.test/file',
        { start: 0, end: 1 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
    expect(requests).toBe(0);
  });

  it('rejects HTTPS downgrade redirects before following them', async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requested.push(String(input));
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://insecure.test/file' },
      });
    };

    await expect(
      new HttpRangeClient().getRange(
        'https://secure.test/file',
        { start: 0, end: 1 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
    expect(requested).toEqual(['https://secure.test/file']);
  });

  it('bounds redirects and removes sensitive headers when origin changes', async () => {
    const calls: Array<{
      url: string;
      authorization: string | null;
      cookie: string | null;
      trace: string | null;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        authorization: headers.get('Authorization'),
        cookie: headers.get('Cookie'),
        trace: headers.get('X-Trace'),
      });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.test/file' },
        });
      }
      return new Response('ab', {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/8', 'Content-Length': '2' },
      });
    };

    const result = await new HttpRangeClient().getRange(
      'https://origin.test/file',
      { start: 0, end: 1 },
      {
        fetch: fetcher,
        headers: { Authorization: 'Bearer secret', Cookie: 'session=secret', 'X-Trace': 'keep' },
      },
    );
    expect(Buffer.from(result.bytes).toString()).toBe('ab');
    expect(calls).toEqual([
      {
        url: 'https://origin.test/file',
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        trace: 'keep',
      },
      { url: 'https://cdn.test/file', authorization: null, cookie: null, trace: null },
    ]);

    let redirects = 0;
    const loopFetcher: typeof fetch = async (input) => {
      redirects += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: String(input) },
      });
    };
    await expect(
      new HttpRangeClient().getRange(
        'https://secure.test/loop',
        { start: 0, end: 1 },
        {
          fetch: loopFetcher,
          maxRedirects: 2,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
    expect(redirects).toBe(3);
  });

  it('enforces the configured byte cap before requesting and while streaming', async () => {
    let requests = 0;
    const tooLargeRangeFetcher: typeof fetch = async () => {
      requests += 1;
      return new Response('abc', {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/8' },
      });
    };
    const client = testClient();
    await expect(
      client.getRange(
        'https://example.test/file',
        { start: 0, end: 2 },
        {
          fetch: tooLargeRangeFetcher,
          maxBytes: 2,
        },
      ),
    ).rejects.toThrow(/exceeds/);
    await expect(
      client.getRange(
        'https://example.test/file',
        {
          start: 0,
          end: Number.MAX_SAFE_INTEGER,
        },
        {
          fetch: tooLargeRangeFetcher,
        },
      ),
    ).rejects.toThrow(/length must be a positive safe integer/);
    expect(requests).toBe(0);

    await expect(
      client.getRange(
        'https://example.test/file',
        { start: 0, end: 1 },
        {
          fetch: tooLargeRangeFetcher,
          maxBytes: 2,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
  });

  it('rejects a server that ignores Range without downloading the full resource', async () => {
    let sent = 0;
    const url = await serve((_request, response) => {
      sent += 1;
      response.writeHead(200, { 'Content-Length': payload.length });
      response.end(payload);
    });

    await expect(
      testClient().getRange(url, { start: 2, end: 3 }, { maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(RangeNotSupportedError);
    expect(sent).toBe(1);
  });

  it('rejects mismatched Content-Range and Content-Length', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(206, {
        'Content-Range': 'bytes 0-2/8',
        'Content-Length': '2',
      });
      response.end('ab');
    });

    await expect(testClient().getRange(url, { start: 1, end: 2 })).rejects.toBeInstanceOf(
      RangeProtocolError,
    );
  });

  it('rejects a response body shorter than its declared range', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('ab', {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-2/8',
          'Content-Length': '3',
        },
      });

    await expect(
      testClient().getRange(
        'https://example.test/file',
        { start: 0, end: 2 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
  });

  it('detects a same-URL remote replacement between ranges', async () => {
    let version = 1;
    const url = await serve((request, response) => {
      const [start, end] = parseRange(headerValue(request.headers.range));
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Content-Length': end - start + 1,
        ETag: `"v${version}"`,
      });
      response.end(payload.subarray(start, end + 1));
    });
    const client = testClient();
    await client.getRange(url, { start: 0, end: 1 });
    version = 2;

    await expect(client.getRange(url, { start: 2, end: 3 })).rejects.toBeInstanceOf(
      RemoteResourceChangedError,
    );
  });

  it('does not allow a pinned client to switch resource URLs', async () => {
    let requests = 0;
    const url = await serve((_request, response) => {
      requests += 1;
      response.writeHead(206, {
        'Content-Range': 'bytes 0-1/8',
        'Content-Length': 2,
        ETag: '"same"',
      });
      response.end('ab');
    });
    const client = testClient();
    await client.getRange(`${url}/first`, { start: 0, end: 1 });

    await expect(client.getRange(`${url}/second`, { start: 0, end: 1 })).rejects.toBeInstanceOf(
      RemoteResourceChangedError,
    );
    expect(requests).toBe(1);
  });

  it('pins the effective URL reached through redirects', async () => {
    let sourceRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/source') {
        sourceRequests += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: sourceRequests === 1 ? '/target-a' : '/target-b' },
        });
      }
      const rangeHeader = new Headers(init?.headers).get('Range');
      const [start, end] = parseRange(rangeHeader ?? undefined);
      return partialResponse(start, end, '"same-version"');
    };
    const client = new HttpRangeClient();

    await client.getRange(
      'https://example.test/source',
      { start: 0, end: 1 },
      {
        fetch: fetcher,
      },
    );
    await expect(
      client.getRange(
        'https://example.test/source',
        { start: 2, end: 3 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RemoteResourceChangedError);
  });

  it('rechecks the pinned snapshot after concurrent first responses finish', async () => {
    const responders: Array<(response: Response) => void> = [];
    const fetcher: typeof fetch = async () => new Promise((resolve) => responders.push(resolve));
    const client = testClient();
    const firstRequest = client.getRange(
      'https://example.test/file',
      { start: 0, end: 1 },
      {
        fetch: fetcher,
      },
    );
    const secondRequest = client.getRange(
      'https://example.test/file',
      { start: 2, end: 3 },
      {
        fetch: fetcher,
      },
    );
    await waitForCount(responders, 2);
    const respondFirst = responders[0];
    const respondSecond = responders[1];
    if (!respondFirst || !respondSecond) throw new Error('Both requests should be pending');
    respondFirst(partialResponse(0, 1, '"v1"'));
    await expect(firstRequest).resolves.toMatchObject({ bytes: new Uint8Array([0, 1]) });
    respondSecond(partialResponse(2, 3, '"v2"'));
    await expect(secondRequest).rejects.toBeInstanceOf(RemoteResourceChangedError);
  });

  it('retries transient server failures', async () => {
    let attempts = 0;
    const url = await serve((request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(503);
        response.end();
        return;
      }
      const [start, end] = parseRange(headerValue(request.headers.range));
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Content-Length': end - start + 1,
      });
      response.end(payload.subarray(start, end + 1));
    });

    const result = await testClient().getRange(url, { start: 0, end: 1 }, { retryDelayMs: 0 });
    expect(Buffer.from(result.bytes).toString()).toBe('ab');
    expect(attempts).toBe(2);
  });

  it('stops retrying when the request is aborted', async () => {
    let attempts = 0;
    const url = await serve((_request, response) => {
      attempts += 1;
      setTimeout(() => {
        if (!response.destroyed) response.writeHead(503).end();
      }, 100);
    });
    const controller = new AbortController();
    const pending = testClient().getRange(
      url,
      { start: 0, end: 1 },
      { signal: controller.signal, retryDelayMs: 0 },
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('aborts while reading a response body without retrying', async () => {
    let attempts = 0;
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_input, init) => {
      attempts += 1;
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new Uint8Array([1]));
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted during body');
            error.name = 'AbortError';
            stream.error(error);
          });
        },
      });
      return new Response(body, {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/8', 'Content-Length': '2' },
      });
    };
    const pending = testClient().getRange(
      'https://example.test/file',
      { start: 0, end: 1 },
      { fetch: fetcher, signal: controller.signal, retryDelayMs: 0 },
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('stops after the configured number of retryable failures', async () => {
    let attempts = 0;
    const url = await serve((_request, response) => {
      attempts += 1;
      response.writeHead(503).end();
    });

    await expect(
      testClient().getRange(
        url,
        { start: 0, end: 1 },
        {
          maxAttempts: 3,
          retryDelayMs: 0,
        },
      ),
    ).rejects.toBeInstanceOf(RangeHttpError);
    expect(attempts).toBe(3);
  });
});

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function testClient(): HttpRangeClient {
  return new HttpRangeClient({ allowInsecureHttp: true });
}

function parseRange(value: string | undefined): [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value ?? '');
  if (!match) throw new Error('Expected a Range request header');
  return [Number(match[1]), Number(match[2])];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function partialResponse(start: number, end: number, etag: string): Response {
  return new Response(new Uint8Array([start, end]), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/8`,
      'Content-Length': String(end - start + 1),
      ETag: etag,
    },
  });
}

async function waitForCount<T>(items: T[], count: number): Promise<void> {
  while (items.length < count) await new Promise((resolve) => setTimeout(resolve, 0));
}
