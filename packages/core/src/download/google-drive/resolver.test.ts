import { describe, expect, it } from 'vitest';
import { DriveLinkResolutionError } from '../source/errors.js';
import { parseGoogleDriveFileUrl } from './parse-url.js';
import { extractDriveConfirmationUrl, GoogleDriveResolver } from './resolver.js';

const reference = parseGoogleDriveFileUrl('https://drive.google.com/file/d/File_123/view');

describe('Google Drive public file resolution', () => {
  it('extracts confirmation href links, form fields, and embedded download URLs', () => {
    expect(
      extractDriveConfirmationUrl(
        '<a href="/uc?export=download&amp;id=File_123&amp;confirm=token">download</a>',
        new URL('https://drive.google.com/uc?id=File_123'),
      ).href,
    ).toBe('https://docs.google.com/uc?export=download&id=File_123&confirm=token');

    expect(
      extractDriveConfirmationUrl(
        '<form id="download-form" action="https://drive.usercontent.google.com/download?export=download"><input type="hidden" name="id" value="File_123"><input name="confirm" value="token" type="hidden"></form>',
        new URL('https://drive.google.com/uc?id=File_123'),
      ).href,
    ).toBe(
      'https://drive.usercontent.google.com/download?export=download&id=File_123&confirm=token',
    );

    expect(
      extractDriveConfirmationUrl(
        '{"downloadUrl":"https://drive.usercontent.google.com/download?id=File_123\\u0026confirm=token"}',
        new URL('https://drive.google.com/uc?id=File_123'),
      ).href,
    ).toBe('https://drive.usercontent.google.com/download?id=File_123&confirm=token');
  });

  it('resolves a direct public file URL without buffering its body', async () => {
    let bodyCanceled = false;
    const fetcher: typeof fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          bodyCanceled = true;
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="bundle.bin"',
        },
      });
    };
    const resolver = new GoogleDriveResolver({ fetch: fetcher });

    await expect(resolver.resolveFileUrl(reference)).resolves.toEqual(
      new URL(`https://drive.google.com/uc?export=download&id=${reference.id}`),
    );
    expect(bodyCanceled).toBe(true);
  });

  it('submits confirmation form values with the anonymous scoped cookie', async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      requests.push({ url, cookie: headers.get('Cookie') });
      if (requests.length === 1) {
        return new Response(
          '<form id="download-form" action="https://drive.usercontent.google.com/download?export=download"><input type="hidden" name="id" value="File_123"><input type="hidden" name="confirm" value="token"></form>',
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie': 'download_warning=anonymous; Domain=.google.com; Path=/; Secure',
            },
          },
        );
      }
      return new Response('binary', {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="file.bin"',
        },
      });
    };
    const resolver = new GoogleDriveResolver({ fetch: fetcher });

    const resolved = await resolver.resolveFileUrl(reference);
    expect(resolved.hostname).toBe('drive.usercontent.google.com');
    expect(resolved.searchParams.get('confirm')).toBe('token');
    expect(requests[1]?.cookie).toBe('download_warning=anonymous');
    expect(requests[0]?.cookie).toBeNull();
  });

  it('rejects unsafe redirect targets before following them', async () => {
    let requests = 0;
    const resolver = new GoogleDriveResolver({
      fetch: async () => {
        requests += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://untrusted.example/file' },
        });
      },
    });

    await expect(resolver.resolveFileUrl(reference)).rejects.toBeInstanceOf(
      DriveLinkResolutionError,
    );
    expect(requests).toBe(1);
  });

  it('follows bounded redirects among approved Google hosts', async () => {
    const hosts: string[] = [];
    const resolver = new GoogleDriveResolver({
      fetch: async (input) => {
        const url = new URL(String(input));
        hosts.push(url.hostname);
        if (hosts.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://drive.usercontent.google.com/download?id=File_123' },
          });
        }
        return new Response('file', {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="file.bin"',
          },
        });
      },
    });

    const url = await resolver.resolveFileUrl(reference);
    expect(hosts).toEqual(['drive.google.com', 'drive.usercontent.google.com']);
    expect(url.hostname).toBe('drive.usercontent.google.com');
  });

  it('stops after the configured redirect limit', async () => {
    let requests = 0;
    const resolver = new GoogleDriveResolver({
      maxRedirects: 1,
      fetch: async (input) => {
        requests += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: String(input) },
        });
      },
    });

    await expect(resolver.resolveFileUrl(reference)).rejects.toThrow(/redirect limit/);
    expect(requests).toBe(2);
  });

  it('bounds confirmation page size', async () => {
    const resolver = new GoogleDriveResolver({
      maxPageBytes: 1024,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(1025));
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        ),
    });

    await expect(resolver.resolveFileUrl(reference)).rejects.toThrow(/size limit/);
  });

  it('reports Drive error pages without echoing the page markup', () => {
    expect(() =>
      extractDriveConfirmationUrl(
        '<p class="uc-error-subcaption">Too many users have viewed this file</p>',
        new URL('https://drive.google.com/uc?id=File_123'),
      ),
    ).toThrow('Too many users have viewed this file');
  });
});
