import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  buildSettingsPolicy,
  classifyOptionKey,
  IRIS_CONFIG_PATH,
  OPTIONS_PROFILES,
  parsePropertiesEntries,
  SETTINGS_LIMITS,
  SETTINGS_POLICY_PATH,
  SettingsError,
  shaderSelectionToConfigFiles,
  validConfigPath,
} from '../../../../packages/core/src/instance/settings/index.js';
import {
  validOptionKey,
  validOptionValue,
} from '../../../../packages/core/src/instance/settings/policy.js';
import {
  type PackKind,
  type SettingPolicyChoice,
  type SettingValueType,
  type StudioConfigFile,
  type StudioConfigItem,
  type StudioGameOption,
  type StudioGameSettings,
  type StudioPack,
  type StudioPresetPreview,
  type StudioShaderSettings,
  shaderConfigPaths,
} from '../shared/studio.js';
import { noLinks, safeRead } from './filesystem.js';
import { PolicyFailure, StudioFailure } from './project.js';
import { hashFile } from './scan.js';

/*
 * Game settings preset.
 *
 * Everything that talks to the settings policy format lives here: option parsing, config file
 * import, and policy generation through core's `buildSettingsPolicy` (options.txt items, resource
 * pack lists, mod config files and Iris/Oculus shader settings in one policy format).
 */
export { PolicyFailure, SETTINGS_POLICY_PATH };
export const OPTIONS_READ_LIMIT = SETTINGS_LIMITS.optionsBytes;
export const PACK_LIMIT = 256 * 1024 ** 2;
export const PACK_DIRECTORY: Record<PackKind, string> = {
  resourcepack: 'resourcepacks',
  shaderpack: 'shaderpacks',
};
export const MAX_OPTIONS = 2000;
export const MAX_PACKS = SETTINGS_LIMITS.packsPerList;
/** Keys that the game or the resource pack list own; they never become option items. */
const GAME_OWNED = new Set(['version', 'resourcePacks', 'incompatibleResourcePacks']);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isReservedPath(path: string): boolean {
  return (
    path === 'options.txt' ||
    path === SETTINGS_POLICY_PATH ||
    path.startsWith('resourcepacks/') ||
    path.startsWith('shaderpacks/')
  );
}
/** Paths the build plan takes from game settings instead of the file list. */
export function isPlanReserved(path: string): boolean {
  return path === 'options.txt' || path === SETTINGS_POLICY_PATH;
}
export function validatePackName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !/^[\p{L}\p{N}][\p{L}\p{N} _.()+\-[\]]{0,98}\.zip$/u.test(name) ||
    name.normalize('NFC') !== name ||
    name.includes('..') ||
    / \.zip$/i.test(name) ||
    WINDOWS_RESERVED.test(name) ||
    Buffer.byteLength(name) > 120
  )
    throw new StudioFailure('INVALID');
}
export const packId = (name: string) => `file/${name}`;

const valueTypeOf = (value: string): SettingValueType =>
  value === 'true' || value === 'false'
    ? 'boolean'
    : /^-?[0-9]+(\.[0-9]+)?$/.test(value)
      ? 'number'
      : value.startsWith('[') || value.startsWith('{')
        ? 'json'
        : 'text';
