/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Mojang metadata uses literal placeholders. */
import { createHash } from 'node:crypto';
import { type Downloader, JAVA_MANIFEST_URL, VERSION_MANIFEST_URL } from '../installer';
import type { Download, Platform } from '../metadata';

export function fixture(platform: Platform = { os: 'linux', arch: 'x64', version: '6.1' }) {
  const responses = new Map<string, Uint8Array>();
  let sequence = 0;
  function bytes(value: unknown): Uint8Array {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  }
  function resource(value: unknown): Download {
    const data = bytes(value);
    const url = `https://fixture.example/${++sequence}`;
    responses.set(url, data);
    return { url, size: data.byteLength, sha1: createHash('sha1').update(data).digest('hex') };
  }
  const client = resource('client-jar');
  const library = resource('library-jar');
  const windowsLibrary = resource('windows-library-jar');
  const asset = resource('asset-bytes');
  responses.delete(asset.url);
  asset.url = `https://resources.download.minecraft.net/${asset.sha1.slice(0, 2)}/${asset.sha1}`;
  responses.set(asset.url, bytes('asset-bytes'));
  const assetIndex = resource({
    objects: {
      'minecraft/sound.ogg': { hash: asset.sha1, size: asset.size },
      duplicate: { hash: asset.sha1, size: asset.size },
    },
  });
  const java = resource('java-executable');
  const legal = resource('license');
  const javaPath =
    platform.os === 'osx'
      ? 'jre.bundle/Contents/Home/bin/java'
      : platform.os === 'windows'
        ? 'bin/javaw.exe'
        : 'bin/java';
  const runtimeData = {
    files: {
      [javaPath]: { type: 'file', executable: true, downloads: { raw: java } },
      legal: { type: 'directory' },
      'legal/LICENSE': { type: 'file', executable: false, downloads: { raw: legal } },
      ...(platform.os === 'windows' ? {} : { 'legal/COPY': { type: 'link', target: 'LICENSE' } }),
    },
  };
  const runtime = resource(runtimeData);
  const logging = resource('<Configuration/>');
  const versionData = {
    id: '1.21.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { majorVersion: 21, component: 'java-runtime-delta' },
    downloads: { client },
    assetIndex: { ...assetIndex, id: '17' },
    libraries: [
      {
        name: 'test:common:1',
        downloads: { artifact: { ...library, path: 'test/common/1/common.jar' } },
      },
      {
        name: 'test:windows:1',
        downloads: { artifact: { ...windowsLibrary, path: 'test/windows/1/windows.jar' } },
        rules: [{ action: 'allow', os: { name: 'windows' } }],
      },
    ],
    logging: {
      client: {
        argument: '-Dlog4j.configurationFile=${path}',
        file: { ...logging, id: 'client.xml' },
      },
    },
    arguments: {
      jvm: [
        { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-XstartOnFirstThread' },
        '-Djava.library.path=${natives_directory}',
        '-cp',
        '${classpath}',
      ],
      game: [
        '--username',
        '${auth_player_name}',
        '--uuid',
        '${auth_uuid}',
        '--accessToken',
        '${auth_access_token}',
        '--clientId',
        '${clientid}',
        '--xuid',
        '${auth_xuid}',
        '--gameDir',
        '${game_directory}',
        {
          rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
          value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
        },
        {
          rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }],
          value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'],
        },
      ],
    },
  };
  const version = resource(versionData);
  const platforms = ['linux', 'mac-os', 'mac-os-arm64', 'windows-x64', 'windows-arm64'];
  function refresh() {
    const versionBytes = bytes(versionData);
    version.sha1 = createHash('sha1').update(versionBytes).digest('hex');
    responses.set(version.url, versionBytes);
    responses.set(
      VERSION_MANIFEST_URL,
      bytes({ versions: [{ id: '1.21.1', url: version.url, sha1: version.sha1 }] }),
    );
    const runtimeBytes = bytes(runtimeData);
    runtime.size = runtimeBytes.byteLength;
    runtime.sha1 = createHash('sha1').update(runtimeBytes).digest('hex');
    responses.set(runtime.url, runtimeBytes);
    responses.set(
      JAVA_MANIFEST_URL,
      bytes(
        Object.fromEntries(
          platforms.map((key) => [
            key,
            {
              'java-runtime-delta': [
                { availability: { progress: 100 }, version: { name: '21.0.7' }, manifest: runtime },
              ],
            },
          ]),
        ),
      ),
    );
  }
  refresh();
  const requests: string[] = [];
  const downloader: Downloader = async (url, options) => {
    options.signal?.throwIfAborted();
    requests.push(url);
    const value = responses.get(url);
    if (!value) throw new Error(`Missing fixture response: ${url}`);
    if (value.byteLength > options.maxBytes) throw new Error('Response too large');
    return value;
  };
  return {
    platform,
    responses,
    requests,
    downloader,
    refresh,
    versionData,
    runtimeData,
    client,
    library,
    windowsLibrary,
    java,
    asset,
    assetIndex,
    runtime,
    version,
  };
}
