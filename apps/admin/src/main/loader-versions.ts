import { minecraftVersions } from '../shared/minecraft-versions.js';

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader/';
const NEOFORGE_META =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const LOADER_VERSION = /^\d+(?:\.\d+){2,3}$/;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function versionParts(value: string): number[] {
  return value.split('.').map(Number);
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (right[i] ?? 0) - (left[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

async function boundedText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Metadata request failed (${response.status})`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new Error('Metadata response is too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Metadata response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function fabricVersions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid Fabric metadata');
  const versions = value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const loader = (entry as Record<string, unknown>).loader;
    if (!loader || typeof loader !== 'object') return [];
    const item = loader as Record<string, unknown>;
    return item.stable === true &&
      typeof item.version === 'string' &&
      LOADER_VERSION.test(item.version)
      ? [item.version]
      : [];
  });
  return [...new Set(versions)].sort(compareVersions);
}

function neoforgeFamily(minecraftVersion: string): string {
  const parts = minecraftVersion.split('.');
  if (parts[0] === '1') {
    if (parts.length === 2) return `${parts[1]}.0`;
    return `${parts[1]}.${parts[2]}`;
  }
  return `${parts[0]}.${parts[1]}`;
}

export function parseNeoForgeVersions(xml: string, minecraftVersion: string): string[] {
  const family = `${neoforgeFamily(minecraftVersion)}.`;
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
    .map((match) => match[1])
    .filter((version): version is string => !!version && LOADER_VERSION.test(version))
    .filter((version) => version.startsWith(family));
  return [...new Set(versions)].sort(compareVersions);
}

export async function getLoaderVersions(
  minecraftVersion: string,
  kind: 'fabric' | 'neoforge',
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<string[]> {
  if (!(minecraftVersions as readonly string[]).includes(minecraftVersion))
    throw new Error('Unsupported Minecraft version');
  const response =
    kind === 'fabric'
      ? await fetcher(`${FABRIC_META}${encodeURIComponent(minecraftVersion)}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      : await fetcher(NEOFORGE_META, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await boundedText(response);
  if (kind === 'fabric') return fabricVersions(JSON.parse(text) as unknown);
  return parseNeoForgeVersions(text, minecraftVersion);
}
