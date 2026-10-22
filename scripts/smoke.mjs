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
    guardedActions: ['launch-button', 'save-button'],
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
    guardedActions: [],
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
      env,
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
      assert.deepEqual(result.bridgeKeys, ['getApplicationInfo']);

      for (const [label, heading] of appCase.pages) {
        const navButton = page.getByRole('button', { name: label, exact: true });
        await navButton.click();
        await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor();
        assert.equal(await navButton.getAttribute('aria-current'), 'page');
        const productActions = page.locator('button:not(.nav-item)');
        for (const index of await productActions.evaluateAll((buttons) =>
          buttons.map((button) => button.disabled),
        )) {
          assert.equal(index, true, 'product actions must remain unavailable');
        }
        for (const actionId of appCase.guardedActions) {
          const action = page.getByTestId(actionId);
          if (await action.count()) assert.equal(await action.isDisabled(), true);
        }
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
      console.log(
        `${name}: renderer, navigation, disabled actions, IPC, and sandbox checks passed`,
      );
    } finally {
      await app.close();
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
