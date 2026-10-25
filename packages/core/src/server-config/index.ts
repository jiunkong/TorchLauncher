import {
  BRANDING_ROLES,
  type BrandingAssetMetadata,
  isBrandingAssetMetadata,
} from '../branding/index.js';
import { validateDeploymentPath } from '../deployment/contracts/validation.js';
import { isEd25519PublicKeyText } from '../deployment/signing/key-text.js';

export * from '../branding/index.js';

export const SERVER_CONFIG_FILENAME = 'torchlauncher-server.json';

export interface ServerIdentity {
  readonly format: 'torchlauncher-server';
  readonly version: 1;
  readonly serverId: string;
  readonly name: string;
  readonly address: string;
  readonly sourceUrl: string;
}

export interface ServerConfig extends ServerIdentity {
  /** Optional hint so the launcher can show the game version before the deployment index is read. */
  readonly game?: ServerConfigGame;
  readonly branding?: ServerConfigBranding;
  /** Operator-chosen default game memory; the player's own launcher settings take precedence. */
  readonly memory?: ServerConfigMemory;
  /** Trusted publisher key used to verify every deployment. */
  readonly signing: ServerConfigSigning;
}

export interface ServerConfigMemory {
  /** Default -Xmx in MiB (512..65536). */
  readonly maxMiB: number;
  /** Optional default -Xms in MiB (>= 256 and <= maxMiB); absent means the Java default. */
  readonly initialMiB?: number;
}

export const SERVER_MEMORY_MAX_MIN_MIB = 512;
export const SERVER_MEMORY_MAX_MAX_MIB = 65536;
export const SERVER_MEMORY_INITIAL_MIN_MIB = 256;
export const DEFAULT_GAME_MAX_MEMORY_MIB = 2048;

export function parseServerMemory(input: unknown): ServerConfigMemory {
  const fail = (): never => {
    throw new Error('Invalid server configuration');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'maxMiB' && key !== 'initialMiB')) return fail();
  const max = value.maxMiB;
  if (
    typeof max !== 'number' ||
    !Number.isSafeInteger(max) ||
    max < SERVER_MEMORY_MAX_MIN_MIB ||
    max > SERVER_MEMORY_MAX_MAX_MIB
  )
    return fail();
  if (!Object.hasOwn(value, 'initialMiB')) return { maxMiB: max };
  const initial = value.initialMiB;
  if (
    typeof initial !== 'number' ||
    !Number.isSafeInteger(initial) ||
    initial < SERVER_MEMORY_INITIAL_MIN_MIB ||
    initial > max
  )
    return fail();
  return { maxMiB: max, initialMiB: initial };
}

export interface EffectiveGameMemory {
  readonly maxMemoryMiB: number;
  readonly initialMemoryMiB?: number;
}

/**
 * Per launch: player's saved value, else the server default, else the built-in default
 * (Xmx 2048 MiB, no Xms). An Xms that would exceed the effective Xmx is dropped, never applied.
 */
export function resolveGameMemory(
  player: { readonly maxMemoryMiB?: number; readonly initialMemoryMiB?: number },
  server?: ServerConfigMemory,
): EffectiveGameMemory {
  const maxMemoryMiB = player.maxMemoryMiB ?? server?.maxMiB ?? DEFAULT_GAME_MAX_MEMORY_MIB;
  const initial = player.initialMemoryMiB ?? server?.initialMiB;
  return initial !== undefined &&
    initial >= SERVER_MEMORY_INITIAL_MIN_MIB &&
    initial <= maxMemoryMiB
    ? { maxMemoryMiB, initialMemoryMiB: initial }
    : { maxMemoryMiB };
}

export interface ServerConfigSigning {
  readonly algorithm: 'ed25519';
  /** Canonical unpadded base64url of the raw 32-byte Ed25519 public key. */
  readonly publicKey: string;
}

function parseSigning(input: unknown): ServerConfigSigning {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid server configuration');
  }
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    value.algorithm !== 'ed25519' ||
    !isEd25519PublicKeyText(value.publicKey)
  ) {
    throw new Error('Invalid server configuration');
  }
  return { algorithm: 'ed25519', publicKey: value.publicKey };
}

export interface ServerConfigBrandingAsset extends BrandingAssetMetadata {
  /** Portable relative path resolved against the actual server JSON directory, never the executable. */
  readonly path: string;
}

export interface ServerConfigBranding {
  /** Window title/menu only; never changes app identity, user data, or the home server name. */
  readonly appName?: string;
  readonly icon?: ServerConfigBrandingAsset;
  readonly background?: ServerConfigBrandingAsset;
}

