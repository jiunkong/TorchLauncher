import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'torchlauncher-smoke-'));
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
    version: 1,
    serverId,
    name: 'Smoke fixture',
    address: 'localhost:25565',
    sourceUrl: 'https://example.invalid/smoke.torchpack',
  })}\n`,
);
const appCases = [
  {
    directory: 'launcher',
    name: 'TorchLauncher',
    pages: [
      ['홈 · 플레이', '서버에 접속할 준비를 합니다'],
      ['내 모드', '내 모드'],
      ['설정', '설정'],
      ['로그', '로그'],
    ],
    expectedBridge: ['getApplicationInfo', 'getState', 'command', 'onState'],
    env: { ...env, TORCH_SERVER_CONFIG: configPath },
  },
  {
    directory: 'admin',
    name: 'TorchLauncher Studio',
    pages: [
      ['개요', '서버 프로젝트를 시작하세요'],
      ['서버 구성', '서버 구성'],
      ['배포', '배포 파일'],
      ['브랜딩 · 내보내기', '브랜딩과 런처 내보내기'],
    ],
    expectedBridge: ['request', 'getApplicationInfo'],
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
      args: [applicationDirectory, `--user-data-dir=${resolve(temp, directory)}`],
      env: appCase.env,
      timeout: 30_000,
    });

    try {
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width: 760, height: 760 });
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
      assert.deepEqual(result.bridgeKeys, appCase.expectedBridge);

      if (directory === 'launcher') {
        const state = await page.evaluate(() => window.torchlauncher.getState());
        assert.equal(state.configuration, 'ready');
        assert.equal(state.server.serverId, serverId);
        assert.equal(state.server.name, 'Smoke fixture');
        assert.equal(state.server.address, 'localhost:25565');
        assert.equal(state.account, null);
        assert.equal(state.status.state, 'unknown');
        assert.equal(await page.getByTestId('launch-button').isDisabled(), true);
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
      }

      for (const [label, heading] of appCase.pages) {
        const navButton = page.getByRole('button', { name: label, exact: true });
        await navButton.click();
        await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor();
        assert.equal(await navButton.getAttribute('aria-current'), 'page');
      }

      if (directory === 'admin') {
        await page.getByRole('button', { name: '개요', exact: true }).click();
        await page.getByRole('button', { name: '새 프로젝트', exact: true }).first().click();
        await page.getByRole('heading', { level: 2, name: '새 서버', exact: true }).waitFor();
        const projectPath = resolve(temp, 'saved-project.json');
        await app.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        }, projectPath);
        await page.getByRole('button', { name: '저장', exact: true }).click();
        await page.getByText('프로젝트를 저장했습니다.', { exact: true }).waitFor();
        const savedProject = JSON.parse(await readFile(projectPath, 'utf8'));
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

      await page.getByRole('button', { name: appCase.pages[0][0], exact: true }).click();
      await page.screenshot({ path: resolve(screenshots, `${directory}.png`) });
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.waitForTimeout(100);
      const wideLayout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.equal(wideLayout.viewport, 1100);
      assert.ok(wideLayout.content <= wideLayout.viewport, `${directory} overflows at 1100px`);
      await page.screenshot({ path: resolve(screenshots, `${directory}-wide.png`) });
      console.log(
        `${name}: renderer, navigation, IPC, isolation, and 760px/1100px layout checks passed`,
      );
    } finally {
      await app.close();
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
