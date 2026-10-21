import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { openDeploymentReader } from '../../../../../packages/core/src/deployment/reader/index';
import { createFullDownloader } from '../../../../../packages/core/src/download/full/index';
import { createDownloadSource } from '../../../../../packages/core/src/download/source/index';
import { installLoader } from '../../../../../packages/core/src/loaders/installer';
import { launchDeployment } from '../../../../../packages/core/src/loaders/launch-gate';
import type { LoaderSelection } from '../../../../../packages/core/src/loaders/profile';
import { installMinecraft } from '../../../../../packages/core/src/minecraft/installer';
import { createPublicJavaAuthenticator } from '../auth/public-java-electron';

interface Config {
  mode: 'install' | 'launch';
  dataDirectory: string;
  gameDirectory: string;
  loader: LoaderSelection;
  sourceFile?: string;
  serverId?: string;
  server?: string;
  durationSeconds: number;
}
const config = JSON.parse(process.env.TORCH_GAME_SMOKE_CONFIG ?? '{}') as Config;
delete process.env.TORCH_GAME_SMOKE_CONFIG;
app.setPath('userData', config.dataDirectory);
app.on('window-all-closed', () => {});
const controller = new AbortController();
let completed = false;
let phase = 'starting';
app.on('before-quit', (event) => {
  if (!completed) {
    event.preventDefault();
    controller.abort();
  }
});
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
async function main() {
  await app.whenReady();
  const platform = {
    os:
      process.platform === 'win32'
        ? ('windows' as const)
        : process.platform === 'darwin'
          ? ('osx' as const)
          : ('linux' as const),
    arch: process.arch as 'x64' | 'arm64',
    version: (await import('node:os')).release(),
  };
  const download = createFullDownloader();
  const prepare = async (selection: LoaderSelection) => {
    phase = 'base-install';
    const base = await installMinecraft({
      root: config.gameDirectory,
      platform,
      download,
      signal: controller.signal,
    });
    phase = 'loader-install';
    return installLoader(base, { selection, download, signal: controller.signal });
  };
  if (config.mode === 'install') {
    await prepare(config.loader);
    return {
      ok: true,
      mode: 'install',
      loader: config.loader,
      installed: true,
      authenticatedConnection: false,
    };
  }
  if (!config.sourceFile || !config.serverId || !config.server)
    throw new Error('Invalid launch configuration');
  const sourceUrl = (await readFile(config.sourceFile, 'utf8')).trim();
  const current = async (signal?: AbortSignal) =>
    openDeploymentReader(createDownloadSource(sourceUrl), {
      expectedServerId: config.serverId as string,
      ...(signal ? { signal } : {}),
    });
  const authenticator = await createPublicJavaAuthenticator({
    cacheDirectory: join(config.dataDirectory, 'public-java'),
    workerPath: join(__dirname, 'public-java-worker.cjs'),
  });
  phase = 'latest-deployment';
  const game = await launchDeployment({
    root: config.gameDirectory,
    expectedServerId: config.serverId,
    server: config.server,
    signal: controller.signal,
    current,
    prepare: async (reader) => {
      const selection = reader.index.game.loader;
      if (
        JSON.stringify(selection) !== JSON.stringify(config.loader) ||
        reader.index.game.minecraftVersion !== '1.21.1'
      )
        throw new Error('Deployment selection differs from requested installation');
      return prepare(selection);
    },
    authenticate: async () => {
      phase = 'authentication';
      return authenticator.login(controller.signal);
    },
  });
  phase = 'game-running';
  const timer = setTimeout(() => {
    void game.stop();
  }, config.durationSeconds * 1000);
  try {
    const result = await game.finished;
    return {
      ok:
        result.reason === 'exited' || result.reason === 'stopped' || result.reason === 'cancelled',
      mode: 'launch',
      spawned: true,
      exitCode: result.code,
      exitReason: result.reason,
      authenticatedConnection: 'not-asserted',
    };
  } finally {
    clearTimeout(timer);
  }
}
void main().then(
  (result) => {
    console.log(`TORCH_GAME_SMOKE_RESULT ${JSON.stringify(result)}`);
    completed = true;
    app.exit(result.ok ? 0 : 1);
  },
  () => {
    console.log(
      `TORCH_GAME_SMOKE_RESULT ${JSON.stringify({ ok: false, phase, code: controller.signal.aborted ? 'cancelled' : 'operation_failed', authenticatedConnection: false })}`,
    );
    completed = true;
    app.exit(1);
  },
);