export function parseOptionsText(buffer: Buffer): { entries: StudioGameOption[]; ignored: number } {
  if (buffer.length > OPTIONS_READ_LIMIT) throw new StudioFailure('TOO_LARGE');
  if (buffer.includes(0)) throw new StudioFailure('INVALID');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw new StudioFailure('INVALID');
  }
  const entries: StudioGameOption[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    const key = colon > 0 ? line.slice(0, colon) : '';
    const value = colon > 0 ? line.slice(colon + 1) : '';
    if (
      !key ||
      !validOptionKey(key) ||
      !validOptionValue(value) ||
      GAME_OWNED.has(key) ||
      seen.has(key) ||
      entries.length >= MAX_OPTIONS
    ) {
      ignored++;
      continue;
    }
    seen.add(key);
    const { kind, group } = classifyOptionKey(key);
    entries.push({ key, value, policy: 'none', kind, group, valueType: valueTypeOf(value) });
  }
  return { entries, ignored };
}
/** Imported items replace the list; policies of items that remain are kept, set ones that vanished too. */
export function mergeOptions<T extends { key: string; policy: SettingPolicyChoice }>(
  current: readonly T[],
  imported: readonly T[],
): T[] {
  const old = new Map(current.map((o) => [o.key, o]));
  const merged = imported.map((o) => ({ ...o, policy: old.get(o.key)?.policy ?? 'none' }));
  const keys = new Set(imported.map((o) => o.key));
  for (const o of current) if (o.policy !== 'none' && !keys.has(o.key)) merged.push({ ...o });
  return merged.slice(0, MAX_OPTIONS);
}
export function emptySettings(): StudioGameSettings {
  return { options: [], resourcePacks: [], shaderPacks: [] };
}
export function defaultShader(): StudioShaderSettings {
  return {
    configPath: IRIS_CONFIG_PATH as StudioShaderSettings['configPath'],
    enabled: { policy: 'none', value: false },
    pack: { policy: 'none', value: '' },
    packOptions: [],
  };
}
const CHOICES: readonly string[] = ['none', 'initial', 'required'];
const VALUE_TYPES: readonly string[] = ['boolean', 'number', 'json', 'text'];
export const MAX_CONFIG_FILES = SETTINGS_LIMITS.configFiles;
export const MAX_ITEMS_PER_FILE = SETTINGS_LIMITS.keysPerMap;
/** Paths the shader model owns; they never appear as generic config files. */
export const isShaderConfigPath = (path: string) =>
  (shaderConfigPaths as readonly string[]).includes(path);
