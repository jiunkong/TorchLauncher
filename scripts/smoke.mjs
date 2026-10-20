import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'torchlauncher-smoke-'));
const screenshots = resolve('.cache/smoke');
await mkdir(screenshots, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  for (const [directory, name] of [
    ['launcher', 'TorchLauncher'],
    ['admin', 'TorchLauncher Studio'],
  ]) {
    const applicationDirectory = resolve(`apps/${directory}`);
    const manifest = JSON.parse(
      await readFile(resolve(applicationDirectory, 'package.json'), 'utf8'),
    );
    const app = await electron.launch({
      args: [applicationDirectory, `--user-data-dir=${resolve(temp, directory)}`],
      env,
      timeout: 30_000,
    });

    try {
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByTestId('app-shell').waitFor();
      await page.getByTestId('application-info').filter({ hasText: process.platform }).waitFor();

      const result = await page.evaluate(async () => ({
        info: await window.torchlauncher.getApplicationInfo(),
        hasRequire: 'require' in window,
        hasProcess: 'process' in window,
        bridgeKeys: Object.keys(window.torchlauncher),
      }));

      assert.equal(result.info.name, name);
      assert.equal(result.info.platform, process.platform);
      assert.equal(result.info.version, manifest.version);
      assert.equal(result.hasRequire, false);
      assert.equal(result.hasProcess, false);
      assert.deepEqual(result.bridgeKeys, ['getApplicationInfo']);
      assert.deepEqual(errors, []);

      const preferences = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('Missing application window');
        const { contextIsolation, nodeIntegration, sandbox } =
          window.webContents.getLastWebPreferences();
        return { contextIsolation, nodeIntegration, sandbox };
      });
      assert.deepEqual(preferences, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      });

      await page.screenshot({ path: resolve(screenshots, `${directory}.png`) });

      console.log(`${name}: renderer, IPC, and sandbox checks passed`);
    } finally {
      await app.close();
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
