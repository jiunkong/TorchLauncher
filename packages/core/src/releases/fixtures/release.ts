import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { launcherAssetName } from '../index.js';
export const bytes = Buffer.from('MZ00 release fixture');
export function metadata(version = '1.10.0', application: 'launcher' | 'studio' = 'launcher') {
  const name = launcherAssetName(version, 'windows', application);
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        state: 'uploaded',
        size: bytes.length,
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        browser_download_url: `https://github.com/jiunkong/TorchLauncher/releases/download/v${version}/${name}`,
      },
    ],
  };
}
export function transport() {
  return vi.fn<typeof fetch>(async (url) =>
    String(url).includes('/latest') ? Response.json(metadata()) : new Response(bytes),
  );
}
