import { join } from 'node:path';
import type { Installation } from '../minecraft/installer';
import {
  allows,
  list,
  object,
  parseVersion,
  safePath,
  string,
  type Version,
} from '../minecraft/metadata';

export interface LoaderSelection {
  kind: 'neoforge' | 'fabric';
  version: string;
}
export interface LoaderLibrary {
  name: string;
  path: string;
  url: string;
  sha1?: string;
  sha256?: string;
  size?: number;
  raw: Record<string, unknown>;
}
export function exactSelection(selection: LoaderSelection): void {
  if (
    !['neoforge', 'fabric'].includes(selection.kind) ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(selection.version)
  )
    throw new Error('Unsupported exact loader selection');
}
export function maven(name: string): { path: string; key: string } {
  const match =
    /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)(?::([A-Za-z0-9_.+-]+))?$/.exec(name);
  if (!match) throw new Error('Invalid Maven coordinate');
  const [, group, artifact, version, classifier] = match;
  if (!group || !artifact || !version) throw new Error('Invalid Maven coordinate');
  const path = safePath(
    `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`,
  );
  return { path, key: `${group}:${artifact}:${classifier ?? ''}` };
}
export function https(value: unknown): string {
  const url = new URL(string(value));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Unsafe loader URL');
  return url.href;
}
export function inspectProfile(
  raw: unknown,
  base: Installation,
  selection: LoaderSelection,
): { data: Record<string, unknown>; libraries: LoaderLibrary[]; version: Version } {
  exactSelection(selection);
  if (base.version.id !== '1.21.1')
    throw new Error('Only Minecraft 1.21.1 loader installation is supported');
  const data = object(raw);
  const expectedId =
    selection.kind === 'fabric'
      ? `fabric-loader-${selection.version}-1.21.1`
      : `neoforge-${selection.version}`;
  if (
    data.id !== expectedId ||
    data.inheritsFrom !== base.version.id ||
    data.minecraftArguments ||
    data.jar
  )
    throw new Error('Incompatible loader profile');
  const keys = new Set<string>();
  const libraries = list(data.libraries, 1000).map((value): LoaderLibrary => {
    const entry = object(value);
    const name = string(entry.name);
    const coordinate = maven(name);
    if (keys.has(coordinate.key)) throw new Error('Conflicting loader library versions');
    keys.add(coordinate.key);
    const artifact = entry.downloads ? object(object(entry.downloads).artifact) : entry;
    if (artifact.path !== undefined && artifact.path !== coordinate.path)
      throw new Error('Maven artifact path mismatch');
    const url = entry.downloads
      ? https(artifact.url)
      : new URL(coordinate.path, https(entry.url)).href;
    const library: LoaderLibrary = { name, path: coordinate.path, url, raw: entry };
    for (const algorithm of ['sha1', 'sha256'] as const) {
      if (artifact[algorithm] !== undefined) {
        const hash = string(artifact[algorithm]);
        if (!(algorithm === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(hash))
          throw new Error('Invalid loader digest');
        library[algorithm] = hash;
      }
    }
    if (artifact.size !== undefined) {
      const size = artifact.size;
      if (
        !Number.isSafeInteger(size) ||
        (size as number) < 1 ||
        (size as number) > 64 * 1024 * 1024
      )
        throw new Error('Invalid loader size');
      library.size = size as number;
    }
    return library;
  });
  // parseVersion supplies the common argument/rule validation after deliberately resolving inheritance.
  const replacements = new Map(libraries.map((library) => [maven(library.name).key, library]));
  const merged = base.version.libraries
    .filter((library) => !replacements.has(maven(library.name).key))
    .map((library) => ({
      name: library.name,
      downloads: { artifact: library.artifact },
      ...(library.rules ? { rules: library.rules } : {}),
    }));
  for (const library of libraries)
    merged.push({
      ...library.raw,
      downloads: {
        artifact: {
          path: library.path,
          url: library.url,
          sha1: library.sha1 ?? '0'.repeat(40),
          size: library.size ?? 1,
        },
      },
    } as (typeof merged)[number]);
  const args = object(data.arguments);
  const toRaw = (values: Version['arguments']['jvm']) => values.map((value) => value);
  const normalized = {
    ...base.version,
    id: expectedId,
    mainClass: data.mainClass,
    libraries: merged,
    arguments: {
      jvm: [...toRaw(base.version.arguments.jvm), ...list(args.jvm ?? [], 1000)],
      game: [...toRaw(base.version.arguments.game), ...list(args.game ?? [], 1000)],
    },
    logging: base.version.logging
      ? { client: { file: base.version.logging.file, argument: base.version.logging.argument } }
      : undefined,
  };
  return { data, libraries, version: parseVersion(normalized) };
}
export function loaderInstallation(
  base: Installation,
  selection: LoaderSelection,
  profile: unknown,
  tree: string,
): Installation {
  const parsed = inspectProfile(profile, base, selection);
  const overrides = new Set(parsed.libraries.map((library) => maven(library.name).key));
  const classpath = parsed.version.libraries
    .filter((library) => allows(library.rules, base.platform))
    .map((library) =>
      join(
        overrides.has(maven(library.name).key) ? tree : base.root,
        'libraries',
        library.artifact.path,
      ),
    );
  classpath.push(join(base.root, 'versions', base.version.id, `${base.version.id}.jar`));
  return {
    ...base,
    version: parsed.version,
    classpath,
    libraryDirectory: join(tree, 'libraries'),
    loader: { ...selection, minecraftVersion: base.version.id },
  };
}