export function validGenericConfigPath(path: unknown): path is string {
  return (
    validConfigPath(path) &&
    path.startsWith('config/') &&
    !isShaderConfigPath(path) &&
    path.toLowerCase() !== 'config/'
  );
}
function parseItems(list: unknown, shape: 'option' | 'config'): void {
  const fail: () => never = () => {
    throw new StudioFailure('INVALID');
  };
  if (!Array.isArray(list) || list.length > (shape === 'option' ? MAX_OPTIONS : MAX_ITEMS_PER_FILE))
    fail();
  const keys = new Set<string>();
  for (const o of list as unknown[]) {
    const e = o as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail();
    const allowed =
      shape === 'option'
        ? ['key', 'value', 'policy', 'kind', 'group', 'valueType']
        : ['key', 'value', 'policy', 'valueType'];
    if (
      Object.keys(e).some((k) => !allowed.includes(k)) ||
      !('key' in e && 'value' in e && 'policy' in e) ||
      typeof e.key !== 'string' ||
      typeof e.value !== 'string' ||
      !validOptionKey(e.key) ||
      (shape === 'option' && GAME_OWNED.has(e.key)) ||
      !validOptionValue(e.value) ||
      !CHOICES.includes(e.policy as string) ||
      keys.has(e.key) ||
      (e.valueType !== undefined && !VALUE_TYPES.includes(e.valueType as string)) ||
      (e.kind !== undefined && !['keybind', 'mod-keybind', 'other'].includes(e.kind as string)) ||
      (e.group !== undefined && (typeof e.group !== 'string' || e.group.length > 128))
    )
      fail();
    keys.add(e.key);
  }
}
export function parseGameSettings(input: unknown): StudioGameSettings {
  const fail = (): never => {
    throw new StudioFailure('INVALID');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const g = input as Record<string, unknown>;
  const required = ['options', 'resourcePacks', 'shaderPacks'];
  if (
    Object.keys(g).some((k) => ![...required, 'configFiles', 'shader'].includes(k)) ||
    required.some((k) => !Object.hasOwn(g, k)) ||
    !Array.isArray(g.resourcePacks) ||
    !Array.isArray(g.shaderPacks) ||
    g.resourcePacks.length > MAX_PACKS ||
    g.shaderPacks.length > MAX_PACKS
  )
    return fail();
  parseItems(g.options, 'option');
  for (const list of [g.resourcePacks, g.shaderPacks] as unknown[][]) {
    const names = new Set<string>();
    for (const p of list) {
      const e = p as Record<string, unknown>;
      if (
        !e ||
        typeof e !== 'object' ||
        Object.keys(e).sort().join(',') !== 'length,name,policy,sha256' ||
        !CHOICES.includes(e.policy as string) ||
        typeof e.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(e.sha256) ||
        !Number.isSafeInteger(e.length) ||
        (e.length as number) < 0 ||
        (e.length as number) > PACK_LIMIT
      )
        return fail();
      validatePackName(e.name);
      if (names.has((e.name as string).toLowerCase())) return fail();
      names.add((e.name as string).toLowerCase());
    }
  }
  if (Object.hasOwn(g, 'configFiles')) {
    if (!Array.isArray(g.configFiles) || g.configFiles.length > MAX_CONFIG_FILES) return fail();
    const paths = new Set<string>();
    for (const f of g.configFiles as unknown[]) {
      const e = f as Record<string, unknown>;
      if (
        !e ||
        typeof e !== 'object' ||
        Object.keys(e).sort().join(',') !== 'items,path' ||
        !validGenericConfigPath(e.path) ||
        paths.has((e.path as string).toLowerCase())
      )
        return fail();
      paths.add((e.path as string).toLowerCase());
      parseItems(e.items, 'config');
    }
  }
  if (Object.hasOwn(g, 'shader')) {
    const e = g.shader as Record<string, unknown>;
    const flag = e?.enabled as Record<string, unknown> | undefined;
    const pack = e?.pack as Record<string, unknown> | undefined;
    if (
      !e ||
      typeof e !== 'object' ||
      Object.keys(e).sort().join(',') !== 'configPath,enabled,pack,packOptions' ||
      !isShaderConfigPath(e.configPath as string) ||
      !flag ||
      Object.keys(flag).sort().join(',') !== 'policy,value' ||
      !CHOICES.includes(flag.policy as string) ||
      typeof flag.value !== 'boolean' ||
      !pack ||
      Object.keys(pack).sort().join(',') !== 'policy,value' ||
      !CHOICES.includes(pack.policy as string) ||
      typeof pack.value !== 'string' ||
      pack.value.length > SETTINGS_LIMITS.valueLength ||
      !Array.isArray(e.packOptions) ||
      e.packOptions.length > MAX_CONFIG_FILES
    )
      return fail();
    const names = new Set<string>();
    for (const o of e.packOptions as unknown[]) {
      const f = o as Record<string, unknown>;
      if (
        !f ||
        typeof f !== 'object' ||
        Object.keys(f).sort().join(',') !== 'items,pack' ||
        !validPackOptionsName(f.pack) ||
        names.has((f.pack as string).toLowerCase())
      )
        return fail();
      names.add((f.pack as string).toLowerCase());
      parseItems(f.items, 'config');
    }
  }
  return structuredClone(g) as unknown as StudioGameSettings;
}
export const validPackOptionsName = (pack: unknown): pack is string =>
  typeof pack === 'string' && validConfigPath(`shaderpacks/${pack}.txt`);

export interface GeneratedPolicy {
  text: string;
  configFiles: number;
  bytes: number;
}
const knownProfileVersion = (version: string) =>
  OPTIONS_PROFILES.some((p) => p.minecraftVersions.includes(version));
const toChoice = (policy: SettingPolicyChoice): 'unset' | 'initial' | 'required' =>
  policy === 'none' ? 'unset' : policy;
const choices = (items: readonly { key: string; value: string; policy: SettingPolicyChoice }[]) =>
  items.map((i) => ({ key: i.key, value: i.value, state: toChoice(i.policy) }));
/** Config file paths whose items the policy manages (generic files, the shader file, pack options). */
export function policyConfigPaths(settings: StudioGameSettings): string[] {
  const paths: string[] = [];
  for (const f of settings.configFiles ?? [])
    if (f.items.some((i) => i.policy !== 'none')) paths.push(f.path);
  const shader = settings.shader;
  if (shader) {
    if (shader.enabled.policy !== 'none' || shader.pack.policy !== 'none')
      paths.push(shader.configPath);
    for (const o of shader.packOptions)
      if (o.items.some((i) => i.policy !== 'none')) paths.push(`shaderpacks/${o.pack}.txt`);
  }
  return paths;
}
/**
 * The `settings-policy.json` for the preset, or null when nothing is set. Version 1 unless a
 * config file item is set (then 2, which launchers without v2 reject). Throws PolicyFailure.
 */
export function generatePolicy(
  settings: StudioGameSettings,
  minecraftVersion?: string,
): GeneratedPolicy | null {
  const ids = (policy: SettingPolicyChoice) =>
    settings.resourcePacks.filter((p) => p.policy === policy).map((p) => packId(p.name));
  const shader = settings.shader;
  const configFiles = [
    ...(settings.configFiles ?? []).map((f) => ({ path: f.path, items: choices(f.items) })),
    ...(shader
      ? shaderSelectionToConfigFiles({
          configPath: shader.configPath,
          enabled: { state: toChoice(shader.enabled.policy), value: shader.enabled.value },
          pack: { state: toChoice(shader.pack.policy), value: shader.pack.value },
          packOptions: shader.packOptions.map((o) => ({ pack: o.pack, items: choices(o.items) })),
        })
      : []),
  ];
  const anything =
    settings.options.some((o) => o.policy !== 'none') ||
    ids('required').length > 0 ||
    ids('initial').length > 0 ||
    policyConfigPaths(settings).length > 0;
  if (!anything) return null;
  try {
    const built = buildSettingsPolicy({
      options: choices(settings.options),
      resourcePacks: { required: ids('required'), initial: ids('initial') },
      configFiles,
      ...(minecraftVersion && knownProfileVersion(minecraftVersion) ? { minecraftVersion } : {}),
    });
    return {
      text: built.json,
      configFiles: built.policy.configFiles.length,
      bytes: built.bytes.length,
    };
  } catch (error) {
    if (error instanceof SettingsError) throw new PolicyFailure(error.code, error.message);
    throw error;
  }
}
/** Applies `changes` to config items. Unknown keys are created (they need a valid `value`). */
export function applyConfigChanges(
  items: StudioConfigItem[],
  changes: readonly { key: string; policy: SettingPolicyChoice; value?: string }[],
): void {
  for (const change of changes) {
    const existing = items.find((i) => i.key === change.key);
    if (change.value !== undefined && !validOptionValue(change.value))
      throw new StudioFailure('INVALID');
    if (existing) {
      existing.policy = change.policy;
      if (change.value !== undefined) {
        existing.value = change.value;
        existing.valueType = valueTypeOf(change.value);
      }
    } else {
      if (change.value === undefined || !validOptionKey(change.key))
        throw new StudioFailure('INVALID');
      items.push({
        key: change.key,
        value: change.value,
        policy: change.policy,
        valueType: valueTypeOf(change.value),
      });
    }
  }
  if (items.length > MAX_ITEMS_PER_FILE) throw new StudioFailure('TOO_LARGE');
}

export interface PresetImport {
  entries: StudioGameOption[];
  preview: StudioPresetPreview;
  configFiles: StudioConfigFile[];
  shader: {
    configPath: StudioShaderSettings['configPath'];
    enabled: boolean | null;
    pack: string | null;
    packOptions: { pack: string; items: StudioConfigItem[] }[];
  } | null;
}
type SkipReason = StudioPresetPreview['skippedConfigs'][number]['reason'];
async function readProperties(
  folder: string,
  rel: string,
): Promise<StudioConfigItem[] | SkipReason> {
  try {
    const bytes = await safeRead(join(folder, rel), SETTINGS_LIMITS.configBytes);
    const items: StudioConfigItem[] = [];
    for (const e of parsePropertiesEntries(bytes))
      if (validOptionKey(e.key) && validOptionValue(e.value))
        items.push({ key: e.key, value: e.value, policy: 'none', valueType: e.valueType });
    return items.length > MAX_ITEMS_PER_FILE ? 'limit-exceeded' : items;
  } catch (error) {
    if (error instanceof StudioFailure)
      return error.code === 'TOO_LARGE' ? 'limit-exceeded' : 'unsafe-path';
    if (error instanceof SettingsError)
      return error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-config';
    return 'unsafe-path';
  }
}
/** Reads options.txt (and, from a game folder, mod config and shader files) with size and name checks. */
export async function readPreset(
  path: string,
  source: 'folder' | 'file',
  allowMissingOptions = false,
): Promise<PresetImport> {
  let file = path;
  let folder: string | null = null;
  if (source === 'folder') {
    await noLinks(path);
    if (!(await lstat(path)).isDirectory()) throw new StudioFailure('INVALID');
    folder = path;
    file = join(path, 'options.txt');
  } else if (basename(path) !== 'options.txt') throw new StudioFailure('INVALID');
  let options: Buffer;
  try {
    options = await safeRead(file, OPTIONS_READ_LIMIT);
  } catch (error) {
    if (!allowMissingOptions || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    options = Buffer.alloc(0);
  }
  const { entries, ignored } = parseOptionsText(options);
  const contents = folder
    ? await readPresetConfigs(folder)
    : {
        configFiles: [],
        shader: null,
        preview: {
          source: 'file' as const,
          optionCount: 0,
          ignored: 0,
          detected: { modConfigs: [], resourcePacks: [], shaderPacks: [] },
          importedConfigs: [],
          skippedConfigs: [],
          shader: null,
        },
      };
  return {
    ...contents,
    entries,
    preview: { ...contents.preview, optionCount: entries.length, ignored },
  };
}

/** Reads only bounded config/pack metadata; malformed or missing options.txt cannot block it. */
export async function readPresetConfigs(folder: string): Promise<Omit<PresetImport, 'entries'>> {
  await noLinks(folder);
  if (!(await lstat(folder)).isDirectory()) throw new StudioFailure('INVALID');
  const detected = {
    modConfigs: [] as string[],
    resourcePacks: [] as string[],
    shaderPacks: [] as string[],
  };
  const configFiles: StudioConfigFile[] = [];
  const skipped: StudioPresetPreview['skippedConfigs'] = [];
  let shader: PresetImport['shader'] = null;
  const packOptionFiles: string[] = [];
  let configFound = false;
  {
    const root = folder;
    const list = async (sub: string, filter: RegExp, recursive = false) => {
      const names: string[] = [];
      let visited = 0;
      const walk = async (prefix: string, depth: number): Promise<void> => {
        if (++visited > 256 || names.length >= 200) return;
        const dir = join(root, sub, prefix);
        try {
          await noLinks(dir);
          const found = await readdir(dir, { withFileTypes: true });
          found.sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of found) {
            if (names.length >= 200) break;
            if (entry.isSymbolicLink()) continue;
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory() && recursive && depth < 8) await walk(path, depth + 1);
            else if (entry.isFile() && filter.test(entry.name)) names.push(path);
          }
        } catch {
          /* Missing or unsafe directories are not followed. */
        }
      };
      await walk('', 0);
      return names.sort();
    };
    detected.modConfigs = await list(
      'config',
      /\.(?:toml|json5?|properties|cfg|txt|yaml|yml)$/i,
      true,
    );
    detected.resourcePacks = await list('resourcepacks', /\.zip$/i);
    detected.shaderPacks = await list('shaderpacks', /\.zip$/i);
    for (const name of detected.modConfigs) {
      const rel = `config/${name}`;
      if (isShaderConfigPath(rel)) continue;
      if (!/\.(?:properties|txt)$/i.test(name)) skipped.push({ path: rel, reason: 'unsupported' });
      else if (!validGenericConfigPath(rel)) skipped.push({ path: rel, reason: 'unsafe-path' });
      else if (configFiles.length >= MAX_CONFIG_FILES - 8)
        skipped.push({ path: rel, reason: 'limit-exceeded' });
      else {
        const items = await readProperties(root, rel);
        if (typeof items === 'string') skipped.push({ path: rel, reason: items });
        else configFiles.push({ path: rel, items });
      }
    }
    for (const configPath of shaderConfigPaths) {
      if (!detected.modConfigs.includes(configPath.slice('config/'.length))) continue;
      const items = await readProperties(root, configPath);
      if (typeof items === 'string') {
        skipped.push({ path: configPath, reason: items });
        continue;
      }
      configFound = true;
      shader = {
        configPath,
        enabled:
          items.find((i) => i.key === 'enableShaders')?.value === 'true'
            ? true
            : items.some((i) => i.key === 'enableShaders')
              ? false
              : null,
        pack: items.find((i) => i.key === 'shaderPack')?.value ?? null,
        packOptions: [],
      };
      break;
    }
    for (const name of await list('shaderpacks', /\.txt$/i)) {
      const pack = name.slice(0, -'.txt'.length);
      const rel = `shaderpacks/${name}`;
      if (!validPackOptionsName(pack) || packOptionFiles.length >= 8) {
        skipped.push({
          path: rel,
          reason: validPackOptionsName(pack) ? 'limit-exceeded' : 'unsafe-path',
        });
        continue;
      }
      const items = await readProperties(root, rel);
      if (typeof items === 'string') {
        skipped.push({ path: rel, reason: items });
        continue;
      }
      packOptionFiles.push(rel);
      shader ??= {
        configPath: IRIS_CONFIG_PATH as StudioShaderSettings['configPath'],
        enabled: null,
        pack: null,
        packOptions: [],
      };
      shader.packOptions.push({ pack, items });
    }
  }
  return {
    configFiles,
    shader,
    preview: {
      source: 'folder',
      optionCount: 0,
      ignored: 0,
      detected,
      importedConfigs: configFiles.map((f) => f.path),
      skippedConfigs: skipped,
      shader: shader
        ? { configPath: configFound ? shader.configPath : null, packOptionFiles }
        : null,
    },
  };
}

