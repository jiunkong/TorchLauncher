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
    args: [resolve('apps/launcher'), `--user-data-dir=${resolve(temp, 'user-data')}`],
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
  const toggle = page.getByRole('button', { name: '메뉴 열기', exact: true });
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
  await page
    .getByTestId('remove-file-dialog')
    .locator('[data-autofocus]')
    .click();
  assert.equal(await readFile(unregistered, 'utf8'), 'smoke fixture only');
  await page.getByRole('button', { name: 'readme.txt 삭제', exact: true }).click();
  await page.getByTestId('remove-file-confirm').click();
  await page.getByRole('button', { name: 'readme.txt 삭제', exact: true }).waitFor({ state: 'detached' });
  await assert.rejects(readFile(unregistered), { code: 'ENOENT' });

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: '활성 리소스팩 순서' }).waitFor();
  await page.getByTestId('usage').filter({ hasText: '파일' }).waitFor();
  assert.equal(await page.getByText(dataRoot, { exact: true }).count(), 1);
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
  assert.deepEqual(pageErrors, []);
  console.log(
    'Launcher: mod/pack reads, persisted launcher/game memory settings, usage and log tabs passed',
  );
} finally {
  await app?.close();
  for (const socket of statusSockets) socket.destroy();
  await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
