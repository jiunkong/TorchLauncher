/** Mojang's modern (1.21.1-first) metadata. No loader inheritance or legacy natives. */
export interface Platform {
  os: 'windows' | 'osx' | 'linux';
  arch: 'x64' | 'arm64';
  version: string;
}
export interface Download {
  url: string;
  sha1: string;
  size: number;
}
export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}
export type Argument = string | { rules: Rule[]; value: string[] };
export interface Version {
  id: string;
  type: string;
  mainClass: string;
  javaVersion: { component: string; majorVersion: number };
  downloads: { client: Download };
  assetIndex: Download & { id: string };
  libraries: { name: string; artifact: Download & { path: string }; rules?: Rule[] }[];
  arguments: { jvm: Argument[]; game: Argument[] };
  logging?: { file: Download & { id: string }; argument: string };
}
export type RuntimeEntry =
  | { type: 'file'; download: Download; executable: boolean }
  | { type: 'directory' }
  | { type: 'link'; target: string };

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected metadata object');
  }
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error('Expected nonempty metadata string');
  }
  return value;
}
export function integer(value: unknown, maximum = 512 * 1024 * 1024): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error('Invalid metadata size');
  }
  return value as number;
}
export function list(value: unknown, maximum = 100_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid metadata array');
  return value;
}
export function safePath(value: unknown): string {
  const path = string(value);
  if (
    path.length > 1024 ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\\:*?"<>|]/.test(part) ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
  )
    throw new Error(`Unsafe metadata path: ${path}`);
  return path;
}
export function sha1(value: unknown): string {
  const hash = string(value);
  if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('Invalid SHA-1');
  return hash;
}
export function download(value: unknown): Download {
  const data = object(value);
  const url = new URL(string(data.url));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Downloads require credential-free HTTPS URLs');
  }
  return { url: url.href, sha1: sha1(data.sha1), size: integer(data.size) };
}
export function parseRules(value: unknown): Rule[] {
  return list(value, 100).map((raw) => {
    const data = object(raw);
    if (data.action !== 'allow' && data.action !== 'disallow')
      throw new Error('Invalid rule action');
    const rule: Rule = { action: data.action };
    if (data.os !== undefined) {
      const os = object(data.os);
      rule.os = {};
      for (const key of ['name', 'arch', 'version'] as const) {
        if (os[key] !== undefined) rule.os[key] = string(os[key]);
      }
      if (rule.os.version) new RegExp(rule.os.version);
    }
    if (data.features !== undefined) {
      rule.features = {};
      for (const [key, enabled] of Object.entries(object(data.features))) {
        if (typeof enabled !== 'boolean') throw new Error('Invalid feature rule');
        rule.features[key] = enabled;
      }
    }
    return rule;
  });
}
export function allows(
  rules: Rule[] | undefined,
  platform: Platform,
  features: Record<string, boolean> = {},
): boolean {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    const os = rule.os;
    const arch = platform.arch === 'x64' ? 'x86_64' : 'aarch64';
    if (os?.name && os.name !== platform.os) continue;
    if (os?.arch && ![arch, platform.arch].includes(os.arch)) continue;
    if (os?.version && !new RegExp(os.version).test(platform.version)) continue;
    if (
      Object.entries(rule.features ?? {}).some(([key, value]) => (features[key] ?? false) !== value)
    )
      continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}
function argumentsList(value: unknown): Argument[] {
  return list(value, 1000).map((raw) => {
    if (typeof raw === 'string') return string(raw);
    const item = object(raw);
    return {
      rules: parseRules(item.rules),
      value:
        typeof item.value === 'string' ? [string(item.value)] : list(item.value, 100).map(string),
    };
  });
}
export function parseVersion(value: unknown): Version {
  const data = object(value);
  if (data.inheritsFrom || data.minecraftArguments)
    throw new Error('Unsupported legacy/inherited version');
  const java = object(data.javaVersion);
  const assets = object(data.assetIndex);
  const args = object(data.arguments);
  const version: Version = {
    id: safePath(data.id),
    type: string(data.type),
    mainClass: string(data.mainClass),
    javaVersion: {
      component: safePath(java.component),
      majorVersion: integer(java.majorVersion, 100),
    },
    downloads: { client: download(object(data.downloads).client) },
    assetIndex: { ...download(assets), id: safePath(assets.id) },
    arguments: { jvm: argumentsList(args.jvm), game: argumentsList(args.game) },
    libraries: list(data.libraries, 10_000).map((raw) => {
      const library = object(raw);
      if (library.natives || library.extract)
        throw new Error('Legacy native extraction is unsupported');
      const artifact = object(object(library.downloads).artifact);
      return {
        name: string(library.name),
        artifact: { ...download(artifact), path: safePath(artifact.path) },
        ...(library.rules === undefined ? {} : { rules: parseRules(library.rules) }),
      };
    }),
  };
  if (
    version.id.includes('/') ||
    version.assetIndex.id.includes('/') ||
    version.javaVersion.component.includes('/')
  ) {
    throw new Error('Invalid metadata identifier');
  }
  if (!/^[\w.$]+$/.test(version.mainClass)) throw new Error('Invalid main class');
  if (data.logging) {
    const logging = object(object(data.logging).client);
    const file = object(logging.file);
    version.logging = {
      file: { ...download(file), id: safePath(file.id) },
      argument: string(logging.argument),
    };
    if (version.logging.file.id.includes('/'))
      throw new Error('Invalid log configuration identifier');
  }
  return version;
}
export function runtimePlatform(platform: Platform): string {
  if (
    !['windows', 'osx', 'linux'].includes(platform.os) ||
    !['x64', 'arm64'].includes(platform.arch)
  ) {
    throw new Error('Unsupported Minecraft operating system or architecture');
  }
  if (platform.os === 'linux') {
    if (platform.arch !== 'x64') throw new Error('Mojang provides no Linux ARM64 Java runtime');
    return 'linux';
  }
  if (platform.os === 'osx') return platform.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return platform.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
}
export function parseRuntime(value: unknown): Record<string, RuntimeEntry> {
  const files = Object.entries(object(object(value).files));
  if (files.length > 10_000) throw new Error('Too many runtime entries');
  const result: Record<string, RuntimeEntry> = Object.create(null);
  const seen = new Set<string>();
  for (const [path, raw] of files) {
    safePath(path);
    if (seen.has(path.toLowerCase())) throw new Error('Conflicting runtime paths');
    seen.add(path.toLowerCase());
    const entry = object(raw);
    if (entry.type === 'directory') result[path] = { type: 'directory' };
    else if (entry.type === 'link') result[path] = { type: 'link', target: string(entry.target) };
    else if (entry.type === 'file' && typeof entry.executable === 'boolean') {
      result[path] = {
        type: 'file',
        executable: entry.executable,
        download: download(object(entry.downloads).raw),
      };
    } else throw new Error('Invalid runtime entry');
  }
  return result;
}
