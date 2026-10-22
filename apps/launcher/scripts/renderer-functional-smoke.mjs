import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    name: 'Renderer smoke fixture',
    address: `127.0.0.1:${statusAddress.port}`,
    sourceUrl: 'https://example.invalid/smoke.torchpack',
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
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Microsoft 계정으로 로그인' && !button.disabled,
    ),
  );
  assert.equal(
    await page.getByRole('button', { name: 'Microsoft 계정으로 로그인' }).isEnabled(),
    true,
  );

  await page.getByRole('button', { name: '내 모드', exact: true }).click();
  await page.getByText('설치된 모드가 없습니다.', { exact: true }).waitFor();

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('활성 팩 ID (위에서 아래 순서)').waitFor();
  const packDraft = 'vanilla\nfile/my-local-pack.zip';
  const editor = page.getByLabel('활성 팩 ID (위에서 아래 순서)');
  await editor.fill(packDraft);

  const status = await page.evaluate(() => window.torchlauncher.command({ type: 'status' }));
  assert.equal(status.state.status.state, 'unavailable');
  assert.equal(status.ok, false);
  await page.getByRole('alert').filter({ hasText: '작업 결과:' }).waitFor();
  assert.equal(await editor.inputValue(), packDraft);
  assert.deepEqual(pageErrors, []);
  console.log('Launcher: real mod/pack reads and draft preservation across a status event passed');
} finally {
  await app?.close();
  for (const socket of statusSockets) socket.destroy();
  await new Promise((resolveClose) => statusFixture.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}
