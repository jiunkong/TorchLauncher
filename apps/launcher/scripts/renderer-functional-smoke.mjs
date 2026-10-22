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
  await page.getByText('설치된 모드가 없습니다.', { exact: true }).waitFor();

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('활성 팩 ID (위에서 아래 순서)').waitFor();
  const closeOnLaunch = page.getByRole('checkbox', { name: '게임 실행 후 런처 종료', exact: true });
  assert.equal(await closeOnLaunch.isChecked(), false);
  await closeOnLaunch.click();
  await page.waitForFunction(
    async () => (await window.torchlauncher.getState()).preferences.closeOnLaunch,
  );
  assert.equal(await closeOnLaunch.isChecked(), true);
  assert.deepEqual(
    JSON.parse(await readFile(resolve(temp, 'user-data/launcher-preferences.json'), 'utf8')),
    { closeOnLaunch: true },
  );
  await mkdir(resolve('.cache/smoke'), { recursive: true });
  await page.screenshot({ path: resolve('.cache/smoke/launcher-close-on-launch.png') });
  const packDraft = 'vanilla\nfile/my-local-pack.zip';
  const editor = page.getByLabel('활성 팩 ID (위에서 아래 순서)');
  await editor.fill(packDraft);

  const status = await page.evaluate(() => window.torchlauncher.command({ type: 'status' }));
  assert.equal(status.state.status.state, 'unavailable');
  assert.equal(status.ok, false);
  await page.getByRole('alert').filter({ hasText: '작업 결과:' }).waitFor();
  assert.equal(await editor.inputValue(), packDraft);

  // Home: failed status shows the amber panel with the existing cause text and a retry.
  await page.getByRole('button', { name: '플레이', exact: true }).click();
  const home = page.getByTestId('home');
  await home.getByText('서버 상태를 확인하지 못했습니다', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('app-shell').getAttribute('inert'), null);
  // The log page keeps the previous diagnostic content until L2.
  await page.getByRole('button', { name: '로그', exact: true }).click();
  await page.getByRole('heading', { level: 2, name: '최근 진단 기록' }).waitFor();
  // Navigating back keeps the pack draft in the still-mounted settings page.
  await page.getByRole('button', { name: '설정', exact: true }).click();
  assert.equal(await editor.inputValue(), packDraft);
  assert.deepEqual(pageErrors, []);
  console.log(
    'Launcher: real mod/pack reads, persisted close-on-launch setting and draft preservation passed',
  );
} finally {
  await app?.close();
  for (const socket of statusSockets) socket.destroy();
  await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