export function parseServerBranding(input: unknown): ServerConfigBranding {
  const fail = (): never => {
    throw new Error('Invalid server configuration');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['appName', ...BRANDING_ROLES].includes(key)))
    return fail();
  const result: {
    appName?: string;
    icon?: ServerConfigBrandingAsset;
    background?: ServerConfigBrandingAsset;
  } = {};
  if (Object.hasOwn(value, 'appName')) {
    const name = value.appName;
    if (
      typeof name !== 'string' ||
      name.trim() !== name ||
      [...name].length < 1 ||
      [...name].length > 40 ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name)
    )
      return fail();
    result.appName = name;
  }
  for (const role of BRANDING_ROLES) {
    if (!Object.hasOwn(value, role)) continue;
    const asset = value[role];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return fail();
    const entry = asset as ServerConfigBrandingAsset;
    if (
      Object.keys(entry).length !== 4 ||
      ['path', 'sha256', 'length', 'mediaType'].some((key) => !Object.hasOwn(entry, key)) ||
      !isBrandingAssetMetadata(role, entry)
    )
      return fail();
    try {
      validateDeploymentPath(entry.path);
    } catch {
      return fail();
    }
    result[role] = {
      path: entry.path,
      sha256: entry.sha256,
      length: entry.length,
      mediaType: entry.mediaType,
    };
  }
  return result;
}

export interface ServerConfigGame {
  readonly minecraftVersion: string;
  readonly loader: { readonly kind: 'fabric' | 'neoforge'; readonly version: string };
}

function versionToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)
  );
}

function parseGame(input: unknown): ServerConfigGame | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const game = input as Record<string, unknown>;
  const loader = game.loader as Record<string, unknown> | null | undefined;
  if (
    Object.keys(game).length !== 2 ||
    !versionToken(game.minecraftVersion) ||
    !loader ||
    typeof loader !== 'object' ||
    Array.isArray(loader) ||
    Object.keys(loader).length !== 2 ||
    (loader.kind !== 'fabric' && loader.kind !== 'neoforge') ||
    !versionToken(loader.version)
  )
    return null;
  return {
    minecraftVersion: game.minecraftVersion,
    loader: { kind: loader.kind, version: loader.version },
  };
}

export function parseServerIdentity(input: unknown): ServerIdentity {
  const fail = (): never => {
    throw new Error('Invalid server configuration');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  const fields = ['format', 'version', 'serverId', 'name', 'address', 'sourceUrl'];
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  ) {
    return fail();
  }
  if (value.format !== 'torchlauncher-server' || value.version !== 1) return fail();
  if (
    typeof value.serverId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.serverId)
  )
    return fail();
  if (
    typeof value.name !== 'string' ||
    value.name.trim() !== value.name ||
    !value.name ||
    value.name.length > 100 ||
    /[\p{Cc}\p{Cf}]/u.test(value.name)
  )
    return fail();
  if (typeof value.address !== 'string' || value.address.length > 260) return fail();
  const address =
    /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$/.exec(
      value.address,
    );
  if (!address?.[1] || !address[2] || Number(address[2]) < 1 || Number(address[2]) > 65535)
    return fail();
  try {
    const host = address[1];
    if (host.startsWith('[')) new URL(`http://${host}/`);
    else if (
      host
        .split('.')
        .some((part) => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))
    )
      return fail();
    if (
      typeof value.sourceUrl !== 'string' ||
      value.sourceUrl.length > 4096 ||
      /[\s\p{Cc}]/u.test(value.sourceUrl)
    )
      return fail();
    const url = new URL(value.sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname)
      return fail();
  } catch {
    return fail();
  }
  return {
    format: 'torchlauncher-server',
    version: 1,
    serverId: value.serverId,
    name: value.name,
    address: value.address,
    sourceUrl: value.sourceUrl as string,
  };
}

/** Validate the trusted launcher profile; publisher signing is always required. */
export function parseServerConfig(input: unknown): ServerConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid server configuration');
  const value = input as Record<string, unknown>;
  if (!Object.hasOwn(value, 'signing')) throw new Error('Invalid server configuration');
  const { game, branding, memory, signing, ...identityInput } = value;
  const hasGame = Object.hasOwn(value, 'game');
  const hasBranding = Object.hasOwn(value, 'branding');
  const hasMemory = Object.hasOwn(value, 'memory');
  const identity = parseServerIdentity(identityInput);
  const parsedGame = hasGame ? parseGame(game) : undefined;
  if (parsedGame === null) throw new Error('Invalid server configuration');
  return {
    ...identity,
    ...(parsedGame ? { game: parsedGame } : {}),
    ...(hasBranding ? { branding: parseServerBranding(branding) } : {}),
    ...(hasMemory ? { memory: parseServerMemory(memory) } : {}),
    signing: parseSigning(signing),
  };
}
