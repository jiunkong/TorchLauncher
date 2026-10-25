import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

/** Reads the META section of a TorchLauncher Studio file (checks magic, trailer hash and section hashes). */
function readStudioFile(bytes) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x54, 0x4c, 0x53, 0x0d, 0x0a, 0x1a, 0x0a],
    'magic',
  );
  assert.equal(bytes.readUInt16LE(8), 1, 'format');
  const end = bytes.length - 32;
  assert.ok(
    createHash('sha256').update(bytes.subarray(0, end)).digest().equals(bytes.subarray(end)),
    'trailer hash',
  );
  let offset = 16;
  let meta;
  for (let i = bytes.readUInt32LE(12); i > 0; i--) {
    const id = bytes.subarray(offset, offset + 4).toString('latin1');
    const length = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 40, offset + 40 + length);
    assert.ok(
      createHash('sha256')
        .update(data)
        .digest()
        .equals(bytes.subarray(offset + 8, offset + 40)),
      `${id} hash`,
    );
    if (id === 'META') meta = JSON.parse(inflateSync(data).toString('utf8'));
    offset += 40 + length;
  }
  assert.equal(offset, end, 'no trailing bytes');
  assert.ok(meta, 'META section');
  return meta;
}

import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'torchlauncher-smoke-'));
const statusSockets = new Set();
const statusFixture = createServer((socket) => {
  statusSockets.add(socket);
  socket.once('close', () => statusSockets.delete(socket));
  socket.end();
});
const serverAddress = await new Promise((resolveAddress, reject) => {
  statusFixture.once('error', reject);
  statusFixture.listen(0, '127.0.0.1', () => {
    const address = statusFixture.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Could not determine local status fixture address'));
      return;
    }
    resolveAddress(`127.0.0.1:${address.port}`);
  });
});
const screenshots = resolve('.cache/smoke');
await mkdir(screenshots, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const serverId = '44444444-4444-4444-8444-444444444444';
const configPath = resolve(temp, 'torchlauncher-server.json');
await writeFile(
  configPath,
  `${JSON.stringify({
    format: 'torchlauncher-server',
    signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    version: 1,
    serverId,
    name: 'Smoke fixture',
    address: serverAddress,
    sourceUrl: 'https://example.invalid/smoke.torchpack',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
  })}\n`,
);
const appCases = [
  {
    directory: 'launcher',
    name: 'TorchLauncher',
    pages: [
      ['플레이', 'Smoke fixture'],
      ['내 모드', '내 모드'],
      ['설정', '설정'],
      ['로그', '로그'],
      ['도움말', '도움말'],
    ],
    expectedBridge: [
      'getUpdateState',
      'update',
      'onUpdate',
      'getApplicationInfo',
      'getBranding',
      'onBranding',
      'getState',
      'copyServerDataPath',
      'command',
      'onState',
    ],
    env: { ...env, TORCH_SERVER_CONFIG: configPath },
  },
  {
    directory: 'admin',
    name: 'TorchLauncher Studio',
    pages: [
      ['개요', '새 서버'],
      ['서버 정보', '서버 정보'],
      ['브랜딩', '플레이어가 보게 될 런처'],
      ['모드', '모드'],
      ['리소스팩', '리소스팩'],
      ['셰이더', '셰이더'],
      ['파일', '파일'],
      ['테스트 실행', '테스트 실행'],
      ['단축키 · 옵션', '단축키 · 옵션'],
      ['배포', '배포'],
      ['내보내기', '런처 내보내기'],
    ],
    expectedBridge: ['request', 'onCloseRequest', 'getApplicationInfo'],
    env,
  },
];

try {
  for (const appCase of appCases) {
    const { directory, name } = appCase;
    const applicationDirectory = resolve(`apps/${directory}`);
    const manifest = JSON.parse(
      await readFile(resolve(applicationDirectory, 'package.json'), 'utf8'),
    );
    const app = await electron.launch({
      args: [applicationDirectory, `--user-data-dir=${resolve(temp, directory)}`, '--lang=ko'],
      env: appCase.env,
      timeout: 30_000,
    });

    try {
      if (directory === 'admin') {
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        });
      }
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width: 760, height: 760 });
      await page.getByTestId('app-shell').waitFor();
      if (directory === 'launcher') {
        // The start animation covers the shell for ~1.6s on every launch.
        await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20_000 });
        await page.getByTestId('application-info').filter({ hasText: manifest.version }).waitFor();
      } else {
        await page.getByTestId('application-info').filter({ hasText: process.platform }).waitFor();
      }

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
      assert.deepEqual(result.bridgeKeys, appCase.expectedBridge);

      if (directory === 'launcher') {
        const state = await page.evaluate(() => window.torchlauncher.getState());
        assert.equal(state.configuration, 'ready');
        assert.equal(state.server.serverId, serverId);
        assert.equal(state.server.name, 'Smoke fixture');
        assert.equal(state.server.address, serverAddress);
        assert.equal(state.account, null);
        assert.equal(Object.hasOwn(state, 'branding'), false);
        const branding = await page.evaluate(() => window.torchlauncher.getBranding());
        assert.deepEqual(branding, {
          revision: 0,
          appName: 'TorchLauncher',
          icon: null,
          background: null,
        });
        const brandingSubscription = await page.evaluate(() => {
          const probe = { count: 0, acknowledged: 0 };
          const unsubscribe = window.torchlauncher.onBranding(() => probe.count++);
          const stopAcknowledging = window.torchlauncher.onBranding(() => probe.acknowledged++);
          window.brandingSmokeProbe = { probe, unsubscribe, stopAcknowledging };
          return typeof unsubscribe === 'function' && typeof stopAcknowledging === 'function';
        });
        assert.equal(brandingSubscription, true);
        // Inject fixed default events; all subscription operations use the public isolated bridge.
        const emitBranding = () =>
          app.evaluate(({ BrowserWindow }, snapshot) => {
            BrowserWindow.getAllWindows()[0].webContents.send(
              'launcher:branding-changed',
              snapshot,
            );
          }, branding);
        await emitBranding();
        await page.waitForFunction(() => window.brandingSmokeProbe.probe.acknowledged === 1);
        assert.equal(await page.evaluate(() => window.brandingSmokeProbe.probe.count), 1);
        await page.evaluate(() => window.brandingSmokeProbe.unsubscribe());
        await emitBranding();
        await page.waitForFunction(() => window.brandingSmokeProbe.probe.acknowledged === 2);
        assert.equal(await page.evaluate(() => window.brandingSmokeProbe.probe.count), 1);
        await page.evaluate(() => {
          window.brandingSmokeProbe.stopAcknowledging();
          delete window.brandingSmokeProbe;
        });
        assert.ok(['unknown', 'online', 'unavailable'].includes(state.status.state));
        await page.locator('[data-testid="launch-button"]:not([disabled])').waitFor();
        assert.equal(await page.getByTestId('launch-button').isEnabled(), true);
        const subscription = await page.evaluate(() => {
          const unsubscribe = window.torchlauncher.onState(() => {});
          const callable = typeof unsubscribe === 'function';
          unsubscribe();
          return callable;
        });
        assert.equal(subscription, true);
      } else {
        const state = await page.evaluate(() => window.torchlauncher.request({ action: 'state' }));
        assert.equal(state.ok, true);
        assert.equal(state.state.project, null);
        const invalid = await page.evaluate(() =>
          window.torchlauncher.request({ action: 'not-a-studio-action' }),
        );
        assert.deepEqual(invalid, { ok: false, code: 'INVALID' });
        // The start animation covers the app first; then the start screen offers a new project.
        await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20_000 });
        // New project: the in-app name prompt, then the native parent picker; Studio creates
        // <parent>/새 서버 itself.
        const parentDir = resolve(temp, 'projects');
        await mkdir(parentDir);
        await app.evaluate(({ dialog }, dir) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
        }, parentDir);
        await page.getByTestId('start-new').click();
        await page.getByTestId('project-name-input').fill('새 서버');
        await page.getByTestId('project-name-submit').click();
        await page.getByTestId('project-card').waitFor();
      }

      for (const [label, heading] of appCase.pages) {
        const navButton = page.getByRole('button', { name: label, exact: true }).first();
        await navButton.click();
        await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor();
        assert.equal(await navButton.getAttribute('aria-current'), 'page');
      }

      if (directory === 'admin') {
        await page.getByRole('button', { name: '배포', exact: true }).click();
        assert.equal(
          await page.getByRole('button', { name: '배포 파일 만들기', exact: true }).isDisabled(),
          false, // A project folder always has its files/ directory; a valid default server is buildable.
        );
        const projectFile = resolve(temp, 'projects', '새 서버', 'project.torchproj');
        // Saving lives in the top menu bar (File > Save).
        await page.getByTestId('menu-file').click();
        await page.getByTestId('menu-item-save').click();
        await page.getByText(/프로젝트를 저장했습니다\.|Project saved\./).waitFor();
        // Reopening goes through native dialogs and is covered by the functional smoke; here the
        // binary container is verified (magic, hashes) and its META section is read.
        const savedProject = readStudioFile(await readFile(projectFile));
        assert.equal(savedProject.format, 'torchlauncher-project');
        assert.equal(savedProject.version, 1);
        assert.match(savedProject.serverId, /^[0-9a-f-]{36}$/i);
        assert.equal(savedProject.game.minecraftVersion, '1.21.1');
      }
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

      await page.getByRole('button', { name: appCase.pages[0][0], exact: true }).first().click();
      await page.screenshot({ path: resolve(screenshots, `${directory}.png`) });
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.waitForTimeout(100);
      const wideLayout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        client: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.equal(wideLayout.viewport, 1100);
      assert.ok(wideLayout.content <= wideLayout.client, `${directory} overflows at 1100px`);
      await page.screenshot({ path: resolve(screenshots, `${directory}-wide.png`) });
      console.log(
        `${name}: renderer, navigation, IPC, isolation, and 760px/1100px layout checks passed`,
      );
    } finally {
      // A Studio project with unsaved changes answers a window close with its in-app dialog, so a
      // plain close can wait forever (and hide the real failure). Fall back to ending the process.
      await Promise.race([
        app.close(),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
      ]);
      try {
        app.process().kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }
} finally {
  for (const socket of statusSockets) socket.destroy();
  if (statusFixture.listening)
    await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
