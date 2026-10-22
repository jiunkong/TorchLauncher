export const SERVER_CONFIG_FILENAME = 'torchlauncher-server.json';

export interface ServerConfig {
  readonly format: 'torchlauncher-server';
  readonly version: 1;
  readonly serverId: string;
  readonly name: string;
  readonly address: string;
  readonly sourceUrl: string;
  /** Optional hint so the launcher can show the game version before the deployment index is read. */
  readonly game?: ServerConfigGame;
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

export function parseServerConfig(input: unknown): ServerConfig {
  const fail = (): never => {
    throw new Error('Invalid server configuration');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  const fields = ['format', 'version', 'serverId', 'name', 'address', 'sourceUrl'];
  const hasGame = Object.hasOwn(value, 'game');
  if (
    Object.keys(value).length !== fields.length + (hasGame ? 1 : 0) ||
    fields.some((key) => !Object.hasOwn(value, key))
  ) {
    return fail();
  }
  const game = hasGame ? parseGame(value.game) : undefined;
  if (game === null) return fail();
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
    ...(game ? { game } : {}),
  };
}
