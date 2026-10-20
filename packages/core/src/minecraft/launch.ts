import { join } from 'node:path';
import type { Installation } from './installer';
import { type Argument, allows } from './metadata';

/** Structural boundary agreed with AUTH-01. This module never stores or logs credentials. */
export interface LaunchAuth {
  accessToken: string;
  expiresAt: number;
  profile: { id: string; name: string };
  userType: 'msa';
  clientId: string;
  xuid?: string;
}
export interface LaunchOptions {
  auth: LaunchAuth;
  maxMemoryMiB?: number;
  resolution?: { width: number; height: number };
  quickPlayServer?: string;
  launcherVersion: string;
  /** Injectable clock for expiry checks. */
  now?: number;
}
export interface LaunchCommand {
  executable: string;
  args: string[];
  cwd: string;
  shell: false;
  /** Safe diagnostic argv: access token and account identifiers are removed. */
  redactedArgs: string[];
}
function expand(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const replacement = Object.hasOwn(variables, key) ? variables[key] : undefined;
    if (replacement === undefined) throw new Error(`Unsupported launch placeholder: ${key}`);
    return replacement;
  });
}
function select(
  args: Argument[],
  installation: Installation,
  features: Record<string, boolean>,
  variables: Record<string, string>,
): string[] {
  return args.flatMap((arg) => {
    if (typeof arg === 'string') return [expand(arg, variables)];
    return allows(arg.rules, installation.platform, features)
      ? arg.value.map((value) => expand(value, variables))
      : [];
  });
}
/** Return spawn-ready argv, never a shell string. The caller owns process lifetime and log policy. */
export function buildLaunchCommand(
  installation: Installation,
  options: LaunchOptions,
): LaunchCommand {
  const { auth } = options;
  if (
    !auth.accessToken ||
    [...auth.accessToken].some((character) => character.charCodeAt(0) <= 32) ||
    !Number.isFinite(auth.expiresAt) ||
    auth.expiresAt <= (options.now ?? Date.now())
  )
    throw new Error('A current Minecraft access token is required');
  if (
    auth.userType !== 'msa' ||
    !/^[a-f0-9]{32}$/i.test(auth.profile.id) ||
    !/^[A-Za-z0-9_]{1,16}$/.test(auth.profile.name) ||
    !auth.clientId ||
    auth.clientId.includes('\0')
  )
    throw new Error('Invalid Minecraft account identity');
  if (auth.xuid !== undefined && !/^\d+$/.test(auth.xuid))
    throw new Error('Invalid Xbox user identifier');
  const memory = options.maxMemoryMiB ?? 2048;
  if (!Number.isSafeInteger(memory) || memory < 512 || memory > 65536)
    throw new Error('Invalid JVM memory limit');
  if (!options.launcherVersion || options.launcherVersion.includes('\0'))
    throw new Error('Invalid launcher version');
  if (
    options.resolution &&
    [options.resolution.width, options.resolution.height].some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 16384,
    )
  )
    throw new Error('Invalid resolution');
  if (
    options.quickPlayServer !== undefined &&
    (!options.quickPlayServer ||
      /[/\\]/.test(options.quickPlayServer) ||
      [...options.quickPlayServer].some((character) => character.charCodeAt(0) <= 32) ||
      options.quickPlayServer.length > 255)
  )
    throw new Error('Invalid Quick Play server');
  const features: Record<string, boolean> = {
    has_custom_resolution: Boolean(options.resolution),
    is_quick_play_multiplayer: Boolean(options.quickPlayServer),
    has_quick_plays_support: Boolean(options.quickPlayServer),
  };
  const variables: Record<string, string> = {
    auth_player_name: auth.profile.name,
    auth_uuid: auth.profile.id,
    auth_access_token: auth.accessToken,
    user_type: auth.userType,
    clientid: auth.clientId,
    auth_xuid: auth.xuid ?? '',
    version_name: installation.version.id,
    version_type: installation.version.type,
    game_directory: installation.root,
    assets_root: installation.assetsDirectory,
    assets_index_name: installation.version.assetIndex.id,
    natives_directory: installation.nativesDirectory,
    classpath: installation.classpath.join(installation.platform.os === 'windows' ? ';' : ':'),
    launcher_name: 'TorchLauncher',
    launcher_version: options.launcherVersion,
    resolution_width: String(options.resolution?.width ?? ''),
    resolution_height: String(options.resolution?.height ?? ''),
    quickPlayMultiplayer: options.quickPlayServer ?? '',
    quickPlayPath: join(installation.root, 'quickPlay', 'log.json'),
  };
  const assemble = (values: Record<string, string>) => [
    `-Xmx${memory}M`,
    ...select(installation.version.arguments.jvm, installation, features, values),
    ...(installation.version.logging
      ? [expand(installation.version.logging.argument, { path: installation.loggingPath ?? '' })]
      : []),
    installation.version.mainClass,
    ...select(installation.version.arguments.game, installation, features, values),
  ];
  const args = assemble(variables);
  if (args.some((value) => value.includes('\0'))) throw new Error('NUL in launch argument');
  return {
    executable: installation.javaPath,
    args,
    cwd: installation.root,
    shell: false,
    redactedArgs: assemble({
      ...variables,
      auth_access_token: '[REDACTED]',
      auth_uuid: '[REDACTED]',
      auth_player_name: '[REDACTED]',
      auth_xuid: '[REDACTED]',
    }),
  };
}
