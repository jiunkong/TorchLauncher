import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HttpRangeClient,
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

    const client = new HttpRangeClient();
    const first = await client.getRange(url, { start: 1, end: 3 });
    const second = await client.getRange(url, { start: 4, end: 6 });

    expect(Buffer.from(first.bytes).toString()).toBe('bcd');
    expect(Buffer.from(second.bytes).toString()).toBe('efg');
    expect(requests).toEqual([
      { range: 'bytes=1-3', ifRange: undefined },
      { range: 'bytes=4-6', ifRange: '"v1"' },
    ]);
    expect(client.snapshot?.totalLength).toBe(payload.length);
  });

  it('rejects a server that ignores Range without downloading the full resource', async () => {
    let sent = 0;
    const url = await serve((_request, response) => {
      sent += 1;
      response.writeHead(200, { 'Content-Length': payload.length });
      response.end(payload);
    });

    await expect(
      new HttpRangeClient().getRange(url, { start: 2, end: 3 }, { maxAttempts: 3 }),
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

    await expect(new HttpRangeClient().getRange(url, { start: 1, end: 2 })).rejects.toBeInstanceOf(
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
      new HttpRangeClient().getRange(
        'https://example.test/file',
        { start: 0, end: 2 },
        {
          fetch: fetcher,
        },
      ),
    ).rejects.toBeInstanceOf(RangeProtocolError);
  });

  it('detects a remote replacement between ranges', async () => {
    let version = 1;
    const url = await serve((request, response) => {
      if (request.url === '/replace') {
        version = 2;
        response.writeHead(200, { 'Content-Length': payload.length, ETag: '"v2"' });
        response.end(payload);
        return;
      }
      const [start, end] = parseRange(headerValue(request.headers.range));
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Content-Length': end - start + 1,
        ETag: `"v${version}"`,
      });
      response.end(payload.subarray(start, end + 1));
    });
    const client = new HttpRangeClient();
    await client.getRange(url, { start: 0, end: 1 });

    await expect(client.getRange(`${url}/replace`, { start: 2, end: 3 })).rejects.toBeInstanceOf(
      RemoteResourceChangedError,
    );
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

    const result = await new HttpRangeClient().getRange(
      url,
      { start: 0, end: 1 },
      { retryDelayMs: 0 },
    );
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
    const pending = new HttpRangeClient().getRange(
      url,
      { start: 0, end: 1 },
      { signal: controller.signal, retryDelayMs: 0 },
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
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

function parseRange(value: string | undefined): [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value ?? '');
  if (!match) throw new Error('Expected a Range request header');
  return [Number(match[1]), Number(match[2])];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
