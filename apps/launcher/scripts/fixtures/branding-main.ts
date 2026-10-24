import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationInfoChannel } from '@torchlauncher/core/desktop';
import { app, BrowserWindow, ipcMain, nativeImage, session } from 'electron';
import type { BrandingDeploymentReader } from '../../../../packages/core/src/deployment/reader/index';
import { parseServerConfig } from '../../../../packages/core/src/server-config/index';
import { createBrandingService } from '../../src/main/branding';
import { bindBrandingIpc } from '../../src/main/branding/ipc';
import { bindProductIpc } from '../../src/main/product/ipc';
import type { ProductService } from '../../src/main/product/service';
import { productState } from '../../src/renderer/src/fixtures';
import { brandingChangedChannel } from '../../src/shared/branding';
import { type ProductState, productStateChannel } from '../../src/shared/product';

const root = process.env.BRANDING_FIXTURE_ROOT;
if (!root) throw new Error('isolated fixture root required');
app.setPath('userData', join(root, 'user-data'));
app.setName('TorchLauncher');
void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const directory = join(root, 'actual-profile');
  await mkdir(directory, { recursive: true });
  await mkdir(app.getPath('userData'), { recursive: true });
  const image = (red: number, green: number) => {
    const bitmap = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < bitmap.length; i += 4) bitmap.set([0, green, red, 255], i);
    return nativeImage.createFromBitmap(bitmap, { width: 4, height: 4 }).toPNG();
  };
  const red = image(255, 0);
  const green = image(0, 255);
  const jpeg = nativeImage.createFromBuffer(green).toJPEG(90);
  const metadata = (bytes: Buffer, mediaType: 'image/png' | 'image/jpeg' = 'image/png') => ({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    length: bytes.length,
    mediaType,
  });
  await writeFile(join(directory, 'initial.png'), red);
  const config = parseServerConfig({
    format: 'torchlauncher-server',
    signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    version: 1,
    serverId: '11111111-1111-4111-8111-111111111111',
    name: 'Home server fixed',
    address: 'localhost:25565',
    sourceUrl: 'https://example.invalid/unused',
    branding: {
      appName: 'Operator title',
      icon: { ...metadata(red), path: 'initial.png' },
      background: { ...metadata(red), path: 'initial.png' },
    },
  });
  const file = resolve('apps/launcher/out/renderer/index.html');
  const rendererUrl = pathToFileURL(file).href;
  const window = new BrowserWindow({
    title: config.branding?.appName ?? 'TorchLauncher',
    width: 1100,
    height: 760,
    webPreferences: {
      preload: resolve('apps/launcher/out/preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const downloads: string[] = [];
  const service = createBrandingService({
    base: app.getPath('userData'),
    config,
    configPath: join(directory, 'server.json'),
    openReader: async () => {
      throw new Error('fixture offline');
    },
    publish: (snapshot) => {
      window.setTitle(snapshot.appName);
      if (snapshot.icon) window.setIcon(nativeImage.createFromDataURL(snapshot.icon));
      window.webContents.send(brandingChangedChannel, snapshot);
    },
  });
  bindBrandingIpc(ipcMain, window, rendererUrl, service);
  ipcMain.handle(applicationInfoChannel, () => ({
    name: 'TorchLauncher',
    version: 'fixture',
    platform: process.platform,
  }));
  const state = productState({
    server: { serverId: config.serverId, name: config.name, address: config.address },
    account: null,
    status: { state: 'unavailable' },
  });
  const commands: string[] = [];
  let copiedPath: string | null = null;
  let copyFailure = false;
  let copyAttempts = 0;
  bindProductIpc(
    ipcMain,
    window,
    rendererUrl,
    {
      snapshot: () => state,
      command: (command: { type: string }) => {
        commands.push(command.type);
        return { ok: true, state };
      },
    } as unknown as ProductService,
    (path) => {
      copyAttempts++;
      if (copyFailure) throw new Error('fixture clipboard unavailable');
      copiedPath = path;
    },
  );
  Object.assign(globalThis, {
    brandingFixture: {
      service,
      window,
      commands: () => commands,
      copiedPath: () => copiedPath,
      copyAttempts: () => copyAttempts,
      failCopy: () => {
        copyFailure = true;
      },
      setState(patch: Partial<ProductState> | null) {
        if (patch) Object.assign(state, patch);
        window.webContents.send(productStateChannel, patch === null ? null : state);
      },
      downloads: () => downloads,
      async update(roles: Record<string, 'red' | 'green' | 'jpeg' | 'bad' | null>) {
        const indexRoles: Record<string, unknown> = {};
        for (const [role, value] of Object.entries(roles)) {
          if (value === null) {
            indexRoles[role] = null;
            continue;
          }
          const bytes =
            value === 'green'
              ? green
              : value === 'jpeg'
                ? jpeg
                : value === 'bad'
                  ? red.subarray(0, 33)
                  : red;
          indexRoles[role] = {
            ...metadata(bytes, value === 'jpeg' ? 'image/jpeg' : 'image/png'),
            originalLength: bytes.length,
            storedLength: bytes.length,
            offset: 0,
            compression: 'none',
          };
        }
        const reader = {
          index: { serverId: config.serverId, branding: indexRoles },
          assertCurrent() {},
          async stageBrandingAsset(role: string, path: string) {
            downloads.push(role);
            const bytes =
              roles[role] === 'jpeg'
                ? jpeg
                : roles[role] === 'green'
                  ? green
                  : roles[role] === 'bad'
                    ? red.subarray(0, 33)
                    : red;
            await writeFile(path, bytes);
            return { role, outputPath: path, length: bytes.length, sha256: metadata(bytes).sha256 };
          },
        } as unknown as BrandingDeploymentReader;
        service.observe(reader);
        await service.settled();
        return service.snapshot();
      },
      invalidDecode() {
        const headerOnly = Buffer.from(red.subarray(0, 33));
        return nativeImage.createFromBuffer(headerOnly).isEmpty();
      },
      identity: () => ({
        name: app.getName(),
        data: app.getPath('userData'),
        title: window.getTitle(),
      }),
    },
  });
  await window.loadURL(rendererUrl);
  service.start();
});
app.on('window-all-closed', () => app.quit());
