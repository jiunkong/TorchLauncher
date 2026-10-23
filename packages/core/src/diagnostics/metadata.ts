import { crc32, inflateRawSync } from 'node:zlib';

export interface ModDependency {
  id: string;
  version: string | string[];
  type?: string;
  side?: string;
}
export interface ModMetadata {
  id: string;
  version: string;
  dependencies: ModDependency[];
  environment?: '*' | 'client' | 'server';
}
/** One jar can declare several mods. Nested jars are deliberately not inspected. */
export interface ModInfo {
  loader: 'fabric' | 'neoforge';
  mods: ModMetadata[];
  file?: string;
}
export class ModMetadataError extends Error {
  constructor(
    public readonly code:
      | 'invalid-zip'
      | 'unsafe-entry'
      | 'zip64-unsupported'
      | 'limit-exceeded'
      | 'unsupported-compression'
      | 'metadata-not-found'
      | 'invalid-metadata'
      | 'unsupported-toml',
  ) {
    super(code);
    this.name = 'ModMetadataError';
  }
}
const LIMIT = 1024 * 1024;
const JAR_LIMIT = 64 * LIMIT;
const FABRIC = 'fabric.mod.json';
const NEOFORGE = 'META-INF/neoforge.mods.toml';
function fail(code: ModMetadataError['code']): never {
  throw new ModMetadataError(code);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-metadata');
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096) fail('invalid-metadata');
  return value;
}
function id(value: unknown): string {
  const text = str(value);
  if (!/^[a-z0-9_][a-z0-9_.-]{0,63}$/i.test(text)) fail('invalid-metadata');
  return text;
}
function fabric(text: string): ModInfo {
  const value = record(JSON.parse(text));
  const entries = Object.entries(record(value.depends ?? {}));
  if (entries.length > 256) fail('limit-exceeded');
  const dependencies = entries.map(([key, version]): ModDependency => {
    if (Array.isArray(version)) {
      if (version.length > 256) fail('limit-exceeded');
      return { id: id(key), version: version.map(str) };
    }
    return { id: id(key), version: str(version) };
  });
  const mod: ModMetadata = { id: id(value.id), version: str(value.version), dependencies };
  if (value.environment !== undefined) {
    if (!['*', 'client', 'server'].includes(str(value.environment))) fail('invalid-metadata');
    mod.environment = value.environment as ModMetadata['environment'] & string;
  }
  return { loader: 'fabric', mods: [mod] };
}

/** Minimal TOML subset: quoted scalars for metadata, [[mods]] and [[dependencies.<id>]].
 * Unrelated keys/tables are skipped. Multiline descriptive strings are skipped, never evaluated.
 * Unsupported syntax in a field we consume fails explicitly rather than guessing.
 */
function neoForge(text: string): ModInfo {
  const mods: ModMetadata[] = [];
  const deps = new Map<string, Record<string, string>[]>();
  let current: Record<string, string> | undefined;
  const rawMods: Record<string, string>[] = [];
  let multiline: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = undefined;
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      current = undefined;
      const header = /^\[\[([a-zA-Z0-9_.-]+)\]\]\s*(?:#.*)?$/.exec(line)?.[1];
      if (header === 'mods') {
        current = {};
        rawMods.push(current);
      } else if (header?.startsWith('dependencies.')) {
        const owner = id(header.slice('dependencies.'.length));
        current = {};
        const entries = deps.get(owner) ?? [];
        entries.push(current);
        deps.set(owner, entries);
      }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) {
      if (current) fail('unsupported-toml');
      else continue;
    }
    const key = line.slice(0, eq).trim();
    const rhs = line.slice(eq + 1).trim();
    const relevant = current && ['modId', 'version', 'versionRange', 'type', 'side'].includes(key);
    if (rhs.startsWith('"""') || rhs.startsWith("'''")) {
      if (relevant) fail('unsupported-toml');
      const delimiter = rhs.slice(0, 3);
      if (!rhs.slice(3).includes(delimiter)) multiline = delimiter;
      continue;
    }
    if (!relevant || !current) continue;
    const quote = rhs[0];
    if (quote !== '"' && quote !== "'") fail('unsupported-toml');
    let end = 1;
    for (; end < rhs.length; end++) {
      if (quote === '"' && rhs[end] === '\\') {
        end++;
        continue;
      }
      if (rhs[end] === quote) break;
    }
    if (
      end === rhs.length ||
      (rhs.slice(end + 1).trim() &&
        !rhs
          .slice(end + 1)
          .trim()
          .startsWith('#'))
    )
      fail('unsupported-toml');
    if (Object.hasOwn(current, key)) fail('invalid-metadata');
    current[key] = quote === '"' ? str(JSON.parse(rhs.slice(0, end + 1))) : str(rhs.slice(1, end));
  }
  if (multiline || rawMods.length === 0 || rawMods.length > 256) fail('invalid-metadata');
  for (const value of rawMods) {
    mods.push({
      id: id(value.modId),
      version: str(value.version),
      dependencies: (deps.get(id(value.modId)) ?? []).map((dep) => ({
        id: id(dep.modId),
        version: str(dep.versionRange ?? '*'),
        ...(dep.type ? { type: dep.type } : {}),
        ...(dep.side ? { side: dep.side } : {}),
      })),
    });
  }
  if (new Set(mods.map((mod) => mod.id)).size !== mods.length) fail('invalid-metadata');
  return { loader: 'neoforge', mods };
}

