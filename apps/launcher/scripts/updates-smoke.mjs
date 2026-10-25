import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'launcher-help-'));
const screenshots = resolve('.cache/smoke');
await mkdir(screenshots, { recursive: true });
const env = { ...process.env, TORCH_SERVER_CONFIG: resolve(temp, 'absent-config.json') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [resolve('apps/launcher'), `--user-data-dir=${temp}`, '--lang=en'],
    env,
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Replace only the update IPC boundary in this disposable host. Never use real release HTTP.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const mock = {
      state: { phase: 'idle' },
      next: { phase: 'current' },
      actions: [],
      complete: null,
      snapshots: [],
    };
    globalThis.updateMock = mock;
    globalThis.fetch = async () => {
      throw new Error('Network disabled by Help smoke');
    };
    const send = (state) => {
      mock.state = state;
      BrowserWindow.getAllWindows()[0].webContents.send('launcher:update-state', state);
    };
    mock.send = send;
    ipcMain.removeHandler('launcher:update-state');
    ipcMain.removeHandler('launcher:update-command');
    ipcMain.handle(
      'launcher:update-state',
      () =>
        new Promise((resolveSnapshot) => {
          mock.snapshots.push(resolveSnapshot);
        }),
    );
    ipcMain.handle('launcher:update-command', async (_event, command) => {
      mock.actions.push(command.action);
      if (command.action === 'check') {
        send({ phase: 'checking' });
        await new Promise((resolveWait) => setTimeout(resolveWait, 60));
        send(mock.next);
        return mock.state;
      }
      send({ phase: 'downloading', received: 0 });
      return new Promise((resolveDownload) => {
        mock.complete = () => {
          send({ phase: 'downloaded', version: '1.10.0', size: 1024 });
          resolveDownload(mock.state);
        };
      });
    });
  });
  await page.evaluate(() =>
    localStorage.setItem(
      'torchlauncher.launcher.locale-preference',
      JSON.stringify({ mode: 'explicit', locale: 'en' }),
    ),
  );
  await page.reload();
  await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20_000 });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const status = page.getByTestId('update-status');
  const check = page.getByTestId('update-check');
  const update = page.getByTestId('update-download');
  // An event arriving before delayed initial local snapshots must win.
  await app.evaluate(() => {
    globalThis.updateMock.send({ phase: 'current' });
    for (const complete of globalThis.updateMock.snapshots.splice(0)) complete({ phase: 'idle' });
  });
  await status.getByText('You are using the latest version.', { exact: true }).waitFor();
  assert.equal(await update.isDisabled(), true);
  assert.deepEqual(
    await app.evaluate(() => globalThis.updateMock.actions),
    [],
    'mount/navigation must not check releases',
  );
  await check.click();
  await status.getByText('You are using the latest version.', { exact: true }).waitFor();
  const scenarios = [
    [
      { phase: 'error', code: 'LAUNCHER_NO_RELEASE' },
      'No launcher release has been published yet.',
    ],
    [
      { phase: 'error', code: 'LAUNCHER_OFFLINE' },
      'Could not connect to the internet. Check your connection and try again.',
    ],
    [
      { phase: 'error', code: 'LAUNCHER_VERIFY' },
      'Could not verify the update file. Please try again later.',
    ],
    [
      { phase: 'error', code: 'LAUNCHER_RELEASE_FAILED' },
      'Could not check for or download updates. Please try again later.',
    ],
    [
      { phase: 'available', version: '1.10.0', size: 1024 },
      'Version 1.10.0 is available to download.',
    ],
  ];
  for (const [next, text] of scenarios) {
    await app.evaluate((_electron, value) => {
      globalThis.updateMock.next = value;
    }, next);
    await check.click();
    await status.getByText(text, { exact: true }).waitFor();
    assert.equal(await update.isEnabled(), next.phase === 'available');
  }
  await update.click();
  await status.getByText('Downloading update… 0 B', { exact: true }).waitFor();
  assert.equal(await check.isDisabled(), true);
  assert.equal(await update.isDisabled(), true);
  await app.evaluate(() => globalThis.updateMock.send({ phase: 'downloading', received: 512 }));
  await status.getByText('Downloading update… 512 B', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.updateMock.complete());
  await status.getByText('Version 1.10.0 download complete.', { exact: true }).waitFor();
  assert.equal(await update.isDisabled(), true);
  for (const width of [760, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760),
      width,
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: resolve(screenshots, `launcher-help-en-${width}.png`) });
  }
  // Check the actual Korean controls and messages after a locale change/reload.
  await page.evaluate(() =>
    localStorage.setItem(
      'torchlauncher.launcher.locale-preference',
      JSON.stringify({ mode: 'explicit', locale: 'ko' }),
    ),
  );
  await page.reload();
  await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20_000 });
  await page.getByRole('button', { name: '도움말', exact: true }).click();
  await app.evaluate(() => {
    globalThis.updateMock.send({ phase: 'idle' });
    for (const complete of globalThis.updateMock.snapshots.splice(0)) complete({ phase: 'idle' });
    globalThis.updateMock.next = { phase: 'error', code: 'LAUNCHER_NO_RELEASE' };
  });
  await page.getByTestId('update-check').getByText('최신 버전 확인', { exact: true }).waitFor();
  await page.getByTestId('update-check').click();
  await status.getByText('아직 공개된 런처 버전이 없습니다.', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '업데이트', exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ path: resolve(screenshots, 'launcher-help-ko-1100.png') });
  assert.deepEqual(errors, []);
  console.log(
    'Launcher Help mock smoke passed: explicit actions, state/events, no release, offline, validation/service errors, available/download progress/completion, ko/en and 760/1100 layouts.',
  );
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