/**
 * Makes `<sourceRoot>/<resourcepacks|shaderpacks>/<name>` hold the chosen zip and returns its
 * metadata. A file already at that place is used in place; otherwise the pack is copied there
 * (never over an existing different file). The zip signature, name and size are validated.
 */
export async function addPack(
  sourceRoot: string,
  kind: PackKind,
  picked: string,
  signal: AbortSignal,
): Promise<StudioPack> {
  const name = basename(picked);
  validatePackName(name);
  await noLinks(picked);
  const directory = join(sourceRoot, PACK_DIRECTORY[kind]);
  await noLinks(sourceRoot);
  const target = join(directory, name);
  let inPlace = false;
  try {
    inPlace =
      (await realpath(picked)) === join(await realpath(sourceRoot), PACK_DIRECTORY[kind], name);
  } catch {
    inPlace = false;
  }
  const verify = async (path: string): Promise<StudioPack> => {
    const head = Buffer.alloc(4);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const { bytesRead } = await handle.read(head, 0, 4, 0);
      const magic = head.toString('hex');
      if (bytesRead < 4 || (magic !== '504b0304' && magic !== '504b0506'))
        throw new StudioFailure('INVALID');
    } finally {
      await handle.close();
    }
    const { sha256, size } = await hashFile(path, PACK_LIMIT, signal);
    return { name, sha256, length: size, policy: 'none' };
  };
  if (inPlace) return verify(picked);
  const pack = await verify(picked);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await noLinks(directory);
  const temporary = join(directory, `.torchstudio-${randomUUID()}.tmp`);
  const input = await open(picked, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const out = await open(temporary, 'wx', 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        signal.throwIfAborted();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        if (position + bytesRead > PACK_LIMIT) throw new StudioFailure('TOO_LARGE');
        await out.write(buffer, 0, bytesRead, position);
        position += bytesRead;
      }
      if (position !== pack.length) throw new StudioFailure('IO');
      await out.sync();
    } finally {
      await out.close();
    }
    const copy = await hashFile(temporary, PACK_LIMIT, signal);
    if (copy.sha256 !== pack.sha256) throw new StudioFailure('IO');
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const existing = await hashFile(target, PACK_LIMIT, signal);
        if (existing.sha256 !== pack.sha256) throw new StudioFailure('INVALID');
      } else {
        // File systems without hard links: fall back to a rename, still never over an existing file.
        try {
          await lstat(target);
          throw new StudioFailure('INVALID');
        } catch (inner) {
          if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') throw inner;
        }
        await rename(temporary, target);
      }
    }
  } finally {
    await input.close();
    await rm(temporary, { force: true });
  }
  return pack;
}

/** Writes the generated policy into the source folder (atomically, never through links). */
export async function writeGeneratedPolicy(sourceRoot: string, text: string): Promise<void> {
  await noLinks(sourceRoot);
  const directory = join(sourceRoot, 'torchlauncher');
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await noLinks(directory);
  const target = join(sourceRoot, SETTINGS_POLICY_PATH);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new StudioFailure('INVALID');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(directory, `.torchstudio-${randomUUID()}.tmp`);
  const out = await open(temporary, 'wx', 0o644);
  try {
    await out.writeFile(text, 'utf8');
    await out.sync();
  } finally {
    await out.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
