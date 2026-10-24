import { describe, expect, it, vi } from 'vitest';
import { getLoaderVersions, parseNeoForgeVersions } from './loader-versions.js';

describe('loader version catalogs', () => {
  it('returns only stable Fabric loader versions for the requested game release', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { loader: { version: '0.16.14', stable: true } },
            { loader: { version: '0.17.0-rc.1', stable: false } },
            { loader: { version: 'not-a-version', stable: true } },
            { loader: { version: '0.17.0', stable: true } },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    await expect(getLoaderVersions('1.21.1', 'fabric', fetcher)).resolves.toEqual([
      '0.17.0',
      '0.16.14',
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://meta.fabricmc.net/v2/versions/loader/1.21.1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps NeoForge versions in the selected Minecraft release family only', () => {
    const xml = `<metadata><versioning><versions>
      <version>21.1.264</version><version>21.1.9</version><version>21.0.167</version>
      <version>21.1.265-alpha.1</version><version>20.4.253</version>
    </versions></versioning></metadata>`;
    expect(parseNeoForgeVersions(xml, '1.21.1')).toEqual(['21.1.264', '21.1.9']);
    expect(parseNeoForgeVersions(xml, '1.21')).toEqual(['21.0.167']);
    expect(parseNeoForgeVersions(xml, '1.14')).toEqual([]);
  });

  it('reads the official NeoForge version metadata and leaves allowed unsupported releases empty', async () => {
    const fetcher = vi.fn(
      async () => new Response('<metadata><version>21.1.264</version></metadata>'),
    );
    await expect(getLoaderVersions('1.21.1', 'neoforge', fetcher)).resolves.toEqual(['21.1.264']);
    expect(fetcher).toHaveBeenCalledWith(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await expect(getLoaderVersions('1.14', 'neoforge', fetcher)).resolves.toEqual([]);
  });

  it('does not query metadata for a Minecraft version outside the pinned release list', async () => {
    const fetcher = vi.fn();
    await expect(getLoaderVersions('1.7.10', 'neoforge', fetcher)).rejects.toThrow(
      'Unsupported Minecraft version',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized metadata responses', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-length': String(3 * 1024 * 1024) } }),
    );
    await expect(getLoaderVersions('1.21.1', 'fabric', fetcher)).rejects.toThrow(
      'Metadata response is too large',
    );
  });
});
