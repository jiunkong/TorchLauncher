import { describe, expect, it } from 'vitest';
import { RemoteResourceChangedError } from '../http/index.js';
import { DriveLinkResolutionError, SourceRestartRequiredError } from './errors.js';
import { createDownloadSource } from './factory.js';

describe('download source contract', () => {
  it('routes ordinary HTTPS URLs to the shared range transport', async () => {
    const source = createDownloadSource('https://downloads.example.test/releases/bundle.bin', {
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).get('Range')).toBe('bytes=1-3');
        return partialResponse(1, 3, '"v1"');
      },
    });
    expect(source.kind).toBe('https');

    const result = await source.getRange({ start: 1, end: 3 });
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.sourceId).toBe(source.sourceId);
    expect(result.sourceGeneration).toBe(0);
    expect(result.snapshot.etag).toBe('"v1"');
  });

  it('requires an index restart after a direct HTTPS resource changes', async () => {
    let version = 1;
    const source = createDownloadSource('https://downloads.example.test/bundle.bin', {
      fetch: async (_input, init) => {
        const range = new Headers(init?.headers).get('Range') ?? '';
        const [start, end] = parseRange(range);
        return partialResponse(start, end, `"v${version}"`);
      },
    });
    await source.getRange({ start: 0, end: 1 });
    version = 2;

    await expect(source.getRange({ start: 2, end: 3 })).rejects.toBeInstanceOf(
      SourceRestartRequiredError,
    );
    await expect(source.getRange({ start: 4, end: 5 })).rejects.toBeInstanceOf(
      SourceRestartRequiredError,
    );
    source.reset();
    expect(source.generation).toBe(2);
    await expect(source.getRange({ start: 0, end: 1 })).resolves.toMatchObject({
      sourceGeneration: 2,
      snapshot: { etag: '"v2"' },
    });
  });

  it('aborts pending requests when a source generation is reset', async () => {
    const source = createDownloadSource('https://downloads.example.test/bundle.bin', {
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('reset');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    });
    const pending = source.getRange({ start: 0, end: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    source.reset();

    await expect(pending).rejects.toBeInstanceOf(SourceRestartRequiredError);
  });

  it('cancels a Drive resolution when its last waiting range request is aborted', async () => {
    let attempts = 0;
    let resolutionWasAborted = false;
    const source = createDownloadSource('https://drive.google.com/open?id=File_123', {
      fetch: async (_input, init) => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              resolutionWasAborted = true;
              const error = new Error('resolution canceled');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        if (new Headers(init?.headers).has('Range')) {
          const range = new Headers(init?.headers).get('Range') ?? '';
          const [start, end] = parseRange(range);
          return partialResponse(start, end, '"v1"');
        }
        return new Response('file', {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="bundle.bin"',
          },
        });
      },
    });
    const controller = new AbortController();
    const pending = source.getRange({ start: 0, end: 1 }, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolutionWasAborted).toBe(true);
    await expect(source.getRange({ start: 0, end: 1 })).resolves.toBeDefined();
  });

  it('resolves a Drive share URL once and reuses DL-02 for byte ranges', async () => {
    let resolverRequests = 0;
    let rangeRequests = 0;
    const source = createDownloadSource('https://drive.google.com/file/d/File_123/view', {
      fetch: async (_input, init) => {
        const range = new Headers(init?.headers).get('Range');
        if (range) {
          rangeRequests += 1;
          const [start, end] = parseRange(range);
          return partialResponse(start, end, '"drive-v1"');
        }
        resolverRequests += 1;
        return new Response('file', {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="bundle.bin"',
          },
        });
      },
    });
    expect(source.kind).toBe('google-drive');

    const first = await source.getRange({ start: 0, end: 1 });
    const second = await source.getRange({ start: 2, end: 3 });
    expect(Array.from(first.bytes)).toEqual([0, 1]);
    expect(Array.from(second.bytes)).toEqual([2, 3]);
    expect(resolverRequests).toBe(1);
    expect(rangeRequests).toBe(2);
  });

  it('requires a new source generation after a Drive URL expires', async () => {
    let resolutionRequests = 0;
    let rangeRequests = 0;
    const source = createDownloadSource('https://drive.google.com/open?id=File_123', {
      fetch: async (_input, init) => {
        if (new Headers(init?.headers).has('Range')) {
          rangeRequests += 1;
          if (rangeRequests === 1) return new Response('expired', { status: 403 });
          const [start, end] = parseRange(new Headers(init?.headers).get('Range') ?? '');
          return partialResponse(start, end, '"drive-v2"');
        }
        resolutionRequests += 1;
        return new Response('file', {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="bundle.bin"',
          },
        });
      },
    });

    await expect(source.getRange({ start: 0, end: 1 })).rejects.toBeInstanceOf(
      SourceRestartRequiredError,
    );
    await expect(source.getRange({ start: 2, end: 3 })).rejects.toBeInstanceOf(
      SourceRestartRequiredError,
    );
    expect(resolutionRequests).toBe(1);
    expect(rangeRequests).toBe(1);

    source.reset();
    const result = await source.getRange({ start: 0, end: 1 });
    expect(result.sourceGeneration).toBe(2);
    expect(resolutionRequests).toBe(2);
    expect(rangeRequests).toBe(2);
  });

  it('rejects non-Google redirects during Drive range requests', async () => {
    const requestedHosts: string[] = [];
    const source = createDownloadSource('https://drive.google.com/open?id=File_123', {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requestedHosts.push(url.hostname);
        if (new Headers(init?.headers).has('Range')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://attacker.example/payload' },
          });
        }
        return new Response('file', {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="bundle.bin"',
          },
        });
      },
    });

    await expect(source.getRange({ start: 0, end: 1 })).rejects.toThrow(/HTTPS/);
    expect(requestedHosts).toEqual(['drive.google.com', 'drive.google.com']);
  });

  it('rejects unsupported Google Drive URLs instead of treating them as generic HTTPS', () => {
    expect(() => createDownloadSource('https://drive.google.com/drive/folders/Folder_123')).toThrow(
      DriveLinkResolutionError,
    );
  });

  it('uses a version change error to stop mixing byte ranges', async () => {
    let version = 1;
    const source = createDownloadSource('https://downloads.example.test/bundle.bin', {
      fetch: async (_input, init) => {
        const range = new Headers(init?.headers).get('Range') ?? '';
        const [start, end] = parseRange(range);
        return partialResponse(start, end, `"v${version}"`);
      },
    });
    await source.getRange({ start: 0, end: 1 });
    version = 2;
    await expect(source.getRange({ start: 2, end: 3 })).rejects.toMatchObject({
      name: 'SourceRestartRequiredError',
      cause: expect.any(RemoteResourceChangedError),
    });
  });
});

function parseRange(value: string): [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error('Invalid test range');
  return [Number(match[1]), Number(match[2])];
}

function partialResponse(start: number, end: number, etag: string): Response {
  return new Response(
    new Uint8Array(Array.from({ length: end - start + 1 }, (_, i) => start + i)),
    {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/16`,
        'Content-Length': String(end - start + 1),
        ETag: etag,
      },
    },
  );
}
