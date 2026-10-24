import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'torchlauncher-renderer-'));
const statusSockets = new Set();
const statusFixture = createServer((socket) => {
  statusSockets.add(socket);
  socket.once('close', () => statusSockets.delete(socket));
  socket.end();
});
await new Promise((resolveListen, reject) => {
  statusFixture.once('error', reject);
  statusFixture.listen(0, '127.0.0.1', resolveListen);
});
const statusAddress = statusFixture.address();
if (!statusAddress || typeof statusAddress === 'string') {
  await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
  throw new Error('Could not determine local status fixture address');
}
const configPath = resolve(temp, 'server.json');
await writeFile(
  configPath,
  `${JSON.stringify({
    format: 'torchlauncher-server',
    signing: { algorithm: 'ed25519', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    version: 1,
    serverId: '44444444-4444-4444-8444-444444444444',
    name: 'TorchLauncher 접속 검증',
    address: `127.0.0.1:${statusAddress.port}`,
    sourceUrl: 'https://example.invalid/smoke.torchpack',
    game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
  })}\n`,
);

const env = { ...process.env, TORCH_SERVER_CONFIG: configPath };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [resolve('apps/launcher'), `--user-data-dir=${resolve(temp, 'user-data')}`, '--lang=ko'],
    env,
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByTestId('app-shell').waitFor();
  // The start animation plays at least ~1.6s; the shell is inert until it finishes.
  await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20_000 });
  const menu = page.getByTestId('menu');
  assert.equal(await menu.getAttribute('data-open'), 'false');
  const toggle = page.locator('.tg');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await menu.getAttribute('data-open'), 'true');
  await page.screenshot({ path: resolve('.cache/smoke/launcher-menu-opening.png') });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="menu"]')?.getBoundingClientRect().width === 232,
  );
  await page.screenshot({ path: resolve('.cache/smoke/launcher-menu-open.png') });
  assert.match(
    (await page.getByTestId('game-version').textContent()) ?? '',
    /Minecraft 1\.21\.1.*Fabric 0\.19\.5/,
  );
  const collapse = page.getByRole('button', { name: '메뉴 닫기', exact: true });
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByText(`127.0.0.1:${statusAddress.port}`).count(), 0);
  // Mid-transition frame: the container is between 64px and 232px, icons stay put.
  await collapse.click();
  assert.equal(await menu.getAttribute('data-open'), 'false');
  await page.waitForTimeout(100);
  const midWidth = await menu.evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(midWidth > 64 && midWidth < 232, `menu width mid-transition: ${midWidth}`);
  await page.screenshot({ path: resolve('.cache/smoke/launcher-menu-closing-mid.png') });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="menu"]')?.getBoundingClientRect().width === 64,
  );
  // Rapid toggling ends in a state that matches aria-expanded.
  const toggler = page.locator('.tg');
  for (let index = 0; index < 5; index += 1) await toggler.click();
  assert.equal(await menu.getAttribute('data-open'), 'true');
  assert.equal(await toggler.getAttribute('aria-expanded'), 'true');
  await toggler.click();
  assert.equal(await menu.getAttribute('data-open'), 'false');
  assert.equal(await toggler.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggler.evaluate((node) => node === document.activeElement), true);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="menu"]')?.getBoundingClientRect().width === 64,
  );
  assert.equal(
    await page.locator('.side-name').evaluate((node) => getComputedStyle(node).visibility),
    'hidden',
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Microsoft 계정으로 로그인' && !button.disabled,
    ),
  );
  assert.equal(
    await page.getByRole('button', { name: 'Microsoft 계정으로 로그인' }).isEnabled(),
    true,
  );

  assert.equal(
    await page.getByRole('heading', { level: 1, name: 'TorchLauncher 접속 검증' }).count(),
    1,
  );
  await page.getByRole('button', { name: '내 모드', exact: true }).click();
  await page.getByText('추가한 모드가 없습니다.', { exact: true }).waitFor();
  const dataRoot = resolve(temp, 'user-data/servers/44444444-4444-4444-8444-444444444444');
  await mkdir(resolve(dataRoot, 'mods'), { recursive: true });
  const unregistered = resolve(dataRoot, 'mods/readme.txt');
  await writeFile(unregistered, 'smoke fixture only');
  await page.evaluate(() => window.torchlauncher.command({ type: 'mods' }));
  await page.getByRole('button', { name: 'readme.txt 삭제', exact: true }).click();
  await page.getByTestId('remove-file-dialog').waitFor();
  await page.getByTestId('remove-file-dialog').locator('[data-autofocus]').click();
  assert.equal(await readFile(unregistered, 'utf8'), 'smoke fixture only');
  await page.getByRole('button', { name: 'readme.txt 삭제', exact: true }).click();
  await page.getByTestId('remove-file-confirm').click();
  await page
    .getByRole('button', { name: 'readme.txt 삭제', exact: true })
    .waitFor({ state: 'detached' });
  await assert.rejects(readFile(unregistered), { code: 'ENOENT' });

  // Microsoft login code: no dialog and no extra window normally; the dialog follows state only.
  assert.equal(await page.getByTestId('login-dialog').count(), 0);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(
    (await page.evaluate(() => window.torchlauncher.command({ type: 'copy-login-code' }))).ok,
    false,
  );
  const loginState = await page.evaluate(() => window.torchlauncher.getState());
  const sendState = (state) =>
    app.evaluate(({ BrowserWindow }, next) => {
      BrowserWindow.getAllWindows()[0].webContents.send('torchlauncher:product-state', next);
    }, state);
  await sendState({ ...loginState, loginCode: 'ABCD-1234' });
  await page.getByTestId('login-dialog').waitFor();
  assert.equal(await page.getByTestId('login-code').textContent(), 'ABCD-1234');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await sendState({ ...loginState });
  await page.getByTestId('login-dialog').waitFor({ state: 'detached' });

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: '활성 리소스팩 순서' }).waitFor();
  await page.getByTestId('usage').filter({ hasText: '파일' }).waitFor();
  // Language setting: explicit choices switch visible text immediately, automatic follows the system.
  const pathButton = page.locator('.settings-data-path button[title]');
  const pathTitle = () => pathButton.getAttribute('title');
  const choose = (name) => page.getByTestId('language-card').locator(`[data-choice="${name}"]`);
  await choose('en').click();
  assert.equal(await pathTitle(), 'Copy path');
  assert.equal(await choose('en').getAttribute('aria-checked'), 'true');
  await mkdir(resolve('.cache/smoke'), { recursive: true });
  const openEnglishMenu = async () => {
    if ((await menu.getAttribute('data-open')) !== 'true') await toggle.click();
  };
  const captureEnglishPage = async (name, check) => {
    for (const width of [760, 1100]) {
      await page.setViewportSize({ width, height: width === 760 ? 900 : 760 });
      await check();
      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        windowWidth: document.documentElement.clientWidth,
        pageWidth: document.querySelector('[data-testid="page"]')?.scrollWidth ?? 0,
        pageClientWidth: document.querySelector('[data-testid="page"]')?.clientWidth ?? 0,
      }));
      assert.ok(layout.documentWidth <= layout.windowWidth, `${name} overflows at ${width}px`);
      assert.ok(
        layout.pageWidth <= layout.pageClientWidth,
        `${name} content overflows at ${width}px`,
      );
      await page.screenshot({ path: resolve(`.cache/smoke/launcher-en-${name}-${width}.png`) });
    }
  };
  await captureEnglishPage('settings', async () => {
    await page.getByRole('heading', { level: 2, name: 'Active resource pack order' }).waitFor();
    assert.equal(await pathTitle(), 'Copy path');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.getByRole('button', { name: 'My mods', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Logs', exact: true }).waitFor();
  });
  await openEnglishMenu();
  await page.getByRole('button', { name: 'My mods', exact: true }).click();
  await captureEnglishPage('mods', async () => {
    await page.getByRole('heading', { level: 1, name: 'My mods' }).waitFor();
    await page.getByText('You have not added any mods.', { exact: true }).waitFor();
  });
  await openEnglishMenu();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await captureEnglishPage('settings', async () => {
    await page.getByRole('heading', { level: 2, name: 'Active resource pack order' }).waitFor();
  });
  await openEnglishMenu();
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  await captureEnglishPage('logs', async () => {
    await page.getByRole('heading', { level: 1, name: 'Logs' }).waitFor();
    await page.getByRole('tab', { name: 'Launcher', exact: true }).waitFor();
  });
  await openEnglishMenu();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await captureEnglishPage('home', async () => {
    const status = await page.getByTestId('server-status').textContent();
    assert.ok(status && !/[\u3131-\u318e\uac00-\ud7a3]/.test(status));
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  });
  await openEnglishMenu();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: 'Active resource pack order' }).waitFor();
  await choose('ko').click();
  assert.equal(await pathTitle(), '경로 복사');
  await choose('auto').click();
  const systemKorean = await page.evaluate(() =>
    (navigator.languages?.[0] ?? '').toLowerCase().startsWith('ko'),
  );
  assert.equal(await pathTitle(), systemKorean ? '경로 복사' : 'Copy path');
  assert.equal(await choose('auto').getAttribute('aria-checked'), 'true');
  await choose('ko').click();
  await page.screenshot({ path: resolve('.cache/smoke/launcher-language-card.png') });
  // The segmented control does not wrap or overflow its card at the narrowest window.
  await page.setViewportSize({ width: 760, height: 600 });
  const narrow = await page.evaluate(() => {
    const seg = document.querySelector('[data-testid="language-card"] .seg');
    const card = seg.closest('.card');
    return {
      fits: seg.getBoundingClientRect().right <= card.getBoundingClientRect().right,
      oneLine: [...seg.querySelectorAll('button')].every(
        (b) => b.getBoundingClientRect().height < 44,
      ),
    };
  });
  assert.deepEqual(narrow, { fits: true, oneLine: true });
  await page.setViewportSize({ width: 1100, height: 760 });

  assert.equal(await page.getByText(dataRoot, { exact: true }).count(), 1);
  const syntheticWindowsRoot =
    'C:\\Users\\Smoke User\\AppData\\Roaming\\TorchLauncher\\servers\\44444444-4444-4444-8444-444444444444';
  const currentState = await page.evaluate(() => window.torchlauncher.getState());
  await app.evaluate(
    ({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()[0].webContents.send('torchlauncher:product-state', state);
    },
    { ...currentState, serverDataRoot: syntheticWindowsRoot },
  );
  await page
    .locator('.settings-data-path .path')
    .getByText(syntheticWindowsRoot, { exact: true })
    .waitFor();
  const pathSpan = page.locator('.settings-data-path .path');
  assert.equal(await pathSpan.textContent(), syntheticWindowsRoot);
  assert.equal(await pathSpan.getAttribute('title'), syntheticWindowsRoot);
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const path = document.querySelector('.settings-data-path .path');
      const card = path?.closest('.card');
      return {
        pathHeight: path?.getBoundingClientRect().height ?? 0,
        pathClientWidth: path?.clientWidth ?? 0,
        pathScrollWidth: path?.scrollWidth ?? 0,
        cardRight: card?.getBoundingClientRect().right ?? 0,
        windowWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(layout.pathClientWidth > 0, `path width at ${width}px: ${layout.pathClientWidth}`);
    assert.ok(layout.pathScrollWidth > layout.pathClientWidth, `path is not clipped at ${width}px`);
    assert.ok(layout.pathHeight <= 20, `path wraps at ${width}px: ${layout.pathHeight}px`);
    assert.ok(layout.cardRight <= layout.windowWidth, `card overflows window at ${width}px`);
    assert.ok(layout.documentWidth <= layout.windowWidth, `window overflows at ${width}px`);
    assert.equal(await pathSpan.textContent(), syntheticWindowsRoot);
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await app.evaluate(({ BrowserWindow }, state) => {
    BrowserWindow.getAllWindows()[0].webContents.send('torchlauncher:product-state', state);
  }, currentState);
  assert.equal((await page.evaluate(() => window.torchlauncher.getState())).deletion, null);
  const closeOnLaunch = page.getByRole('switch', { name: '게임 실행 후 런처 종료', exact: true });
  assert.equal((await closeOnLaunch.getAttribute('aria-checked')) === 'true', false);
  await closeOnLaunch.click();
  await page.waitForFunction(
    async () => (await window.torchlauncher.getState()).preferences.closeOnLaunch,
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="close-on-launch"]')?.getAttribute('aria-checked') ===
      'true',
  );
  await page.getByTestId('max-memory').fill('0.5');
  await page.getByTestId('initial-memory').fill('0.25');
  await page.getByTestId('save-memory').click();
  await page.waitForFunction(async () => {
    const preferences = (await window.torchlauncher.getState()).preferences;
    return preferences.maxMemoryMiB === 512 && preferences.initialMemoryMiB === 256;
  });
  assert.equal(await page.getByTestId('max-memory').inputValue(), '0.5');
  assert.deepEqual(
    await page.evaluate(async () => {
      const preferences = (await window.torchlauncher.getState()).preferences;
      return [preferences.maxMemoryMiB, preferences.initialMemoryMiB];
    }),
    [512, 256],
  );
  await page.getByTestId('initial-memory').fill('0.25');
  assert.deepEqual(
    JSON.parse(await readFile(resolve(temp, 'user-data/launcher-preferences.json'), 'utf8')),
    { closeOnLaunch: true, maxMemoryMiB: 512, initialMemoryMiB: 256 },
  );
  await page.getByTestId('max-memory').fill('1');
  await rm(resolve(temp, 'user-data/launcher-preferences.json'));
  await mkdir(resolve(temp, 'user-data/launcher-preferences.json'));
  await page.getByTestId('save-memory').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="save-memory"]')?.disabled === false,
  );
  assert.equal(await page.getByTestId('max-memory').inputValue(), '1');
  assert.deepEqual(
    await page.evaluate(async () => {
      const preferences = (await window.torchlauncher.getState()).preferences;
      return [preferences.maxMemoryMiB, preferences.initialMemoryMiB];
    }),
    [512, 256],
  );
  await mkdir(resolve('.cache/smoke'), { recursive: true });
  await page.screenshot({ path: resolve('.cache/smoke/launcher-game-memory.png') });
  const status = await page.evaluate(() => window.torchlauncher.command({ type: 'status' }));
  assert.equal(status.state.status.state, 'unavailable');
  assert.equal(status.ok, false);
  await page.getByRole('alert').filter({ hasText: '작업 결과:' }).waitFor();

  // Home: failed status shows the amber panel with the existing cause text and a retry.
  await page.getByRole('button', { name: '플레이', exact: true }).click();
  const home = page.getByTestId('home');
  await home.getByText('서버 상태를 확인하지 못했습니다', { exact: true }).waitFor();
  assert.equal(await home.getByText(/최근 결과/).count(), 0);
  assert.equal(await page.getByTestId('app-shell').getAttribute('inert'), null);
  await page.getByRole('button', { name: '로그', exact: true }).click();
  await page.getByRole('tab', { name: '런처', exact: true }).click();
  await page
    .getByTestId('log-view')
    .getByText(/^session: ready|^status: failed/)
    .first()
    .waitFor();
  await page.getByTestId('open-logs').click();
  await page.getByText('로그 폴더를 열지 못했습니다.', { exact: true }).waitFor();
  await page.screenshot({ path: resolve('.cache/smoke/l2a-logs.png') });
  // Inject a local synthetic account state solely to verify App → Menu → PlayerAvatar wiring.
  const avatarState = await page.evaluate(() => window.torchlauncher.getState());
  await app.evaluate(({ BrowserWindow, nativeImage }, state) => {
    const skin = nativeImage
      .createFromBitmap(Buffer.alloc(64 * 64 * 4, 255), { width: 64, height: 64 })
      .toDataURL();
    BrowserWindow.getAllWindows()[0].webContents.send('torchlauncher:product-state', {
      ...state,
      account: { name: 'FixturePlayer', expiresAt: 1, skin },
    });
  }, avatarState);
  await page.locator('.player-avatar-skin[data-ready="true"]').waitFor();
  assert.equal(await page.locator('.player-avatar-face').count(), 1);
  assert.equal(await page.locator('.player-avatar-hat').count(), 1);

  // In-app confirmations: record product commands in the main process and answer with the synthetic state.
  const fixtureState = await page.evaluate(() => window.torchlauncher.getState());
  const confirmState = {
    ...fixtureState,
    account: { name: 'FixturePlayer', expiresAt: 1 },
    mods: [
      { path: 'mods/fixture.jar', source: 'user', state: 'ok', conflicts: 0, modIds: ['fixture'] },
    ],
  };
  await app.evaluate(({ BrowserWindow, ipcMain }, state) => {
    globalThis.recordedCommands = [];
    globalThis.languageCommands = [];
    ipcMain.removeHandler('torchlauncher:product');
    ipcMain.handle('torchlauncher:product', (_event, command) => {
      if (command.type === 'set-language') {
        globalThis.languageCommands.push(command.language);
      } else {
        globalThis.recordedCommands.push(command.type);
      }
      return { ok: true, state };
    });
    BrowserWindow.getAllWindows()[0].webContents.send('torchlauncher:product-state', state);
  }, confirmState);
  const recorded = () => app.evaluate(() => globalThis.recordedCommands.join(','));
  const languages = () => app.evaluate(() => globalThis.languageCommands);
  const openMenu = async () => {
    if ((await menu.getAttribute('data-open')) !== 'true') await toggle.click();
  };
  await openMenu();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await choose('en').click();
  assert.equal(await pathTitle(), 'Copy path');
  assert.ok((await languages()).includes('en'));
  // Logout: cancel button, Escape, then confirm; no command until confirmed.
  for (const size of [760, 1100]) {
    await page.setViewportSize({ width: size, height: 900 });
    await openMenu();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const logoutDialog = page.getByTestId('logout-dialog');
    await logoutDialog.waitFor();
    await logoutDialog.getByText('Sign out of the saved account?').waitFor();
    await page.screenshot({
      path: resolve(`.cache/smoke/launcher-en-confirm-${size}.png`),
    });
    await page.keyboard.press('Escape');
    await logoutDialog.waitFor({ state: 'detached' });
    assert.equal(await recorded(), '');
  }
  await openMenu();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByTestId('logout-dialog').locator('[data-autofocus]').click();
  await page.getByTestId('logout-dialog').waitFor({ state: 'detached' });
  assert.equal(await recorded(), '');
  await openMenu();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByTestId('logout-confirm').click();
  await page.getByTestId('logout-dialog').waitFor({ state: 'detached' });
  assert.equal(await recorded(), 'logout');
  // Mod removal: same sequence.
  await page.getByRole('button', { name: 'My mods', exact: true }).click();
  const removeButton = page.getByRole('button', { name: 'Remove fixture.jar', exact: true });
  for (const size of [760, 1100]) {
    await page.setViewportSize({ width: size, height: 900 });
    await removeButton.click();
    const removeDialog = page.getByTestId('remove-mod-dialog');
    await removeDialog.waitFor();
    await removeDialog.getByText('Remove fixture.jar?', { exact: true }).waitFor();
    await page.screenshot({
      path: resolve(`.cache/smoke/launcher-en-remove-mod-${size}.png`),
    });
    await page.keyboard.press('Escape');
    await removeDialog.waitFor({ state: 'detached' });
    assert.equal(await recorded(), 'logout');
  }
  await removeButton.click();
  await page.getByTestId('remove-mod-dialog').locator('[data-autofocus]').click();
  await page.getByTestId('remove-mod-dialog').waitFor({ state: 'detached' });
  assert.equal(await recorded(), 'logout');
  await removeButton.click();
  await page.getByTestId('remove-mod-confirm').click();
  await page.getByTestId('remove-mod-dialog').waitFor({ state: 'detached' });
  assert.equal(await recorded(), 'logout,remove-mod');
  assert.deepEqual(pageErrors, []);
  console.log(
    'Launcher: mod/pack reads, persisted launcher/game memory settings, usage, unregistered-file confirmation/removal, log-folder failure and wired avatar and in-app logout/mod-removal confirmations passed',
  );
} finally {
  await app?.close();
  for (const socket of statusSockets) socket.destroy();
  await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
