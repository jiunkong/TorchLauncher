export const SERVER_CONFIG_FILENAME = 'torchlauncher-server.json';

export interface ServerConfig {
  readonly format: 'torchlauncher-server';
  readonly version: 1;
  readonly serverId: string;
  readonly name: string;
  readonly address: string;
  readonly sourceUrl: string;
}

export function parseServerConfig(input: unknown): ServerConfig {
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