function entryName(bytes: Buffer): string {
  let name: string;
  try {
    name = new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    return fail('unsafe-entry');
  }
  const parts = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  // Also reject Windows drive/ADS, controls and path aliases on Linux.
  if (
    !name ||
    name.length > 4096 ||
    name.includes('\\') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject archive control characters.
    /[:\x00-\x1f\x7f]/.test(name) ||
    parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    fail('unsafe-entry');
  return name;
}
function extra(data: Buffer): void {
  for (let i = 0; i < data.length; ) {
    if (i + 4 > data.length) fail('invalid-zip');
    if (data.readUInt16LE(i) === 1) fail('zip64-unsupported');
    i += 4 + data.readUInt16LE(i + 2);
    if (i > data.length) fail('invalid-zip');
  }
}
function parseJar(data: Buffer): ModInfo {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('invalid-zip');
  const count = data.readUInt16LE(end + 10);
  const cdSize = data.readUInt32LE(end + 12);
  const cdStart = data.readUInt32LE(end + 16);
  if (
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdStart === 0xffffffff ||
    (end >= 20 && data.readUInt32LE(end - 20) === 0x07064b50)
  )
    fail('zip64-unsupported');
  if (
    data.readUInt16LE(end + 4) ||
    data.readUInt16LE(end + 6) ||
    data.readUInt16LE(end + 8) !== count ||
    cdStart + cdSize !== end
  )
    fail('invalid-zip');
  if (count > 10000 || cdSize > 8 * LIMIT) fail('limit-exceeded');
  let at = cdStart;
  const names = new Set<string>();
  const metadata = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) fail('invalid-zip');
    const nameLen = data.readUInt16LE(at + 28),
      extraLen = data.readUInt16LE(at + 30);
    const next = at + 46 + nameLen + extraLen + data.readUInt16LE(at + 32);
    if (next > end) fail('invalid-zip');
    const name = entryName(data.subarray(at + 46, at + 46 + nameLen));
    if (names.has(name)) fail('invalid-zip');
    names.add(name);
    extra(data.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen));
    const compressed = data.readUInt32LE(at + 20),
      size = data.readUInt32LE(at + 24),
      local = data.readUInt32LE(at + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff)
      fail('zip64-unsupported');
    if (data.readUInt16LE(at + 34) === 0xffff) fail('zip64-unsupported');
    if (data.readUInt16LE(at + 34) || ((data.readUInt32LE(at + 38) >>> 16) & 0xf000) === 0xa000)
      fail('unsafe-entry');
    if (local + 30 > cdStart || data.readUInt32LE(local) !== 0x04034b50) fail('invalid-zip');
    const localNameLen = data.readUInt16LE(local + 26),
      localExtraLen = data.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + localExtraLen;
    if (
      start + compressed > cdStart ||
      entryName(data.subarray(local + 30, local + 30 + localNameLen)) !== name
    )
      fail('invalid-zip');
    extra(data.subarray(local + 30 + localNameLen, start));
    const flags = data.readUInt16LE(at + 8),
      method = data.readUInt16LE(at + 10);
    if (flags !== data.readUInt16LE(local + 6) || method !== data.readUInt16LE(local + 8))
      fail('invalid-zip');
    if (name === FABRIC || name === NEOFORGE) {
      if (size > LIMIT || compressed > 2 * LIMIT) fail('limit-exceeded');
      if (flags & 1 || (method !== 0 && method !== 8)) fail('unsupported-compression');
      const bytes = data.subarray(start, start + compressed);
      let output: Buffer;
      try {
        output = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: LIMIT });
      } catch {
        return fail('invalid-zip');
      }
      if (output.length !== size || crc32(output) !== data.readUInt32LE(at + 16))
        fail('invalid-zip');
      try {
        metadata.set(name, new TextDecoder('utf8', { fatal: true }).decode(output));
      } catch {
        fail('invalid-metadata');
      }
    }
    at = next;
  }
  if (at !== end) fail('invalid-zip');
  if (metadata.size > 1) fail('invalid-metadata');
  try {
    if (metadata.has(FABRIC)) return fabric(metadata.get(FABRIC) ?? '');
    if (metadata.has(NEOFORGE)) return neoForge(metadata.get(NEOFORGE) ?? '');
  } catch (error) {
    if (error instanceof ModMetadataError) throw error;
    fail('invalid-metadata');
  }
  return fail('metadata-not-found');
}
/** Reads at most 64 MiB of compressed jar bytes. Async iterators are closed on limit failure. */
export async function readModMetadata(
  input: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<ModInfo> {
  let data: Buffer;
  if (input instanceof Uint8Array) {
    if (input.byteLength > JAR_LIMIT) fail('limit-exceeded');
    data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else {
    const chunks: Buffer[] = [];
    let size = 0;
    let count = 0;
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array)) fail('invalid-zip');
      if (++count > 100000) fail('limit-exceeded');
      size += chunk.byteLength;
      if (size > JAR_LIMIT) fail('limit-exceeded');
      chunks.push(Buffer.from(chunk));
    }
    data = Buffer.concat(chunks, size);
  }
  return parseJar(data);
}
