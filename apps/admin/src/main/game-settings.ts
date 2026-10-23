import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  parseSettingsPolicy,
  SETTINGS_LIMITS,
  SETTINGS_POLICY_PATH,
} from '../../../../packages/core/src/instance/settings/index.js';
import {
  validOptionKey,
  validOptionValue,
} from '../../../../packages/core/src/instance/settings/policy.js';
import type {
  PackKind,
  SettingPolicyChoice,
  StudioGameOption,
  StudioGameSettings,
  StudioPack,
  StudioPresetPreview,
} from '../shared/studio.js';
import { noLinks, safeRead } from './filesystem.js';
import { StudioFailure } from './project.js';
import { hashFile } from './scan.js';

/*
 * Game settings preset.
 *
 * Everything that talks to the settings policy format lives here, behind three functions
 * (parseOptionsText, generatePolicy, packId). It is written against the core v1 policy API
 * (options.txt keys, resource pack lists). Shader selection and mod config items need the
 * SET-CORE-01 extension and are not generated yet.
 */
export { SETTINGS_POLICY_PATH };
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
    entries.push({ key, value, policy: 'none' });
  }
  return { entries, ignored };
}
/** Imported entries replace the list; policies of keys that remain are kept, set ones that vanished too. */
export function mergeOptions(
  current: readonly StudioGameOption[],
  imported: readonly StudioGameOption[],
): StudioGameOption[] {
  const old = new Map(current.map((o) => [o.key, o]));
  const merged = imported.map((o) => ({ ...o, policy: old.get(o.key)?.policy ?? 'none' }));
  const keys = new Set(imported.map((o) => o.key));
  for (const o of current) if (o.policy !== 'none' && !keys.has(o.key)) merged.push({ ...o });
  return merged.slice(0, MAX_OPTIONS);
}
export function emptySettings(): StudioGameSettings {
  return { options: [], resourcePacks: [], shaderPacks: [] };
}
const CHOICES: readonly string[] = ['none', 'initial', 'required'];
export function parseGameSettings(input: unknown): StudioGameSettings {
  const fail = (): never => {
    throw new StudioFailure('INVALID');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const g = input as Record<string, unknown>;
  if (
    Object.keys(g).sort().join(',') !== 'options,resourcePacks,shaderPacks' ||
    !Array.isArray(g.options) ||
    g.options.length > MAX_OPTIONS ||
    !Array.isArray(g.resourcePacks) ||
    !Array.isArray(g.shaderPacks) ||
    g.resourcePacks.length > MAX_PACKS ||
    g.shaderPacks.length > MAX_PACKS
  )
    return fail();
  const keys = new Set<string>();
  for (const o of g.options as unknown[]) {
    const e = o as Record<string, unknown>;
    if (
      !e ||
      typeof e !== 'object' ||
      Object.keys(e).sort().join(',') !== 'key,policy,value' ||
      typeof e.key !== 'string' ||
      typeof e.value !== 'string' ||
      !validOptionKey(e.key) ||
      GAME_OWNED.has(e.key) ||
      !validOptionValue(e.value) ||
      !CHOICES.includes(e.policy as string) ||
      keys.has(e.key)
    )
      return fail();
    keys.add(e.key);
  }
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
  try {
    generatePolicy(g as unknown as StudioGameSettings);
  } catch {
    return fail();
  }
  return structuredClone(g) as unknown as StudioGameSettings;
}
/** The `settings-policy.json` text for the preset, or null when nothing is set. Validated by core. */
export function generatePolicy(settings: StudioGameSettings): string | null {
  const required: Record<string, string> = {};
  const initial: Record<string, string> = {};
  for (const o of settings.options) {
    if (o.policy === 'required') required[o.key] = o.value;
    else if (o.policy === 'initial') initial[o.key] = o.value;
  }
  const ids = (policy: SettingPolicyChoice) =>
    settings.resourcePacks.filter((p) => p.policy === policy).map((p) => packId(p.name));
  const packs = { required: ids('required'), initial: ids('initial') };
  if (
    !Object.keys(required).length &&
    !Object.keys(initial).length &&
    !packs.required.length &&
    !packs.initial.length
  )
    return null;
  const policy = {
    version: 1,
    file: 'options.txt',
    required,
    initial,
    resourcePacks: packs,
  };
  const text = `${JSON.stringify(policy, null, 2)}\n`;
  try {
    parseSettingsPolicy(Buffer.from(text));
  } catch {
    throw new StudioFailure('INVALID');
  }
  return text;
}
export function countPolicies(settings: StudioGameSettings): number {
  return settings.options.filter((o) => o.policy !== 'none').length;
}

/** Reads options.txt from a chosen file (named options.txt) or game folder, with size and name checks. */
export async function readPreset(
  path: string,
  source: 'folder' | 'file',
): Promise<{ entries: StudioGameOption[]; preview: StudioPresetPreview }> {
  let file = path;
  let folder: string | null = null;
  if (source === 'folder') {
    await noLinks(path);
    if (!(await lstat(path)).isDirectory()) throw new StudioFailure('INVALID');
    folder = path;
    file = join(path, 'options.txt');
  } else if (basename(path) !== 'options.txt') throw new StudioFailure('INVALID');
  const { entries, ignored } = parseOptionsText(await safeRead(file, OPTIONS_READ_LIMIT));
  const detected = {
    modConfigs: [] as string[],
    resourcePacks: [] as string[],
    shaderPacks: [] as string[],
  };
  if (folder) {
    const list = async (sub: string, filter: RegExp) => {
      try {
        const dir = join(folder as string, sub);
        await noLinks(dir);
        const found = await readdir(dir, { withFileTypes: true });
        return found
          .filter((e) => e.isFile() && filter.test(e.name))
          .map((e) => e.name)
          .sort()
          .slice(0, 200);
      } catch {
        return [];
      }
    };
    detected.modConfigs = await list('config', /\.(?:toml|json5?|properties|cfg|txt|yaml|yml)$/i);
    detected.resourcePacks = await list('resourcepacks', /\.zip$/i);
    detected.shaderPacks = await list('shaderpacks', /\.zip$/i);
  }
  return {
    entries,
    preview: { source, optionCount: entries.length, ignored, detected },
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
